/* ---------- PCC for Android: the pages ---------- */

let page = 'today';

function go(next){
  page = next;
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.dataset.page === page));
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  window.scrollTo({ top: 0 });
  if(next === 'mail') mailMaybeRefresh();
  render();
}

function render(){
  const accent = data.settings.prefs.accent || '#C9F26C';
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--accent-ink', inkFor(accent));
  renderHeader();
  if(page === 'today') renderToday();
  else if(page === 'classes') renderClasses();
  else if(page === 'tasks') renderTasks();
  else if(page === 'messages') renderMessages();
  else if(page === 'mail') renderMail();
  else if(page === 'more') renderMore();
  renderSyncDot();
  renderMessagesBadge();
  // Channels can arrive by sync: listen on the new list.
  const topics = data.msgChannels.map(c => c.topic).join(',');
  if(topics !== lastTopics){ lastTopics = topics; msgRestart(); }
}
let lastTopics = null;

function renderHeader(){
  const h = new Date().getHours();
  const g = h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Good night';
  const name = data.settings.name;
  document.getElementById('greeting').innerHTML = esc(g) + (name ? `, <em>${esc(name)}</em>` : '');
  document.getElementById('date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

/* ----- Today ----- */
function deadlineRow(a){
  const n = daysAway(a.date);
  const badge = n < 0 ? `<b>${-n}</b><small>LATE</small>` : n === 0 ? '<b>!</b><small>TODAY</small>' : `<b>${n}</b><small>${n === 1 ? 'DAY' : 'DAYS'}</small>`;
  const cls = n < 0 ? 'late' : n === 0 ? 'today' : n <= 2 ? 'soon' : '';
  const when = n < 0 ? `Was due ${n === -1 ? 'yesterday' : `${-n} days ago`}` : n === 0 ? 'Today' : n === 1 ? 'Tomorrow'
    : parseLocalDate(a.date).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
  return `<div class="row"><div class="badge ${cls}">${badge}</div>
    <div class="txt"><div class="title">${esc(a.title)}</div><div class="sub ${n < 0 ? 'late' : ''}">${when}</div></div>
    <button class="tick" aria-label="Mark as done" data-key="${esc(a.key)}" onclick="completeDeadline(this.dataset.key)">${CHECK_SVG}</button></div>`;
}

function taskRow(t){
  return `<div class="row ${t.done ? 'done' : ''}">
    <button class="check ${esc(t.priority || 'med')} ${t.done ? 'done' : ''}" aria-label="Done" onclick="toggleTask('${t.id}')">${t.done ? CHECK_SVG : ''}</button>
    <div class="txt"><div class="title">${esc(t.text)}</div></div>
    ${page === 'tasks' ? `<button class="prio" onclick="cyclePriority('${t.id}')">${esc(t.priority || 'med')}</button>` : ''}</div>`;
}

function renderNext(){
  const now = Date.now();
  const cls = classesOn(todayStr()).find(c => now < c.end);
  const el = document.getElementById('next-card');
  let html = '';
  if(cls && now >= cls.start){
    const pct = Math.round((now - cls.start) / (cls.end - cls.start) * 100);
    html = `<div class="k"><i></i>Now</div><div class="t">${esc(cls.subject)}</div><div class="s">${minsText(Math.round((cls.end - now) / 60000))} left${cls.room ? ' · ' + esc(cls.room) : ''}</div><div class="bar"><i style="width:${pct}%"></i></div>`;
  } else if(cls){
    html = `<div class="k"><i></i>Next class</div><div class="t">${esc(cls.subject)}</div><div class="s">in ${minsText(Math.round((cls.start - now) / 60000))} · ${timeText(cls.start)}${cls.room ? ' · ' + esc(cls.room) : ''}</div>`;
  } else {
    const d = openDeadlines().find(x => daysAway(x.date) >= 0);
    if(d){ const n = daysAway(d.date); html = `<div class="k"><i></i>Next deadline</div><div class="t">${esc(d.title)}</div><div class="s">${n === 0 ? 'Due today' : n === 1 ? 'Due tomorrow' : `In ${n} days`}</div>`; }
  }
  el.hidden = !html; el.innerHTML = html;
}

function renderToday(){
  renderUpdateCard();
  renderNext();
  renderTodayMail();
  const deadlines = openDeadlines();
  const late = deadlines.filter(a => daysAway(a.date) < 0).length;
  document.getElementById('deadline-side').textContent = late ? `${late} overdue` : '';
  document.getElementById('today-deadlines').innerHTML = deadlines.length ? deadlines.slice(0, 5).map(deadlineRow).join('') : '<div class="empty">Nothing due. Enjoy it.</div>';
  const rank = { high: 0, med: 1, low: 2 };
  const open = data.tasks.filter(t => !t.done).sort((a, b) => (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1));
  document.getElementById('today-tasks').innerHTML = open.length ? open.slice(0, 5).map(taskRow).join('') : '<div class="empty">All clear.</div>';
  const cds = visibleCountdowns().slice(0, 4);
  document.getElementById('countdowns-head').hidden = !cds.length;
  document.getElementById('today-countdowns').innerHTML = cds.map(c => `<div class="tile ${c.days <= 7 ? 'soon' : ''}">
    <div class="num">${c.days === 0 ? 'Today' : `${c.days}<small>${c.days === 1 ? 'day' : 'days'}</small>`}</div><div class="what">${esc(c.title)}</div></div>`).join('');
}

/* ----- Classes ----- */
const ATTENDANCE_TARGET = 75;

function renderCampusStatus(){
  const connected = !!campusToken();
  const data = Store.get('campus', null);
  document.getElementById('campus-connect').hidden = connected || !!data;
  const el = document.getElementById('campus-status');
  el.hidden = !connected && !data && !campus.error;
  el.className = 'campus-status' + (campus.error ? ' bad' : '');
  el.innerHTML = campus.busy ? '<span>Updating from Digiicampus…</span>'
    : campus.error ? `<span>${esc(campus.error)}</span><button class="link" onclick="campusConnect()">Sign in</button>`
    : data ? `<span>Updated ${ago(data.syncedAt)}</span>${connected ? '<button class="link" onclick="campusSync(true)">Refresh</button>' : '<button class="link" onclick="campusConnect()">Sign in again</button>'}` : '';
}

function renderAttendance(){
  const att = (Store.get('campus', null) || {}).attendance;
  document.getElementById('attendance-head').hidden = !att;
  document.getElementById('attendance').hidden = !att;
  if(!att) return;
  document.getElementById('attendance-side').textContent = `${att.present} of ${att.total} attended`;
  const bar = (pct) => `<div class="att-bar"><i class="${pct < ATTENDANCE_TARGET ? 'below' : ''}" style="width:${Math.min(100, pct)}%"></i></div>`;
  document.getElementById('attendance').innerHTML = `<div class="att-overall"><b class="${att.percentage < ATTENDANCE_TARGET ? 'below-text' : ''}">${att.percentage.toFixed(1)}%</b><span class="muted">overall · ${att.absent} missed</span></div>`
    + att.courses.map(c => {
      const canMiss = c.percentage >= ATTENDANCE_TARGET ? Math.floor(c.present / (ATTENDANCE_TARGET / 100) - c.total + 1e-9) : 0;
      const need = c.percentage < ATTENDANCE_TARGET ? Math.ceil((ATTENDANCE_TARGET / 100 * c.total - c.present) / (1 - ATTENDANCE_TARGET / 100) - 1e-9) : 0;
      return `<div class="att-row"><div class="att-top"><span>${esc(c.name)}</span><span class="${c.percentage < ATTENDANCE_TARGET ? 'below-text' : ''}">${Math.round(c.percentage)}%</span></div>${bar(c.percentage)}
        <div class="att-sub">${c.present} of ${c.total} · ${need ? `attend the next ${need} to reach ${ATTENDANCE_TARGET}%` : canMiss > 0 ? `you can miss ${canMiss} more` : 'no room to miss one'}</div></div>`;
    }).join('');
}

function eventsOn(dateStr){ return ((Store.get('campus', null) || {}).events || []).filter(e => e.starts <= dateStr && dateStr <= e.ends); }

function renderClasses(){
  renderCampusStatus();
  renderAttendance();
  const now = Date.now();
  const today = classesOn(todayStr());
  const left = today.filter(c => now < c.end).length;
  document.getElementById('classes-side').textContent = today.length ? `${left} of ${today.length} left` : '';
  const connected = !!Store.get('campus', null);
  const row = (c) => `<div class="cls ${now >= c.end ? 'past' : now >= c.start ? 'now' : ''}"><div class="time">${timeText(c.start).replace(' ', ' ')}</div>
    <div class="txt"><div class="title">${esc(c.subject)}</div><div class="sub">${esc(c.room)}${now >= c.start && now < c.end ? ' · now' : ''}</div></div></div>`;
  const todayEvents = eventsOn(todayStr()).map(e => `<div class="day-event">${esc(e.name)}</div>`).join('');
  document.getElementById('classes-today').innerHTML = todayEvents + (today.length ? today.map(row).join('')
    : `<div class="empty">${connected ? 'No classes today.' : 'Connect Digiicampus above to see your classes.'}</div>`);
  const week = [];
  for(let i = 1; i <= 6; i++){
    const d = new Date(); d.setDate(d.getDate() + i);
    const list = classesOn(todayStr(d));
    const ev = eventsOn(todayStr(d)).map(e => `<div class="day-event">${esc(e.name)}</div>`).join('');
    if(list.length || ev) week.push(`<div class="day-block"><div class="day-name">${d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}</div>${ev}${list.length ? `<div class="card">${list.map(row).join('')}</div>` : ''}</div>`);
  }
  document.getElementById('classes-week').innerHTML = week.join('') || '';
}

/* ----- Tasks ----- */
function addTask(e){
  e.preventDefault();
  const input = document.getElementById('task-input');
  const text = input.value.trim();
  if(!text) return;
  data.tasks.unshift({ id: uid(), text, done: false, priority: 'med' });
  save('tasks'); input.value = ''; render();
}
function toggleTask(id){
  const t = data.tasks.find(x => x.id === id); if(!t) return;
  t.done = !t.done; save('tasks'); render();
}
function cyclePriority(id){
  const t = data.tasks.find(x => x.id === id); if(!t) return;
  t.priority = { high: 'low', med: 'high', low: 'med' }[t.priority || 'med']; save('tasks'); render();
}
function addDeadline(e){
  e.preventDefault();
  const title = document.getElementById('deadline-input').value.trim(), date = document.getElementById('deadline-date').value;
  if(!title || !date){ toast('Add a title and a date'); return; }
  data.agenda.push({ id: uid(), title, date });
  save('agenda'); document.getElementById('deadline-input').value = ''; document.getElementById('deadline-date').value = ''; render();
}
function renderTasks(){
  const rank = { high: 0, med: 1, low: 2 };
  const open = data.tasks.filter(t => !t.done).sort((a, b) => (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1));
  const done = data.tasks.filter(t => t.done).slice(0, 8);
  document.getElementById('tasks-list').innerHTML = [...open, ...done].map(taskRow).join('') || '<div class="empty">No tasks yet. Add one above.</div>';
  const d = openDeadlines();
  document.getElementById('deadlines-list').innerHTML = d.length ? d.map(deadlineRow).join('') : '<div class="empty">No deadlines.</div>';
}


/* ----- More ----- */
function setProfile(key, value){ data.settings[key] = value.trim(); save('settings'); render(); }
function setAccent(hex){ data.settings.prefs.accent = hex; data.settings.prefs.accentFromWindows = false; save('settings'); render(); }

function renderMore(){
  document.getElementById('set-name').value = data.settings.name || '';
  document.getElementById('set-city').value = data.settings.weatherCity || '';
  document.getElementById('swatches').innerHTML = ACCENTS.map(([name, hex]) =>
    `<button style="--c:${hex}" class="${hex.toLowerCase() === String(data.settings.prefs.accent).toLowerCase() ? 'on' : ''}" aria-label="${name}" onclick="setAccent('${hex}')"></button>`).join('');
  renderIslandCard();
  document.getElementById('more-mail-note').textContent = mail.status && mail.status.configured ? `Signed in as ${mail.status.email}` : 'Not set up: read your mail here, read-only.';
  renderCampusCard();
  renderSyncCard();
  document.getElementById('app-version').textContent = appVersion ? 'Version ' + appVersion : '';
}

function renderCampusCard(){
  const el = document.getElementById('campus-card');
  const connected = !!campusToken(), data = Store.get('campus', null), exp = campusExpiresAt();
  el.innerHTML = connected
    ? `<div class="note ok">Connected${exp ? ` · sign-in lasts until ${new Date(exp).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}` : ''}</div>
       <div class="note">${data ? `${data.sessions.length} classes up to ${parseLocalDate(data.to).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · updated ${ago(data.syncedAt)}` : 'Not updated yet'}</div>
       <div style="display:flex; gap:8px;"><button class="btn" onclick="campusSync(true)">Update now</button><button class="btn danger" onclick="campusDisconnect()">Disconnect</button></div>`
    : `<div class="note">${data ? 'Signed out. Your saved timetable is still here.' : 'Your timetable, rooms and attendance from Digiicampus.'}</div><button class="btn primary" onclick="campusConnect()">${data ? 'Sign in again' : 'Connect Digiicampus'}</button>`;
}

const ago = (ms) => { if(!ms) return 'never'; const s = Math.round((Date.now() - ms) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(ms).toLocaleDateString(); };

function renderSyncCard(){
  const el = document.getElementById('sync-card');
  if(!el) return;
  if(!sync.code){
    el.innerHTML = `<div class="note">On your computer, open PCC › Settings › Sync, press <b>Start syncing</b> (or Copy, if it's already syncing), and enter the code here. Everything is end-to-end encrypted with that code.</div>
      <input id="sync-code-input" type="text" placeholder="SYNC-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" autocapitalize="characters" autocomplete="off" />
      <button class="btn primary" onclick="joinSync()">Join</button><div class="note bad" id="sync-error"></div>`;
    return;
  }
  const devices = Object.values(sync.devices).sort((a, b) => b.seen - a.seen);
  const pending = Store.get('__syncPending', []).length;
  el.innerHTML = `<label>This phone's name<input type="text" maxlength="40" value="${esc(sync.deviceName)}" onchange="renamePhone(this.value)" /></label>
    <div>${devices.length ? devices.map(d => `<div class="device"><span>${esc(d.name)}</span><span>seen ${ago(d.seen)}</span></div>`).join('') : '<div class="note">Waiting to hear from your computer. Keep PCC open there.</div>'}</div>
    <div class="note">Sent ${ago(sync.lastSent)} · received ${ago(sync.lastReceived)}${pending ? ` · ${pending} waiting for a connection` : ''}</div>
    <div style="display:flex; gap:8px;"><button class="btn" onclick="syncNowTap()">Sync now</button><button class="btn danger" onclick="leaveSync()">Stop syncing</button></div>`;
}

async function joinSync(){
  const err = await syncJoin(document.getElementById('sync-code-input').value);
  if(err){ document.getElementById('sync-error').textContent = err; return; }
  toast('Syncing. Your computer will send what it has in a moment.');
  render();
}
async function syncNowTap(){ await syncFlush(); await syncSend({ type: 'hello' }); toast('Asked your computer for its latest'); setTimeout(render, 4000); }
async function leaveSync(){ if(!confirm('Stop syncing on this phone? Everything stays here; it just stops being shared.')) return; await syncLeave(); render(); }
function renamePhone(name){ sync.deviceName = name.trim().slice(0, 40) || 'Android phone'; Store.set('__syncDeviceName', sync.deviceName); }

function renderSyncDot(){
  const dot = document.getElementById('sync-dot');
  const pending = Store.get('__syncPending', []).length;
  dot.className = 'sync-dot' + (sync.code ? (pending ? ' waiting' : ' on') : '');
}

/* ----- Start ----- */
go('today');
initSync().then(render);
campusMaybeSync();
mailStatus().then(() => { render(); mailMaybeRefresh(); });
checkForUpdate(false);
// The island: ask for notifications the first time, then keep it fed with the coming classes.
if(Store.get('__islandAsked', false)) islandUpdate().then(render);
else { Store.set('__islandAsked', true); islandAskPermission(); }
// Keep countdowns and "now / next" fresh, and pick up changes when the app comes back to the front.
setInterval(() => { if(document.visibilityState === 'visible') render(); }, 30000);
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible'){ if(sync.code){ syncListen(); syncFlush(); } msgListen(); campusMaybeSync(); mailMaybeRefresh(); islandUpdate(); render(); } });
