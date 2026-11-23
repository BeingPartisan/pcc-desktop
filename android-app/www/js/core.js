/* ---------- PCC for Android: data and helpers ---------- */
// Everything is kept in the same shape and under the same names as PCC on
// the computer, so sync can carry it between them unchanged:
//   tasks       [{ id, text, done, priority: 'high' | 'med' | 'low' }]
//   agenda      [{ id, title, date 'YYYY-MM-DD', done?, doneAt? }]          (deadlines)
//   evaluations { [course]: { components: [{ id, name, max, got, date, time, done? }] } }
//   countdowns  [{ id, title, date, channelId, u, del? }]
//   msgChannels [{ id, name, topic }]
//   notes       [{ id, title, body, updatedAt }]
//   settings    { name, weatherCity, prefs: { accent, ... } }

const Store = {
  get(key, fallback){ try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch(e){ return fallback; } },
  set(key, value){ try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch(e){ return false; } },
};

const data = {
  tasks: Store.get('tasks', []),
  agenda: Store.get('agenda', []),
  evaluations: Store.get('evaluations', {}),
  countdowns: Store.get('countdowns', []),
  msgChannels: Store.get('msgChannels', []),
  notes: Store.get('notes', []),
  settings: Store.get('settings', { name: '', weatherCity: '', prefs: { accent: '#C9F26C' } }),
};
if(!data.settings.prefs) data.settings.prefs = { accent: '#C9F26C' };

function save(key){ Store.set(key, data[key]); }

const uid = () => 'id' + Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => (n < 10 ? '0' : '') + n;
function todayStr(d = new Date()){ return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
const parseLocalDate = (s) => new Date(s + 'T00:00');
const daysAway = (dateStr) => Math.round((parseLocalDate(dateStr) - parseLocalDate(todayStr())) / 86400000);

// The same accent colours as on the computer.
const ACCENTS = [['Lime', '#C9F26C'], ['Sky', '#86C6FF'], ['Violet', '#B9A5FF'], ['Coral', '#FF8A73'], ['Amber', '#F4B860'], ['Mint', '#7FE0C4'], ['Pink', '#FF8FC7']];

// Readable text on the accent: dark on light colours.
function inkFor(hex){
  const n = parseInt(String(hex).slice(1), 16);
  const l = (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.55 ? '#151A07' : '#FFFFFF';
}

/* ----- Deadlines: your own and dated evaluation components, like on the computer ----- */
function openDeadlines(){
  const items = data.agenda.filter(a => !a.done).map(a => ({ ...a, key: 'a:' + a.id }));
  for(const [course, entry] of Object.entries(data.evaluations || {})){
    for(const c of (entry && entry.components) || []){
      if(c.date && c.got == null && !c.done) items.push({ title: `${course}: ${c.name}${c.time ? ' · ' + c.time : ''}`, date: c.date, fromEvaluation: true, key: 'e:' + encodeURIComponent(course) + ':' + c.id });
    }
  }
  const monthAgo = todayStr(new Date(Date.now() - 30 * 86400000));
  return items.filter(a => a.date >= monthAgo).sort((a, b) => a.date.localeCompare(b.date));
}

function completeDeadline(key){
  const [kind, ...rest] = String(key).split(':');
  if(kind === 'a'){
    const item = data.agenda.find(a => a.id === rest[0]);
    if(item){ item.done = true; item.doneAt = Date.now(); save('agenda'); toast(`Done: ${item.title}`); }
  } else if(kind === 'e'){
    const course = decodeURIComponent(rest[0]);
    const comp = ((data.evaluations[course] || {}).components || []).find(c => c.id === rest[1]);
    if(comp){ comp.done = true; comp.doneAt = Date.now(); save('evaluations'); toast(`Done: ${comp.name}`); }
  }
  render();
}

// Ticked-off deadlines, most recent first, so one ticked by mistake can be brought back.
function doneDeadlines(){
  const items = data.agenda.filter(a => a.done).map(a => ({ title: a.title, date: a.date, doneAt: a.doneAt || 0, key: 'a:' + a.id }));
  for(const [course, entry] of Object.entries(data.evaluations || {})){
    for(const c of (entry && entry.components) || []){
      if(c.date && c.got == null && c.done) items.push({ title: `${course}: ${c.name}`, date: c.date, doneAt: c.doneAt || 0, key: 'e:' + encodeURIComponent(course) + ':' + c.id });
    }
  }
  return items.sort((a, b) => b.doneAt - a.doneAt || b.date.localeCompare(a.date));
}

function restoreDeadline(key){
  const [kind, ...rest] = String(key).split(':');
  if(kind === 'a'){
    const item = data.agenda.find(a => a.id === rest[0]);
    if(item){ item.done = false; delete item.doneAt; save('agenda'); toast(`Back on the list: ${item.title}`); }
  } else if(kind === 'e'){
    const course = decodeURIComponent(rest[0]);
    const comp = ((data.evaluations[course] || {}).components || []).find(c => c.id === rest[1]);
    if(comp){ comp.done = false; delete comp.doneAt; save('evaluations'); toast(`Back on the list: ${comp.name}`); }
  }
  render(true);
}

/* ----- Countdowns ----- */
function visibleCountdowns(){
  return data.countdowns.filter(c => !c.del && c.date).map(c => ({ ...c, days: daysAway(c.date) }))
    .filter(c => c.days >= 0).sort((a, b) => a.days - b.days);
}

/* ----- Classes ----- */
// Today's classes as { subject, room, start, end } (ms). They come from Digiicampus
// (data.campus, once connected on this phone); none until then.
function classesOn(dateStr){
  const sessions = (Store.get('campus', null) || {}).sessions || [];
  const at = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); const d = parseLocalDate(dateStr); d.setHours(h, m, 0, 0); return d.getTime(); };
  return sessions.filter(s => s.date === dateStr && !s.cancelled)
    .map(s => ({ subject: s.subject, room: s.room || '', start: at(s.start), end: at(s.end) }))
    .sort((a, b) => a.start - b.start);
}

function timeText(ms){
  const d = new Date(ms);
  return `${d.getHours() % 12 || 12}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}
const minsText = (m) => m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.max(1, m)} min`;

/* ----- Small things ----- */
let toastTimer = null;
function toast(text){
  const el = document.getElementById('toast');
  el.textContent = text; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// Placeholder rows while something loads (see .skel in app.css). round: an avatar instead of a badge.
function skeletonRows(n, round){
  const widths = [68, 52, 74, 58, 63, 47];
  return Array.from({ length: n }, (_, i) => `<div class="row skel-row"><div class="skel skel-badge ${round ? 'round' : ''}"></div>
    <div class="txt"><div class="skel skel-line" style="width:${widths[i % widths.length]}%"></div><div class="skel skel-line sm"></div></div></div>`).join('');
}

const CHECK_SVG = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
