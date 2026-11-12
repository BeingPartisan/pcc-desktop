/* ---------- Digiicampus timetable ---------- */
// When a timetable has been synced from Digiicampus, it replaces the manual
// weekly grid: the Study page shows a week of real, dated sessions and Today
// shows today's. The sign-in and the sync itself happen in the main process
// (campus.js); this file only holds the synced copy and draws it.
//
// `campus.data` looks like:
//   { syncedAt, from, to,
//     sessions: [{ id, date, start, end, subject, room, teacher, cancelled, ... }],
//     events:   [{ name, type, starts, ends }] }      // holidays etc.

let campus = { connected: false, expiresAt: null, data: null };
let campusWeekOffset = 0; // weeks away from the current week in the Study view
let campusBusy = false;

function campusActive(){ return !!(campus.data && Array.isArray(campus.data.sessions)); }
function campusSessionsOn(dateStr){ return campus.data.sessions.filter(s => s.date === dateStr); }
function campusEventsOn(dateStr){ return (campus.data.events || []).filter(e => e.starts <= dateStr && dateStr <= e.ends); }

// "09:00" -> "9:00 AM"
function formatClock(hhmm){
  const [h, m] = String(hhmm).split(':').map(Number);
  if(use24Hour()) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
function clockToMinutes(hhmm){ const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; }

function describeAgo(ts){
  const mins = Math.round((Date.now() - ts) / 60000);
  if(mins < 1) return 'just now';
  if(mins < 60) return `${mins} min ago`;
  if(mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} days ago`;
}

/* ----- Loading, connecting, syncing ----- */

async function loadCampus(){
  if(!window.pcc || !window.pcc.campusStatus) return;
  const [status, data] = await Promise.all([window.pcc.campusStatus(), window.pcc.campusData()]);
  campus.connected = status.connected;
  campus.expiresAt = status.expiresAt;
  campus.data = data;
  refreshCampusViews();
  if(status.connected) syncCampus(false); // quiet refresh on startup
}

async function syncCampus(manual){
  if(campusBusy) return;
  campusBusy = true;
  refreshCampusViews();
  try{
    const result = await window.pcc.campusSync();
    if(result.ok){
      campus.data = result.data;
      campus.connected = true;
      if(manual) showToast(`Timetable synced: ${result.data.sessions.length} classes`);
    } else if(result.needsSignIn){
      campus.connected = false;
      if(manual) showToast('Sign in to Digiicampus to sync');
    } else if(manual){
      showToast('Sync failed: ' + (result.error || 'unknown error'));
    }
  } finally {
    campusBusy = false;
    refreshCampusViews();
  }
}

async function connectCampus(){
  const result = await window.pcc.campusConnect();
  if(result.ok){
    campus.connected = true;
    campus.expiresAt = result.expiresAt;
    showToast('Connected to Digiicampus');
    await syncCampus(true);
  } else if(!result.canceled){
    showToast('Could not connect to Digiicampus');
  }
  refreshCampusViews();
}

async function disconnectCampus(){
  if(!confirm('Disconnect Digiicampus?\n\nThis signs PCC out and removes the synced timetable. Your manual timetable comes back.')) return;
  await window.pcc.campusDisconnect();
  campus = { connected: false, expiresAt: null, data: null };
  campusWeekOffset = 0;
  refreshCampusViews();
  showToast('Digiicampus disconnected');
}

function refreshCampusViews(){
  renderTimetable(); // also refreshes Today's class list
  renderCampusSettings();
  renderAcademics();
  renderTodayStatus();
}

/* ----- Settings section ----- */

function renderCampusSettings(){
  const status = document.getElementById('campus-status');
  if(!status) return;
  const show = (id, on) => { document.getElementById(id).style.display = on ? '' : 'none'; };
  const synced = campus.data ? `Last synced ${describeAgo(campus.data.syncedAt)}.` : '';

  if(campus.connected){
    const until = campus.expiresAt ? new Date(campus.expiresAt).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }) : null;
    status.textContent = `Connected. ${synced} ${until ? `You'll need to sign in again after ${until}.` : ''}`.trim();
  } else if(campus.data){
    status.textContent = `Sign-in has expired. ${synced} The saved timetable is still shown.`;
  } else {
    status.textContent = 'Not connected. Sign in to show your real class timetable. You sign in on the university\'s own page; PCC never sees your password.';
  }
  document.getElementById('campus-connect-btn').textContent = campus.data && !campus.connected ? 'Sign in again' : 'Connect';
  show('campus-connect-btn', !campus.connected);
  show('campus-sync-settings-btn', campus.connected);
  show('campus-disconnect-btn', campus.connected || !!campus.data);
  document.getElementById('campus-sync-settings-btn').textContent = campusBusy ? 'Syncing…' : 'Sync now';
}

/* ----- Shared pieces ----- */

// Shown above the timetable when the sign-in has lapsed.
function campusNoticeHtml(){
  if(campus.connected) return '';
  return `<div class="pending-error">Digiicampus sign-in has expired. This is the timetable saved ${describeAgo(campus.data.syncedAt)}.
    <a href="#" onclick="connectCampus(); return false;">Sign in again</a></div>`;
}

function campusEventChips(dateStr){
  return campusEventsOn(dateStr).map(e => `
    <div class="tt-override-chip"><span class="txt">${e.type === 'holiday' ? 'Holiday: ' : ''}${esc(e.name)}</span></div>`).join('');
}

/* ----- Today page ----- */

// Called by renderTodayClasses() (today.js) when a synced timetable exists.
function renderTodayCampus(el){
  const date = todayStr();
  const sessions = campusSessionsOn(date);
  const top = campusNoticeHtml() + campusEventChips(date);

  if(!sessions.length){
    el.innerHTML = top + '<div class="empty">No classes today.</div>';
    return;
  }

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  let nextMarked = false;

  el.innerHTML = top + sessions.map(s => {
    const start = clockToMinutes(s.start), end = clockToMinutes(s.end);
    let status = '', badge = '';
    if(s.cancelled){ status = 'cancelled'; badge = '<span class="pill high class-badge">Cancelled</span>'; }
    else if(nowMin >= end) status = 'past';
    else if(nowMin >= start){ status = 'now'; badge = '<span class="pill class-badge now">Now</span>'; }
    else if(!nextMarked){
      status = 'next'; nextMarked = true;
      const mins = start - nowMin;
      badge = `<span class="pill class-badge next">In ${mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`}</span>`;
    }
    const meta = [s.room, s.teacher, s.substitute ? 'Substitute' : '', s.online ? 'Online' : ''].filter(Boolean).join(' · ');
    return `
      <div class="class-row ${status}" style="border-left-color:${colorForSubject(s.subject)}">
        <span class="class-time">${formatClock(s.start)} – ${formatClock(s.end)}</span>
        <div class="class-body">
          <div class="class-subject">${esc(s.subject)}</div>
          ${meta ? `<div class="class-meta">${esc(meta)}</div>` : ''}
        </div>
        ${badge}
      </div>`;
  }).join('');
}

/* ----- Study page: week view ----- */

function campusWeekStart(offset){
  const d = parseLocalDate(todayStr());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7); // Monday
  return d;
}

function shiftCampusWeek(delta){
  const next = campusWeekOffset + delta;
  const start = todayStr(campusWeekStart(next));
  const end = todayStr(new Date(campusWeekStart(next).getTime() + 6 * 86400000));
  // Stay inside the range that was actually synced.
  if(end < campus.data.from || start >= campus.data.to) return showToast('That week has not been synced');
  campusWeekOffset = next;
  renderTimetable();
}

// Called by renderTimetable() (timetable-mail.js) when a synced timetable exists.
function renderCampusWeek(){
  const monday = campusWeekStart(campusWeekOffset);
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(d.getDate() + i); return d; });
  const today = todayStr();

  const fmt = (d, opts) => d.toLocaleDateString(undefined, opts);
  const dayMonth = (d) => d.getDate() + ' ' + fmt(d, { month: 'short' }); // day first, whatever the system locale
  const sameMonth = days[0].getMonth() === days[6].getMonth();
  document.getElementById('campus-week-label').textContent = campusWeekOffset === 0 ? 'This week'
    : `${sameMonth ? days[0].getDate() : dayMonth(days[0])} – ${dayMonth(days[6])}`;
  document.getElementById('campus-sync-btn').textContent = campusBusy ? 'Syncing…' : 'Sync';
  document.getElementById('tt-source').textContent = `Digiicampus · synced ${describeAgo(campus.data.syncedAt)}`;

  // Weekend columns only appear when something is on.
  const visible = days.filter((d, i) => i < 5 || campusSessionsOn(todayStr(d)).length || campusEventsOn(todayStr(d)).length);

  const columns = visible.map(d => {
    const ds = todayStr(d);
    const sessions = campusSessionsOn(ds);
    const cards = sessions.map(s => `
      <div class="tt-slot ${s.cancelled ? 'cancelled' : ''}" style="border-left-color:${colorForSubject(s.subject)}" title="${esc([s.group, s.teacher].filter(Boolean).join(' · '))}">
        <div class="tt-meta">${formatClock(s.start)} – ${formatClock(s.end)}</div>
        <div class="tt-subject">${esc(s.subject)}</div>
        ${s.room ? `<div class="tt-meta">${esc(s.room)}</div>` : ''}
        ${s.cancelled ? '<div class="tt-meta" style="color:var(--red);">Cancelled</div>' : ''}
      </div>`).join('');
    return `
      <div class="campus-day ${ds === today ? 'is-today' : ''}">
        <div class="campus-day-head"><span>${fmt(d, { weekday: 'short' })}</span><b>${d.getDate()}</b></div>
        ${campusEventChips(ds)}
        ${cards || (campusEventsOn(ds).length ? '' : '<div class="tt-empty">No classes</div>')}
      </div>`;
  }).join('');

  const el = document.getElementById('campus-week');
  el.innerHTML = campusNoticeHtml() + `<div class="campus-week-grid" style="--cols:${visible.length}">${columns}</div>`;
}
