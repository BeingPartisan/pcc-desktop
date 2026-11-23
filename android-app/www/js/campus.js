/* ---------- Digiicampus on the phone ---------- */
// The same as PCC on the computer (campus.js at the top of the repo):
// sign in on the university's own page (CampusLoginActivity on Android),
// keep the session token it sets, and read the data feed the site's own
// calendar uses. The token lasts about a week; after that, sign in again.
// What's kept here (key 'campus') stays on this phone; it isn't synced.

const CAMPUS_ORIGIN = 'https://nls.digiicampus.com';
const CAMPUS_WEEKS_AHEAD = 5;
const CAMPUS_SYNC_EVERY_MS = 3 * 60 * 60 * 1000;   // on opening the app, refresh if older than this
const CAMPUS_TOKEN_KEY = '__campusToken';

const campus = { busy: false, error: '' };
const plugins = () => (window.Capacitor && window.Capacitor.Plugins) || {};

function campusClaims(token){
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch(e){ return {}; }
}
function campusToken(){
  const token = Store.get(CAMPUS_TOKEN_KEY, '');
  if(!token) return '';
  const exp = campusClaims(token).exp;
  return exp && exp * 1000 <= Date.now() ? '' : token;
}
const campusExpiresAt = () => { const t = Store.get(CAMPUS_TOKEN_KEY, ''); const exp = t && campusClaims(t).exp; return exp ? exp * 1000 : null; };

class CampusSignIn extends Error {}

// Through Android's own HTTP (the university's site doesn't accept requests from web pages).
async function campusApi(pathAndQuery, token){
  const res = await plugins().CapacitorHttp.get({ url: CAMPUS_ORIGIN + pathAndQuery, headers: { 'Auth-Token': token, Accept: 'application/json' }, connectTimeout: 20000, readTimeout: 20000 });
  if(res.status === 401 || res.status === 403) throw new CampusSignIn();
  if(res.status < 200 || res.status >= 300) throw new Error(`Digiicampus answered ${res.status}`);
  return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
}

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function toSession(lesson, courseNames){
  const cls = (lesson.classList && lesson.classList[0]) || {};
  const classId = cls.classId || (lesson.classIds && lesson.classIds[0]);
  const start = String(lesson.start || ''), end = String(lesson.end || '');
  if(start.length < 16) return null;
  return {
    id: lesson.id, date: start.slice(0, 10), start: start.slice(11, 16), end: end.slice(11, 16),
    subject: clean(cls.courseName || courseNames[classId] || lesson.courseName || 'Class'),
    code: clean(cls.courseCode),
    room: clean((lesson.venueDetails && lesson.venueDetails.name) || lesson.venue || lesson.room),
    teacher: (lesson.facultyList || []).map(f => clean(f.facultyName)).filter(Boolean).join(', '),
    title: clean(lesson.sessionTitle || lesson.title),
    cancelled: !!lesson.isCancelled, online: !!lesson.online,
  };
}
function toEvent(ev){ return ev && ev.starts ? { name: clean(ev.name), type: clean(ev.type).toLowerCase(), starts: ev.starts, ends: ev.ends || ev.starts } : null; }
function toAttendance(raw){
  if(!raw || !Array.isArray(raw.courseAttendance)) return null;
  return {
    present: raw.totalPresent || 0, absent: raw.totalAbsent || 0, total: raw.totalClasses || 0, percentage: raw.percentage || 0,
    courses: raw.courseAttendance.map(c => {
      const sessions = (c.components || []).flatMap(comp => comp.attendance || []);
      return { name: clean(c.courseName), present: c.totalPresent || 0, absent: c.totalAbsent || 0, total: c.totalClasses || 0,
        scheduled: sessions.length, percentage: c.percentage || 0 };
    }),
  };
}

async function campusSync(manual){
  const token = campusToken();
  if(!token || campus.busy) return;
  campus.busy = true; campus.error = ''; render();
  const previous = Store.get('campus', null) || {};
  try {
    const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - ((from.getDay() + 6) % 7));
    const to = new Date(from); to.setDate(to.getDate() + CAMPUS_WEEKS_AHEAD * 7);
    const classes = await campusApi('/rest/classes/v2/', token);
    const list = Array.isArray(classes) ? classes : [];
    const courseNames = {}; for(const c of list) courseNames[c.classId] = c.courseName || c.className;
    const ids = list.map(c => c.classId).filter(id => Number.isFinite(id));
    let lessons = [];
    if(ids.length) lessons = await campusApi(`/rest/classes/v2/lessons?${ids.map(id => `classIds=${id}`).join('&')}&from=${todayStr(from)}+00:00:00&to=${todayStr(to)}+00:00:00`, token);
    lessons = Array.isArray(lessons) ? lessons : [];
    let events = [];
    try { events = await campusApi('/rest/institutionalCalendar/events', token); } catch(e){ if(e instanceof CampusSignIn) throw e; }
    const termCounts = {};
    for(const l of lessons){ const t = l.termId || (l.classList && l.classList[0] && l.classList[0].termId); if(t) termCounts[t] = (termCounts[t] || 0) + 1; }
    const termId = Object.keys(termCounts).sort((a, b) => termCounts[b] - termCounts[a])[0];
    const userId = campusClaims(token).ukid;
    let attendance = previous.attendance || null;
    try { if(userId && termId) attendance = toAttendance(await campusApi(`/api/attendance/student/${userId}/term/${termId}`, token)); } catch(e){ if(e instanceof CampusSignIn) throw e; }
    const fromStr = todayStr(from), toStr = todayStr(to);
    Store.set('campus', {
      syncedAt: Date.now(), from: fromStr, to: toStr,
      sessions: lessons.map(l => toSession(l, courseNames)).filter(Boolean).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)),
      events: (Array.isArray(events) ? events : []).map(toEvent).filter(e => e && e.ends >= fromStr && e.starts <= toStr),
      attendance,
    });
    if(manual) toast('Timetable updated');
    if(typeof islandUpdate === 'function') islandUpdate();
  } catch(e){
    if(e instanceof CampusSignIn){ localStorage.removeItem(CAMPUS_TOKEN_KEY); campus.error = 'Your Digiicampus sign-in has expired. Sign in again.'; }
    else campus.error = "Couldn't reach Digiicampus. Your saved timetable is still here.";
  } finally { campus.busy = false; render(); }
}

async function campusConnect(){
  const p = plugins();
  if(!p.Campus){ toast('Signing in works in the installed app'); return; }
  try {
    const { token } = await p.Campus.signIn();
    Store.set(CAMPUS_TOKEN_KEY, token);
    toast('Connected to Digiicampus');
    await campusSync(true);
  } catch(e){ /* cancelled */ }
}

async function campusDisconnect(){
  if(!confirm('Disconnect Digiicampus on this phone? Your timetable here is removed; sign in again any time.')) return;
  localStorage.removeItem(CAMPUS_TOKEN_KEY); localStorage.removeItem('campus');
  try { await plugins().Campus.signOut(); } catch(e){}
  render();
}

// On opening the app: refresh if it's been a while.
function campusMaybeSync(){
  const data = Store.get('campus', null);
  if(campusToken() && (!data || Date.now() - data.syncedAt > CAMPUS_SYNC_EVERY_MS)) campusSync(false);
}
