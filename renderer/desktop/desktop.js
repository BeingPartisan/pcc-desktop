// Desktop mode dashboard. Draws whatever the app last sent; keeps its own
// clock and class countdowns ticking between updates.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let state = null, media = null, cover = '', active = true, stats = null;
const TASK_LIMIT = 4, DEADLINE_LIMIT = 3, INBOX_LIMIT = 3;
const DAY_MS = 86400000;

// ---------- layout: room for the island, the taskbar and the desktop icons ----------
function applyLayout(l){
  const root = document.documentElement.style;
  const ICON_ROOM = 210;          // about two columns of desktop icons
  root.setProperty('--top', (l.inset.top + 92) + 'px');
  root.setProperty('--bottom', (l.inset.bottom + 36) + 'px');
  root.setProperty('--left', (l.inset.left + (l.icons === 'left' || l.icons === 'both' ? ICON_ROOM : 48)) + 'px');
  root.setProperty('--right', (l.inset.right + (l.icons === 'right' || l.icons === 'both' ? ICON_ROOM : 48)) + 'px');
  settle();
}

// ---------- frosted glass ----------
// Where the wallpaper picture sits on the screen, worked out the way Windows
// fits it, so each card can show the blurred part that's really behind it.
let wallpaper = null;
function applyWallpaper(wp){
  wallpaper = wp;
  const root = document.documentElement.style;
  if(!wp || !wp.url){ document.body.classList.add('no-wp'); root.setProperty('--wp-img', 'none'); return; }
  const img = new Image();
  img.onload = () => {
    const W = innerWidth, H = innerHeight;
    // Windows sizes "center" and "tile" in real pixels; this page works in scaled ones.
    let iw = img.naturalWidth, ih = img.naturalHeight, w, h;
    if(wp.fit === 'stretch'){ w = W; h = H; }
    else if(wp.fit === 'center' || wp.fit === 'tile'){ w = iw / devicePixelRatio; h = ih / devicePixelRatio; }
    else { const s = wp.fit === 'fit' ? Math.min(W / iw, H / ih) : Math.max(W / iw, H / ih); w = iw * s; h = ih * s; }
    const x = wp.fit === 'tile' ? 0 : (W - w) / 2, y = wp.fit === 'tile' ? 0 : (H - h) / 2;
    root.setProperty('--wp-img', `url("${wp.url}")`);
    root.setProperty('--wp-size', `${w}px ${h}px`);
    root.setProperty('--wp-x', `${x}px`); root.setProperty('--wp-y', `${y}px`);
    root.setProperty('--wp-repeat', wp.fit === 'tile' ? 'repeat' : 'no-repeat');
    document.body.classList.remove('no-wp');
    placeGlass();
  };
  img.onerror = () => { document.body.classList.add('no-wp'); root.setProperty('--wp-img', 'none'); };
  img.src = wp.url;
}
function placeGlass(){
  document.querySelectorAll('.glass').forEach(el => {
    const r = el.getBoundingClientRect();
    el.style.setProperty('--px', r.left + 'px');
    el.style.setProperty('--py', r.top + 'px');
  });
}

// When a column has more than fits, the cards marked data-drop give way, lowest number first.
function fitColumns(){
  document.querySelectorAll('.col').forEach(col => {
    const droppable = [...col.querySelectorAll('[data-drop]')].sort((a, b) => a.dataset.drop - b.dataset.drop);
    droppable.forEach(el => { el.style.display = ''; });
    for(const el of droppable){
      if(col.scrollHeight <= col.clientHeight + 1) break;
      if(!el.hidden) el.style.display = 'none';
    }
  });
}
// The timeline's line stops at the last class's dot.
function endTimeline(){
  const last = document.querySelector('.tl:last-child');
  if(last) $('timeline').style.setProperty('--tail', (last.offsetHeight - 14) + 'px');
}
// After anything changes size: make room, then line the glass up again.
let settleQueued = false;
function settle(){
  if(settleQueued) return; settleQueued = true;
  requestAnimationFrame(() => { settleQueued = false; fitColumns(); placeGlass(); endTimeline(); });
}
window.addEventListener('resize', () => { if(wallpaper) applyWallpaper(wallpaper); settle(); });

// ---------- time ----------
const pad = (n) => (n < 10 ? '0' : '') + n;
function timeText(ms, withAmPm = true){
  const d = new Date(ms);
  if(state && state.clock24) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${d.getHours() % 12 || 12}:${pad(d.getMinutes())}` + (withAmPm ? (d.getHours() < 12 ? ' AM' : ' PM') : '');
}
const minsText = (mins) => mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${Math.max(1, mins)} min`;
const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAway = (dateStr) => Math.round((new Date(dateStr + 'T00:00') - startOfDay()) / DAY_MS);

function renderClock(){
  const now = new Date();
  const h = state && state.clock24 ? pad(now.getHours()) : String(now.getHours() % 12 || 12);
  $('clock').innerHTML = `${h}<span class="colon">:</span>${pad(now.getMinutes())}`
    + (state && state.clock24 ? '' : `<span class="ampm">${now.getHours() < 12 ? 'AM' : 'PM'}</span>`);
  $('date').textContent = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const hr = now.getHours();
  const g = hr < 5 ? 'Still up' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : hr < 21 ? 'Good evening' : 'Good night';
  $('greeting').innerHTML = esc(g) + (state && state.name ? `, <em>${esc(state.name)}</em>` : '');
  renderNext();
}

// The one thing to know next: a running timer, the class on now or next, or the nearest deadline.
function renderNext(){
  if(!state) return;
  const now = Date.now();
  let html = '';
  const t = state.timer;
  const cls = (state.classes || []).find(c => now < c.end);
  if(t && t.running && t.endsAt){
    const left = Math.max(0, Math.round((t.endsAt - now) / 1000));
    html = `<span class="k">${t.mode === 'focus' ? 'Focusing' : 'On a break'}</span><b>${pad(Math.floor(left / 60))}:${pad(left % 60)}</b><span class="k">left</span>`;
  } else if(cls && now >= cls.start){
    html = `<span class="k">Now</span><b class="t">${esc(cls.subject)}</b><span class="k">until ${timeText(cls.end)}</span>`;
  } else if(cls){
    html = `<span class="k">Next</span><b class="t">${esc(cls.subject)}</b><span class="k">in ${minsText(Math.round((cls.start - now) / 60000))}${cls.room ? ' · ' + esc(cls.room) : ''}</span>`;
  } else {
    const d = (state.deadlines || []).find(x => daysAway(x.date) >= 0);
    if(d){ const n = daysAway(d.date); html = `<span class="k">Due ${n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`}</span><b class="t">${esc(d.title)}</b>`; }
  }
  $('next').hidden = !html;
  if(html) $('next').innerHTML = `<span class="pulse"></span>${html}`;
}

// ---------- left: today, tasks, coming up ----------
function renderToday(){
  const list = state.classes || [];
  $('p-today').hidden = !list.length;
  if(!list.length) return;
  const now = Date.now();
  let nextMarked = false;
  const left = list.filter(c => now < c.end).length;
  $('today-label').textContent = 'Today';
  $('today-side').textContent = left ? `${left} of ${list.length} to go` : 'all done';
  $('timeline').innerHTML = list.map(c => {
    let cls = '', meta = esc(c.room || ''), extra = '';
    if(now >= c.end) cls = 'past';
    else if(now >= c.start){
      cls = 'now';
      const pct = Math.round((now - c.start) / (c.end - c.start) * 100);
      meta = `Now · ${minsText(Math.round((c.end - now) / 60000))} left${c.room ? ' · ' + esc(c.room) : ''}`;
      extra = `<div class="tl-progress"><i style="width:${pct}%"></i></div>`;
    } else if(!nextMarked){ nextMarked = true; cls = 'next'; meta = `In ${minsText(Math.round((c.start - now) / 60000))}${c.room ? ' · ' + esc(c.room) : ''}`; }
    return `<div class="tl ${cls}"><div class="tl-time">${timeText(c.start, false)}</div><div class="tl-dot"></div>
      <div class="tl-body"><div class="tl-subject">${esc(c.subject)}</div>${meta ? `<div class="tl-meta">${meta}</div>` : ''}${extra}</div></div>`;
  }).join('');
}

function renderTasks(){
  const tasks = state.tasks || [];
  $('p-tasks').hidden = !tasks.length;
  $('task-count').textContent = state.taskCount ? `${state.taskCount} open` : '';
  $('tasks').innerHTML = tasks.slice(0, TASK_LIMIT).map(t =>
    `<div class="task"><span class="ring ${esc(t.priority || 'med')}"></span><span class="txt">${esc(t.text)}</span></div>`).join('')
    + (state.taskCount > TASK_LIMIT ? `<div class="more">and ${state.taskCount - TASK_LIMIT} more</div>` : '');
}

function renderDeadlines(){
  const items = (state.deadlines || []).filter(a => daysAway(a.date) >= 0);
  $('p-deadlines').hidden = !items.length;
  $('deadlines').innerHTML = items.slice(0, DEADLINE_LIMIT).map(a => {
    const n = daysAway(a.date);
    const date = new Date(a.date + 'T00:00');
    const when = n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
    const badge = n === 0 ? '<b>!</b><small>TODAY</small>' : `<b>${n}</b><small>${n === 1 ? 'DAY' : 'DAYS'}</small>`;
    return `<div class="deadline"><div class="badge ${n === 0 ? 'today' : n <= 2 ? 'soon' : ''}">${badge}</div>
      <div class="txt"><div class="title">${esc(a.title)}</div><div class="when">${when}</div></div></div>`;
  }).join('');
}

// ---------- middle: week, inbox, countdowns, quote ----------
function renderWeek(){
  const today = startOfDay();
  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const due = {};
  for(const d of state.deadlines || []) due[d.date] = (due[d.date] || 0) + 1;
  $('p-week').innerHTML = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    const key = dateKey(d);
    const cls = key === dateKey(today) ? 'today' : d < today ? 'past' : '';
    const dots = Array.from({ length: Math.min(3, due[key] || 0) }, () => '<i></i>').join('');
    return `<div class="day ${cls}"><div class="wd">${d.toLocaleDateString(undefined, { weekday: 'short' })}</div><div class="dn">${d.getDate()}</div><div class="dots">${dots}</div></div>`;
  }).join('');
}

const AVATAR_HUES = [28, 200, 150, 280, 340, 90, 50, 250];
function avatar(name){
  const s = String(name || '?');
  let h = 0; for(const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `<div class="avatar" style="background:hsl(${AVATAR_HUES[h % AVATAR_HUES.length]} 70% 72%)">${esc(s.trim().charAt(0).toUpperCase() || '?')}</div>`;
}
function renderInbox(){
  const rows = [];
  for(const m of state.mail || []) rows.push(`<div class="msg">${avatar(m.from)}<div class="body"><div class="title">${m.toYou ? '<span class="tag">To you</span>' : ''}${esc(m.subject)}</div><div class="sub">${esc(m.from)}</div></div></div>`);
  for(const m of state.messages || []) rows.push(`<div class="msg">${avatar(m.from)}<div class="body"><div class="title">${esc(m.text)}</div><div class="sub">${esc(m.from)}${m.channel ? ' · ' + esc(m.channel) : ''}</div></div><div class="time">${m.at ? timeText(m.at) : ''}</div></div>`);
  for(const p of state.presence || []) rows.push(`<div class="msg">${avatar(p.from)}<div class="body"><div class="title">${esc(p.from)} is ${p.state === 'break' ? 'on a break' : 'focusing'}</div><div class="sub">${p.until ? 'until ' + timeText(p.until) : ''}</div></div></div>`);
  $('p-inbox').hidden = !rows.length;
  $('inbox').innerHTML = rows.slice(0, INBOX_LIMIT).join('');
}

function renderCountdowns(){
  const list = (state.countdowns || []).slice(0, 3);
  $('p-countdowns').hidden = !list.length;
  $('p-countdowns').innerHTML = list.map(c => {
    const big = c.days === 0 ? 'Today' : c.days === 1 ? '1<small>day</small>' : `${c.days}<small>days</small>`;
    return `<div class="tile glass ${c.soon ? 'soon' : ''}"><div class="num">${big}</div><div class="what">${esc(c.title)}</div></div>`;
  }).join('');
}

function renderQuote(){
  $('p-quote').hidden = !state.quote;
  $('quote').textContent = state.quote ? `"${state.quote}"` : '';
  $('quote-by').textContent = state.quoteAuthor || '';
}

// ---------- right: weather, system, at a glance, music ----------
const WEATHER_ICONS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  partly: '<path d="M8 3v1.5M3.5 8H2M4.6 4.6l1 1M12.4 4.6l-1 1"/><path d="M5.3 10.2A3.5 3.5 0 0 1 11.6 7"/><path d="M7 20h10a4 4 0 0 0 0-8 5 5 0 0 0-9.6 1.3A3.4 3.4 0 0 0 7 20z"/>',
  cloud: '<path d="M7 19h10a4.5 4.5 0 0 0 .4-9 6 6 0 0 0-11.5 1.6A3.8 3.8 0 0 0 7 19z"/>',
  rain: '<path d="M7 15h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.4A3.4 3.4 0 0 0 7 15z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>',
  storm: '<path d="M7 14h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.4A3.4 3.4 0 0 0 7 14z"/><path d="M12 15l-2 4h3l-2 4"/>',
  snow: '<path d="M7 14h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.4A3.4 3.4 0 0 0 7 14z"/><path d="M8 18h.01M12 18h.01M16 18h.01M10 21h.01M14 21h.01"/>',
  fog: '<path d="M4 10h16M6 14h12M8 18h8"/>',
};
function weatherIcon(w){
  const c = w.code;
  const key = c === 0 ? (w.day ? 'sun' : 'moon') : c <= 2 ? 'partly' : c === 3 ? 'cloud' : c <= 48 ? 'fog' : c <= 67 || (c >= 80 && c <= 82) ? 'rain' : c <= 77 || c === 85 || c === 86 ? 'snow' : 'storm';
  return `<svg viewBox="0 0 24 24">${WEATHER_ICONS[key]}</svg>`;
}
function renderWeather(){
  const w = state.weather;
  $('weather').hidden = !w;
  if(w) $('weather').innerHTML = `${weatherIcon(w)}<b>${Math.round(w.temp)}°</b>${esc(w.text)}`;
}

const RING = 2 * Math.PI * 32;
function gauge(name, pct, text, cls = ''){
  const p = Math.max(0, Math.min(100, pct || 0));
  return `<div><div class="gauge ${cls}"><svg viewBox="0 0 76 76"><circle class="track" cx="38" cy="38" r="32"/>
    <circle class="fill" cx="38" cy="38" r="32" stroke-dasharray="${RING}" stroke-dashoffset="${RING * (1 - p / 100)}"/></svg>
    <div class="val">${text}</div></div><div class="gauge-name">${name}</div></div>`;
}
function speed(bytes){
  const bits = bytes * 8;
  return bits >= 1e6 ? `${(bits / 1e6).toFixed(bits >= 1e7 ? 0 : 1)} Mbps` : `${Math.round(bits / 1e3)} kbps`;
}
function renderStats(s){
  stats = s;
  const b = s.battery;
  $('gauges').innerHTML = gauge('CPU', s.cpu, `${s.cpu}%`, s.cpu > 85 ? 'hot' : '')
    + gauge('Memory', s.memory, `${s.memory}%`, s.memory > 90 ? 'hot' : '')
    + (b && !b.none ? gauge(b.charging ? 'Charging' : 'Battery', b.percent, `${b.percent}%`, !b.charging && b.percent <= 20 ? 'low' : '')
      : gauge('Power', 100, '<small>plugged in</small>'));
  $('network').textContent = navigator.onLine ? `↓ ${speed(s.down)}  ↑ ${speed(s.up)}` : 'offline';
}

function renderGlance(){
  const cells = [];
  const a = state.attendance;
  if(a) cells.push({ num: `${Math.round(a.pct)}%`, what: 'Attendance', cls: a.pct < a.target ? 'warn' : '' });
  const b = state.budget;
  if(b) cells.push({ num: `${b.left < 0 ? '-' : ''}₹${Math.abs(b.left).toLocaleString('en-IN')}`, what: b.left < 0 ? 'Over budget' : 'Left to spend', cls: b.left < 0 ? 'warn' : '' });
  const h = state.habits;
  if(h && h.total) cells.push({ num: `${h.done}/${h.total}`, what: 'Habits today', cls: h.done === h.total ? 'accent' : '' });
  if(h && h.streak) cells.push({ num: h.streak, what: 'Day streak', cls: 'accent' });
  if(state.mailCount) cells.push({ num: state.mailCount, what: 'Important mail', cls: '' });
  if(state.unread) cells.push({ num: state.unread, what: 'Unread messages', cls: '' });
  $('p-glance').hidden = !cells.length;
  $('glance').innerHTML = cells.slice(0, 4).map(c => `<div class="stat"><div class="num ${c.cls}">${esc(c.num)}</div><div class="what">${esc(c.what)}</div></div>`).join('');
}

function renderMusic(){
  const m = media;
  const on = m && m.status && m.status !== 'none' && m.title;
  $('p-music').hidden = !on;
  if(on){
    $('p-music').classList.toggle('playing', m.status === 'playing' && active);
    $('music-label').textContent = m.status === 'playing' ? 'Now playing' : 'Paused';
    $('music-app').textContent = m.app || '';
    $('track-title').textContent = m.title;
    $('track-artist').textContent = m.artist || '';
    $('cover').style.backgroundImage = cover ? `url("${cover}")` : '';
    $('p-music').classList.toggle('has-cover', !!cover);
    $('p-music').style.setProperty('--cover', cover ? `url("${cover}")` : 'none');
  }
  settle();
}

function renderUpdate(u){
  $('p-update').hidden = !u;
  if(u) $('update-text').textContent = u.state === 'downloaded' ? `PCC ${u.version || ''} is ready · restart from the island or tray`
    : u.state === 'downloading' ? `Downloading PCC ${u.version || ''}…` : `PCC ${u.version || ''} is available`;
  settle();
}

function renderAll(){
  if(!state) return;
  const accent = state.accent || '#C9F26C';
  document.documentElement.style.setProperty('--accent', accent);
  if(state.accentInk) document.documentElement.style.setProperty('--accent-ink', state.accentInk);
  $('desk').hidden = false;
  renderClock(); renderToday(); renderTasks(); renderDeadlines(); renderWeek(); renderInbox(); renderCountdowns(); renderQuote(); renderWeather(); renderGlance();
  if(!stats) $('gauges').innerHTML = gauge('CPU', 0, '–') + gauge('Memory', 0, '–') + gauge('Battery', 0, '–');
  settle();
}

// Equaliser bars with a little variety in height and timing.
$('eq').innerHTML = Array.from({ length: 26 }, (_, i) => `<i style="--h:${(0.4 + 0.6 * Math.abs(Math.sin(i * 1.7))).toFixed(2)}; animation-delay:-${(i * 0.13 % 1.1).toFixed(2)}s; animation-duration:${(0.75 + (i * 7 % 5) / 10).toFixed(2)}s"></i>`).join('');

// The clock ticks by itself; once a minute the timeline and week roll on. Nothing runs while covered.
setInterval(() => {
  if(!active || !state) return;
  renderClock();
  if(new Date().getSeconds() === 0){ renderToday(); renderDeadlines(); renderWeek(); settle(); }
}, 1000);
// Once the cards have faded in, line the glass up once more.
setTimeout(settle, 1200);

if(window.deskBridge){
  window.deskBridge.onLayout(applyLayout);
  window.deskBridge.onWallpaper(applyWallpaper);
  window.deskBridge.onState((s) => { state = s; renderAll(); });
  window.deskBridge.onMedia((m) => { media = m; renderMusic(); });
  window.deskBridge.onCover((c) => { cover = c || ''; renderMusic(); });
  window.deskBridge.onUpdate(renderUpdate);
  window.deskBridge.onStats(renderStats);
  window.deskBridge.onActive((on) => { active = on; document.body.classList.toggle('still', !on); if(on && state) renderAll(); renderMusic(); });
} else {
  // Opened on its own (for design work): sample data, and ?wp=<file URL> for a wallpaper.
  const at = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); };
  const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return dateKey(d); };
  const wp = new URLSearchParams(location.search).get('wp');
  if(wp){ document.body.style.background = `url("${wp}") center/cover`; applyWallpaper({ url: wp, fit: 'fill' }); }
  else { document.body.style.background = '#1d2a3a'; applyWallpaper(null); }
  applyLayout({ inset: { top: 0, left: 0, right: 0, bottom: 48 }, icons: 'left' });
  const now = new Date(); const hNow = now.getHours();
  state = {
    accent: '#C9F26C', accentInk: '#151A07', name: 'Aarav',
    classes: [{ subject: 'Law of torts', room: 'Hall 2', start: at(hNow - 2, 0), end: at(hNow - 1, 0) }, { subject: 'Contracts II', room: 'Hall 3', start: at(hNow, 0), end: at(hNow + 1, 0) }, { subject: 'Constitutional law', room: 'Hall 1', start: at(hNow + 1, 30), end: at(hNow + 2, 30) }, { subject: 'Legal methods', room: 'Hall 4', start: at(hNow + 3, 0), end: at(hNow + 4, 0) }],
    tasks: [{ text: 'Read Carlill notes', priority: 'high' }, { text: 'Draft moot memo', priority: 'med' }, { text: 'Return library books', priority: 'low' }, { text: 'Email the mess committee', priority: 'med' }], taskCount: 7,
    deadlines: [{ title: 'Torts project', date: inDays(0) }, { title: 'Contracts quiz', date: inDays(2) }, { title: 'Moot submission', date: inDays(5) }, { title: 'Family law essay', date: inDays(12) }],
    mail: [{ subject: 'Moot court allotment', from: 'Moot Court Society', toYou: true }],
    messages: [{ from: 'Riya', text: 'are you coming to the library?', channel: 'Friends', at: Date.now() - 600000 }],
    presence: [{ from: 'Arjun', state: 'focus', until: Date.now() + 3600000 }],
    countdowns: [{ title: 'End-sem exams', days: 23, soon: false }, { title: 'Riya\'s birthday', days: 4, soon: true }],
    quote: 'The life of the law has not been logic; it has been experience.', quoteAuthor: 'Oliver Wendell Holmes',
    attendance: { pct: 86, target: 75 }, budget: { left: 2340 }, habits: { done: 1, total: 2, streak: 12 }, unread: 1, mailCount: 1,
    weather: { city: 'Bengaluru', temp: 24, text: 'partly cloudy', code: 2, day: true, wind: 11 },
  };
  media = { status: 'playing', title: 'Midnight City', artist: 'M83', app: 'Spotify' };
  renderAll(); renderMusic();
  renderStats({ cpu: 21, memory: 58, battery: { percent: 76, charging: true }, down: 5200000, up: 400000 });
  renderUpdate({ state: 'available', version: '2.7.0' });
}
