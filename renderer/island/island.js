// Draws the floating island from two inputs sent by the main process:
//   state  - a snapshot from the app: timer, current / next class, mail, quote
//   media  - what Windows says is playing
// The compact line shows the single most relevant thing; hovering opens a
// panel with a row for everything that's active.

const $ = (id) => document.getElementById(id);
const PLAY_ICON = '<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24"><path d="M8 5v14"/><path d="M16 5v14"/></svg>';
const SOON_MINUTES = 30; // a class this close takes over the compact line

let state = null;
let media = { status: 'none', title: '', artist: '' };

const pad = (n) => String(n).padStart(2, '0');
const mmss = (seconds) => `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;

function clock(ts){
  const d = new Date(ts);
  if(state && state.clock24) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${d.getHours() % 12 || 12}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

function timerSeconds(){
  const t = state.timer;
  return t.running ? Math.max(0, Math.ceil((t.endsAt - Date.now()) / 1000)) : t.remaining;
}

// The class to feature: one that is on now, otherwise the next one today.
function featuredClass(){
  const now = Date.now();
  const list = (state.classes || []).filter(c => c.end > now);
  const current = list.find(c => c.start <= now);
  if(current) return { ...current, on: true, minutes: Math.ceil((current.end - now) / 60000) };
  const next = list[0];
  return next ? { ...next, on: false, minutes: Math.ceil((next.start - now) / 60000) } : null;
}

function awayText(minutes){
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

function render(){
  if(!state) return;
  const root = document.documentElement;
  root.style.setProperty('--accent', state.accent);
  root.style.setProperty('--accent-ink', state.accentInk);

  const cls = featuredClass();
  const playing = media.status === 'playing';
  const hasMedia = media.status !== 'none' && (media.title || media.artist);
  const seconds = timerSeconds();

  // --- Compact line: the first of these that applies ---
  let text, side = '', pulse = false;
  if(state.timer.running){
    text = state.timer.mode === 'break' ? 'Break' : 'Focus'; side = mmss(seconds); pulse = true;
  } else if(cls && cls.on){
    text = cls.subject; side = `${awayText(cls.minutes)} left`; pulse = true;
  } else if(cls && cls.minutes <= SOON_MINUTES){
    text = cls.subject; side = `in ${awayText(cls.minutes)}`;
  } else if(playing && hasMedia){
    text = media.title || media.artist; side = '♪';
  } else if(state.mail.count){
    text = state.mail.count === 1 ? state.mail.latest.subject : `${state.mail.count} important emails`;
  } else {
    text = state.quote; side = clock(Date.now());
  }
  $('pill-text').textContent = text;
  $('pill-side').textContent = side;
  $('pill-dot').classList.toggle('pulse', pulse);

  // --- Panel rows ---
  $('timer-label').textContent = state.timer.running ? (state.timer.mode === 'break' ? 'Break' : 'Focus session') : 'Focus timer';
  $('timer-time').textContent = mmss(seconds);
  $('timer-toggle').textContent = state.timer.running ? 'Pause' : 'Start';

  $('row-class').hidden = !cls;
  if(cls){
    $('class-label').textContent = cls.on ? `On now · ends ${clock(cls.end)}` : `Next class · ${clock(cls.start)} (in ${awayText(cls.minutes)})`;
    $('class-title').textContent = cls.subject;
    $('class-sub').textContent = cls.room || '';
  }

  $('row-media').hidden = !hasMedia;
  if(hasMedia){
    $('media-label').textContent = playing ? 'Playing' : 'Paused';
    $('media-title').textContent = media.title || 'Unknown track';
    $('media-artist').textContent = media.artist || '';
    $('media-toggle').innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
  }

  $('row-mail').hidden = !state.mail.count;
  if(state.mail.count){
    $('mail-label').textContent = state.mail.count === 1 ? '1 important email' : `${state.mail.count} important emails`;
    $('mail-title').textContent = state.mail.latest.subject;
    $('mail-from').textContent = state.mail.latest.from;
  }

  $('quote-text').textContent = `“${state.quote}”`;
}

window.island.onState((next) => { state = next; render(); });
window.island.onMedia((next) => { media = next; render(); });
window.island.onPosition((position) => { document.body.dataset.position = position; });
setInterval(render, 500); // keeps countdowns and the clock moving between snapshots

// Buttons
document.addEventListener('click', (e) => {
  const mediaBtn = e.target.closest('[data-media]');
  if(mediaBtn) return window.island.action({ type: 'media', command: mediaBtn.dataset.media });
  const btn = e.target.closest('[data-action]');
  if(btn) window.island.action({ type: btn.dataset.action, page: btn.dataset.page });
});

// Open while the pointer is over the island. The window ignores the mouse
// everywhere else, so apps underneath stay clickable.
const islandEl = $('island');
let closeTimer = null;
islandEl.addEventListener('mouseenter', () => {
  clearTimeout(closeTimer);
  window.island.setHover(true);
  islandEl.classList.add('open');
});
islandEl.addEventListener('mouseleave', () => {
  window.island.setHover(false);
  closeTimer = setTimeout(() => islandEl.classList.remove('open'), 220);
});
