// Digiicampus timetable sync.
//
// The university calendar sits behind a login, so PCC never handles the
// password. Instead:
//   1. "Connect" opens the university's own sign-in page in a separate
//      window with its own persistent browser profile (PARTITION).
//   2. After sign-in the site stores a session token in a cookie named
//      `user`. PCC reads that token from the profile when it needs it; it is
//      not copied anywhere else.
//   3. Sync calls the same data feed the site's calendar page uses, sending
//      the token in an `Auth-Token` header, and keeps a compact copy of the
//      upcoming sessions in the app's data folder.
//
// The token lasts about a week. When it expires the cached timetable is
// still shown and the UI asks the user to sign in again.
//
// This depends on a site PCC doesn't control: if Digiicampus changes its
// feed, the mapping in toSession() / toEvent() is the place to adjust.

const { BrowserWindow, session, net, ipcMain, app } = require('electron');
const path = require('path');
const fs = require('fs');

const CAMPUS_ORIGIN = 'https://nls.digiicampus.com';
const PARTITION = 'persist:campus';
const TOKEN_COOKIE = 'user';
const WEEKS_AHEAD = 5; // how far ahead to sync, counted from this week's Monday
const REQUEST_TIMEOUT_MS = 20000;

class SignInRequired extends Error {}

module.exports = function registerCampus({ logEvent, getMainWindow }) {
  const CACHE_FILE = path.join(app.getPath('userData'), 'pcc-campus.json');
  const campusSession = () => session.fromPartition(PARTITION);

  // --- Token ---

  // The token is a JWT; its payload carries the expiry and the user's id.
  function tokenClaims(token) {
    try {
      return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf-8'));
    } catch (e) {
      return {};
    }
  }

  function tokenExpiry(token) {
    const { exp } = tokenClaims(token);
    return exp ? exp * 1000 : null;
  }

  // Returns { token, expiresAt } for a signed-in, unexpired session, else null.
  async function getToken() {
    const cookies = await campusSession().cookies.get({ url: CAMPUS_ORIGIN, name: TOKEN_COOKIE });
    if (!cookies.length) return null;
    const token = decodeURIComponent(cookies[0].value || '');
    if (token.split('.').length !== 3) return null;
    const expiresAt = tokenExpiry(token);
    if (expiresAt && expiresAt <= Date.now()) return null;
    return { token, expiresAt };
  }

  // --- Feed ---

  async function api(pathAndQuery, token) {
    const res = await net.fetch(CAMPUS_ORIGIN + pathAndQuery, {
      headers: { 'Auth-Token': token, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) throw new SignInRequired();
    if (!res.ok) throw new Error(`Digiicampus answered ${res.status} for ${pathAndQuery.split('?')[0]}`);
    return res.json();
  }

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  function mondayOfThisWeek() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  }

  // One feed lesson -> the compact shape the UI uses. The feed's start/end
  // are local wall-clock strings: "2026-11-11 11:10:00".
  function toSession(lesson, courseNames) {
    const cls = (lesson.classList && lesson.classList[0]) || {};
    const classId = cls.classId || (lesson.classIds && lesson.classIds[0]);
    const start = String(lesson.start || '');
    const end = String(lesson.end || '');
    if (start.length < 16) return null;
    return {
      id: lesson.id,
      date: start.slice(0, 10),
      start: start.slice(11, 16),
      end: end.slice(11, 16),
      subject: clean(cls.courseName || courseNames[classId] || lesson.courseName || 'Class'),
      code: clean(cls.courseCode),
      group: clean(cls.batch),
      room: clean((lesson.venueDetails && lesson.venueDetails.name) || lesson.venue || lesson.room),
      teacher: (lesson.facultyList || []).map((f) => clean(f.facultyName)).filter(Boolean).join(', '),
      title: clean(lesson.sessionTitle || lesson.title),
      cancelled: !!lesson.isCancelled,
      substitute: !!lesson.substitute,
      online: !!lesson.online,
    };
  }

  // One institutional-calendar entry (holiday, exam period...) -> compact shape.
  function toEvent(ev) {
    if (!ev || !ev.starts) return null;
    return { name: clean(ev.name), type: clean(ev.type).toLowerCase(), starts: ev.starts, ends: ev.ends || ev.starts };
  }

  // --- Attendance and results ---

  // Attendance for one term -> totals plus one row per course. `missed`
  // lists the dates of counted absences.
  function toAttendance(raw) {
    if (!raw || !Array.isArray(raw.courseAttendance)) return null;
    return {
      termId: raw.termId,
      present: raw.totalPresent || 0,
      absent: raw.totalAbsent || 0,
      total: raw.totalClasses || 0,
      percentage: raw.percentage || 0,
      courses: raw.courseAttendance.map((c) => {
        const components = c.components || [];
        const sessions = components.flatMap((comp) => comp.attendance || []);
        return {
          name: clean(c.courseName),
          code: clean(components[0] && components[0].courseCode),
          credits: c.courseCredits || null,
          present: c.totalPresent || 0,
          absent: c.totalAbsent || 0,
          total: c.totalClasses || 0,
          scheduled: sessions.length, // every session in the term, including ones not held yet
          percentage: c.percentage || 0,
          missed: sessions
            .filter((s) => s && s.status === 'ABSENT' && !s.doNotConsiderForAttendance)
            .map((s) => String(s.lessonStartTime || '').slice(0, 10))
            .filter((d) => /^\d{4}-\d\d-\d\d$/.test(d))
            .sort(),
        };
      }),
    };
  }

  // One declared term's result -> SGPA plus a row per course.
  function toTermResult(raw, listEntry) {
    return {
      examId: listEntry.examId,
      termId: listEntry.termId,
      name: clean(raw.termName || listEntry.termName || listEntry.examName),
      declaredAt: raw.appliedAt || listEntry.appliedAt || null,
      sgpa: typeof raw.sgpa === 'number' ? raw.sgpa : null,
      courses: (raw.courses || []).map((c) => ({
        name: clean(c.courseName),
        code: clean(c.courseCode),
        credits: c.courseCredits || 0,
        marks: typeof c.marks === 'number' ? c.marks : null,
        grade: clean(c.grade),
        gradePoint: typeof c.gradePoint === 'number' ? c.gradePoint : null,
        failed: !!c.hasFailed,
        counts: c.considerForSgpaCalculation !== false,
      })),
    };
  }

  // Declared results don't change, so a term already in the cache isn't
  // fetched again unless `refetchAll` is set.
  async function fetchResults(userId, token, cached, refetchAll) {
    const list = await api(`/api/v2/resultDeclaration/student/terms/${userId}`, token);
    const known = {};
    if (!refetchAll && cached && Array.isArray(cached.terms)) {
      for (const t of cached.terms) known[t.examId] = t;
    }
    const terms = [];
    for (const entry of list.terms || []) {
      if (!entry.isRegularDeclared) continue;
      if (known[entry.examId]) {
        terms.push(known[entry.examId]);
        continue;
      }
      const raw = await api(`/api/v2/resultDeclaration/student/term/${entry.examId}/${userId}`, token);
      terms.push(toTermResult(raw, entry));
    }
    return {
      cgpa: typeof list.overallCgpa === 'number' ? list.overallCgpa : null,
      totalCredits: list.totalCredits || null,
      terms,
    };
  }

  // Runs one optional part of the sync. A failure there is logged and the
  // previous copy kept, so it never costs the timetable; a lapsed sign-in
  // still stops the whole sync.
  async function optionalPart(label, fallback, work) {
    try {
      return await work();
    } catch (e) {
      if (e instanceof SignInRequired) throw e;
      logEvent('warn', `Digiicampus: could not load ${label}`, String(e.message || e));
      return fallback;
    }
  }

  async function sync(options = {}) {
    const auth = await getToken();
    if (!auth) return { ok: false, needsSignIn: true };
    const userId = tokenClaims(auth.token).ukid;
    const previous = readCache() || {};

    const from = mondayOfThisWeek();
    const to = new Date(from);
    to.setDate(to.getDate() + WEEKS_AHEAD * 7);

    try {
      const classes = await api('/rest/classes/v2/', auth.token);
      const classList = Array.isArray(classes) ? classes : [];
      const courseNames = {};
      for (const c of classList) courseNames[c.classId] = c.courseName || c.className;
      const ids = classList.map((c) => c.classId).filter((id) => Number.isFinite(id));

      let lessons = [];
      if (ids.length) {
        const query = ids.map((id) => `classIds=${id}`).join('&') + `&from=${ymd(from)}+00:00:00&to=${ymd(to)}+00:00:00`;
        lessons = await api(`/rest/classes/v2/lessons?${query}`, auth.token);
      }

      // The university calendar is a bonus; a failure here shouldn't lose the classes.
      const events = await optionalPart('the university calendar', [], () =>
        api('/rest/institutionalCalendar/events', auth.token)
      );

      // The current term is whichever one most of the synced lessons belong to.
      const termCounts = {};
      for (const l of Array.isArray(lessons) ? lessons : []) {
        const termId = l.termId || (l.classList && l.classList[0] && l.classList[0].termId);
        if (termId) termCounts[termId] = (termCounts[termId] || 0) + 1;
      }
      const currentTermId = Object.keys(termCounts).sort((a, b) => termCounts[b] - termCounts[a])[0];

      const attendance = await optionalPart('attendance', previous.attendance || null, async () => {
        if (!userId || !currentTermId) return previous.attendance || null;
        return toAttendance(await api(`/api/attendance/student/${userId}/term/${currentTermId}`, auth.token));
      });

      const results = await optionalPart('results', previous.results || null, async () => {
        if (!userId) return previous.results || null;
        return fetchResults(userId, auth.token, previous.results, !!options.refetchResults);
      });

      const fromStr = ymd(from);
      const toStr = ymd(to);
      const data = {
        syncedAt: Date.now(),
        from: fromStr,
        to: toStr,
        sessions: (Array.isArray(lessons) ? lessons : [])
          .map((l) => toSession(l, courseNames))
          .filter(Boolean)
          .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)),
        events: (Array.isArray(events) ? events : [])
          .map(toEvent)
          .filter((e) => e && e.ends >= fromStr && e.starts <= toStr),
        attendance,
        results,
      };

      fs.writeFileSync(CACHE_FILE, JSON.stringify(data), 'utf-8');
      logEvent(
        'info',
        `Digiicampus sync complete: ${data.sessions.length} session(s), ${data.events.length} calendar entr(ies), ` +
          `attendance ${attendance ? 'for ' + attendance.courses.length + ' course(s)' : 'unavailable'}, ` +
          `results ${results ? 'for ' + results.terms.length + ' term(s)' : 'unavailable'}`
      );
      return { ok: true, data };
    } catch (e) {
      if (e instanceof SignInRequired) {
        logEvent('warn', 'Digiicampus sync: sign-in required');
        return { ok: false, needsSignIn: true };
      }
      logEvent('error', 'Digiicampus sync failed', String(e.message || e));
      return { ok: false, error: String(e.message || e) };
    }
  }

  function readCache() {
    try {
      if (fs.existsSync(CACHE_FILE)) return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    } catch (e) {
      logEvent('error', 'Could not read the cached Digiicampus timetable', String(e));
    }
    return null;
  }

  // --- Sign-in window ---

  let signInInProgress = null;

  function connect() {
    if (signInInProgress) return signInInProgress;
    signInInProgress = (async () => {
      const existing = await getToken();
      if (existing) return { ok: true, expiresAt: existing.expiresAt };

      return new Promise((resolve) => {
        const ses = campusSession();
        const win = new BrowserWindow({
          width: 540,
          height: 760,
          parent: getMainWindow() || undefined,
          title: 'Sign in to Digiicampus',
          autoHideMenuBar: true,
          webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false },
        });
        win.setMenuBarVisibility(false);

        let done = false;
        const finish = (result) => {
          if (done) return;
          done = true;
          ses.cookies.removeListener('changed', onCookie);
          if (!win.isDestroyed()) win.close();
          resolve(result);
        };
        // The site sets the token cookie once sign-in completes.
        const onCookie = async (event, cookie, cause, removed) => {
          if (removed || cookie.name !== TOKEN_COOKIE) return;
          const auth = await getToken();
          if (auth) {
            logEvent('info', 'Digiicampus: signed in');
            finish({ ok: true, expiresAt: auth.expiresAt });
          }
        };
        ses.cookies.on('changed', onCookie);
        win.on('closed', () => finish({ ok: false, canceled: true }));
        win.webContents.on('did-fail-load', (event, code, description, url, isMainFrame) => {
          if (isMainFrame && code !== -3) logEvent('warn', 'Digiicampus sign-in page failed to load', description);
        });
        win.loadURL(CAMPUS_ORIGIN + '/');
      });
    })().finally(() => {
      signInInProgress = null;
    });
    return signInInProgress;
  }

  async function disconnect() {
    await campusSession().clearStorageData();
    try {
      if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
    } catch (e) {
      logEvent('warn', 'Could not remove the cached Digiicampus timetable', String(e));
    }
    logEvent('info', 'Digiicampus: disconnected');
    return { ok: true };
  }

  // --- IPC ---

  ipcMain.handle('campus-status', async () => {
    const auth = await getToken();
    const cache = readCache();
    return { connected: !!auth, expiresAt: auth ? auth.expiresAt : null, syncedAt: cache ? cache.syncedAt : null };
  });
  ipcMain.handle('campus-data', () => readCache());
  ipcMain.handle('campus-connect', () => connect());
  ipcMain.handle('campus-sync', (event, options) => sync(options || {}));
  ipcMain.handle('campus-disconnect', () => disconnect());
};
