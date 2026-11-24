// Draws the floating island from what the main process sends:
//   state  - a snapshot from the app: timer, classes, mail, quote, the
//            latest message, channels and workspaces
//   media  - what Windows says is playing
//   update - an app update that is available, downloading or ready
//   nudge  - a suggestion to take a break
// The compact line shows the single most relevant thing; hovering opens a
// panel with a row for everything that's active, and a box to type in.

const $ = (id) => document.getElementById(id);
const PLAY_ICON = '<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24"><path d="M8 5v14"/><path d="M16 5v14"/></svg>';
const SOON_MINUTES = 30;          // a class this close takes over the compact line
const MESSAGE_FRESH_MS = 12000;   // a new message holds the compact line this long

let state = null;
let media = { status: 'none', title: '', artist: '' };
let update = null;
let nudge = null;
let mini = false;                 // another app's maximised window is in front: show as a small handle
let composeMode = 'note';         // 'note' | 'task' | a channel id
let composing = false;            // the text box has the keyboard
let hovering = false;
let sentNote = '';                // brief confirmation shown in the text box
let sentTimer = null;

const pad = (n) => String(n).padStart(2, '0');
const mmss = (seconds) => `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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

// What the text box can do right now: notes and tasks if quick capture is
// on, plus one entry per message channel.
function composeModes(){
  const modes = [];
  if(state.capture) modes.push({ id: 'note', label: 'Note', placeholder: 'Jot a quick note…', button: 'Add' }, { id: 'task', label: 'Task', placeholder: 'Add a task…', button: 'Add' });
  for(const c of state.channels || []) modes.push({ id: c.id, label: c.name, placeholder: `Message ${c.name}…`, button: 'Send' });
  return modes;
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
  const messages = state.messages || [];
  const message = messages[0];                       // the newest
  const freshMessage = message && Date.now() - message.at < MESSAGE_FRESH_MS;
  const unread = state.unreadCount || 0;
  const more = unread > 1 ? `+${unread - 1}` : '';
  const updateReady = update && update.state === 'downloaded';
  const presence = (state.presence || []).filter(p => p.until > Date.now());
  const countdowns = state.countdowns || [];
  const soon = countdowns.find(c => c.soon);

  // --- Compact line: the first of these that applies ---
  let text, side = '', pulse = false;
  if(freshMessage){
    text = `${message.from}: ${message.text}`; side = more; pulse = true;
  } else if(state.timer.running){
    text = state.timer.mode === 'break' ? 'Break' : 'Focus'; side = mmss(seconds); pulse = true;
  } else if(nudge){
    text = 'Time for a short break';
  } else if(cls && cls.on){
    text = cls.subject; side = `${awayText(cls.minutes)} left`; pulse = true;
  } else if(cls && cls.minutes <= SOON_MINUTES){
    text = cls.subject; side = `in ${awayText(cls.minutes)}`;
  } else if(message){
    text = `${message.from}: ${message.text}`; side = more;
  } else if(playing && hasMedia){
    text = media.title || media.artist; side = state.musicBars ? '' : '♪';
  } else if(updateReady){
    text = `Update ${update.version} is ready`;
  } else if(update && update.state === 'available'){
    text = `Update ${update.version} available`;
  } else if(soon){
    text = soon.title; side = soon.text;
  } else if(state.mail.count){
    text = state.mail.count === 1 ? state.mail.latest.subject : `${state.mail.count} important emails`;
  } else {
    text = state.quote; side = clock(Date.now());
  }
  // The music look (wave, bars or glow): the whole island moves with the music while it plays.
  const look = state.musicLook || 'off';
  const lookActive = look !== 'off' && playing && !!hasMedia;
  // When the line would only show the song anyway, the whole pill becomes the visualiser (the name is a hover away).
  const isOpen = $('island').classList.contains('open');
  const full = lookActive && text === (media.title || media.artist);
  $('island').classList.toggle('viz', full);
  IslandLook.update({ look, colors: state.musicColors || 'album', accent: state.accent, active: lookActive,
    open: isOpen, mini: (mini && !freshMessage) || full, nudging: !!nudge });
  // Little bars that dance to the music, beside the track name (not while the island itself moves).
  const showEq = !!(state.musicBars && !lookActive && playing && hasMedia && text === (media.title || media.artist));
  $('pill-eq').hidden = !showEq;
  setEqRunning(showEq);
  $('pill-text').textContent = text;
  $('pill-side').textContent = side;
  $('pill-dot').classList.toggle('pulse', pulse);
  $('pill-dot').classList.toggle('beat', !!(freshMessage && message.nudge)); // a nudge arrives with a heartbeat
  // A break nudge is a slow glow around the island, nothing more.
  $('island').classList.toggle('nudging', !!nudge);
  // As a handle it still opens on hover, and a new message brings the full line back for a moment.
  $('island').classList.toggle('mini', mini && !freshMessage);

  // --- Panel rows ---
  $('row-update').hidden = !update;
  if(update){
    const button = $('update-button');
    if(update.state === 'available'){
      $('update-label').textContent = 'Update available'; $('update-title').textContent = `Version ${update.version}`;
      button.hidden = false; button.textContent = 'Download'; button.dataset.action = 'update-download';
    } else if(update.state === 'downloading'){
      $('update-label').textContent = 'Downloading update'; $('update-title').textContent = `Version ${update.version} · ${Math.round(update.percent || 0)}%`;
      button.hidden = true;
    } else {
      $('update-label').textContent = 'Update ready'; $('update-title').textContent = `Version ${update.version}`;
      button.hidden = false; button.textContent = 'Restart'; button.dataset.action = 'update-install';
    }
  }

  $('row-nudge').hidden = !nudge;
  if(nudge) $('nudge-label').textContent = `You've been at it for about ${awayText(nudge.minutes)}`;

  $('row-message').hidden = !message;
  if(message){
    $('message-label').textContent = unread === 1 ? '1 new message' : `${unread} new messages`;
    const shown = messages.slice(0, 4);
    setHtml('message-list', shown.map(m => `
      <div class="msg-card ${m.channelId ? 'can-reply' : ''}" ${m.channelId ? `data-reply="${escapeHtml(m.channelId)}" title="Reply on ${escapeHtml(m.channel)}"` : ''}>
        <div class="msg-card-head"><span>${escapeHtml(m.from)}<span class="dim">${m.channel !== m.from ? ' · ' + escapeHtml(m.channel) : ''} · ${clock(m.ts)}</span></span>
          <button class="x" data-action="message-read" data-id="${escapeHtml(m.id)}" aria-label="Dismiss">×</button></div>
        <div class="msg-card-text">${escapeHtml(m.text)}</div>
      </div>`).join('') + (unread > shown.length ? `<div class="dim small">and ${unread - shown.length} more on the Messages page</div>` : ''));
  }

  $('row-presence').hidden = !presence.length;
  setHtml('presence-lines', presence.map(p => {
    const minutes = Math.max(1, Math.ceil((p.until - Date.now()) / 60000));
    return `<div class="line"><span>${escapeHtml(p.from)}</span><span class="dim">${p.state === 'break' ? 'on a break' : 'focusing'} · ${awayText(minutes)} left</span></div>`;
  }).join(''));

  $('row-countdowns').hidden = !countdowns.length;
  setHtml('countdown-lines', countdowns.map(c => `<div class="line"><span>${escapeHtml(c.title)}${c.shared ? ' <i class="shared" title="Shared">♥</i>' : ''}</span><span class="dim">${escapeHtml(c.text)}</span></div>`).join(''));

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
    const toggleIcon = playing ? PAUSE_ICON : PLAY_ICON;
    if($('media-toggle').dataset.icon !== toggleIcon){ $('media-toggle').innerHTML = toggleIcon; $('media-toggle').dataset.icon = toggleIcon; }
    const over = state.visualizerLayer === 'top';
    $('viz-layer').hidden = !state.visualizer || state.visualizer === 'off';
    $('viz-layer').classList.toggle('on', over);
    $('viz-layer').title = over ? 'Put the visualiser back on the wallpaper' : 'Show the visualiser over your windows';
    const lookOn = look !== 'off';
    $('look-toggle').classList.toggle('on', lookOn);
    $('look-toggle').title = lookOn ? 'Stop the island moving with the music' : 'Make the island move with the music';
  }

  $('row-mail').hidden = !state.mail.count;
  if(state.mail.count){
    $('mail-label').textContent = state.mail.count === 1 ? '1 important email' : `${state.mail.count} important emails`;
    $('mail-title').textContent = state.mail.latest.subject;
    $('mail-from').textContent = state.mail.latest.from;
  }

  const workspaces = state.workspaces || [];
  $('row-workspaces').hidden = !workspaces.length;
  setHtml('workspace-buttons', workspaces.map(w => `<button class="chip" data-action="open-workspace" data-id="${escapeHtml(w.id)}">${escapeHtml(w.name)}</button>`).join(''));

  $('quote-text').textContent = `“${state.quote}”`;
  $('quote-author').textContent = state.quoteAuthor || '';

  // --- Text box ---
  const modes = composeModes();
  $('row-compose').hidden = !modes.length;
  if(modes.length){
    const mode = modes.find(m => m.id === composeMode) || modes[0];
    composeMode = mode.id;
    setHtml('compose-modes', modes.map(m => `<button class="chip ${m.id === mode.id ? 'active' : ''}" data-mode="${escapeHtml(m.id)}">${escapeHtml(m.label)}</button>`).join(''));
    // One-tap phrases, only while a channel is chosen
    const isChannel = mode.id !== 'note' && mode.id !== 'task';
    // While writing to a channel, its last few messages show above the box, so a reply has its context.
    const thread = isChannel ? ((state.threads || {})[mode.id] || []) : [];
    setHtml('compose-thread', thread.map(t => `<div class="bubble ${t.mine ? 'mine' : ''}"><span class="who">${escapeHtml(t.from)}</span> ${escapeHtml(t.text)}</div>`).join(''));
    setHtml('compose-nudges', isChannel ? (state.nudges || []).map(n => `<button class="chip nudge" data-nudge="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join('') : '');
    $('compose-input').placeholder = sentNote || mode.placeholder;
    $('compose-send').textContent = mode.button;
  }
}

// Only touch the page when the markup really changed, so buttons aren't
// replaced under the pointer twice a second.
function setHtml(id, html){
  const el = $(id);
  if(el.dataset.html !== html){ el.innerHTML = html; el.dataset.html = html; }
}

// --- Music bars ---
// They listen only while they're showing; with no sound to hear (or if
// listening isn't allowed) they move by themselves instead.
let eqRunning = false;
const eqBars = Array.from(document.querySelectorAll('#pill-eq i'));
let eqSmooth = [0, 0, 0, 0];
function eqFrame(){
  if(!eqRunning) return;
  requestAnimationFrame(eqFrame);
  let v;
  if(PCCAudio.listening){
    const b = PCCAudio.bands(4);
    v = b.map((x, i) => Math.min(1, Math.pow(x, 1.4) * (i ? 1.15 : 1)));
  } else {
    const t = performance.now() / 1000;
    v = eqBars.map((_, i) => 0.35 + 0.3 * Math.sin(t * (3 + i) + i));
  }
  eqSmooth = eqSmooth.map((s, i) => v[i] > s ? s + (v[i] - s) * 0.55 : s * 0.85 + v[i] * 0.15);
  eqBars.forEach((bar, i) => { bar.style.transform = `scaleY(${0.15 + eqSmooth[i] * 0.85})`; });
}
// Listening goes on for as long as music plays (and a few seconds after), even
// while the bars are hidden, so they don't have to start up again each time
// they reappear. Starting to listen is the slow part.
let eqStopTimer = null;
function setEqRunning(on){
  const playing = media.status === 'playing' && !!(state && (state.musicBars || (state.musicLook && state.musicLook !== 'off')));
  if(playing){ clearTimeout(eqStopTimer); eqStopTimer = null; PCCAudio.start(); }
  else if(PCCAudio.listening && !eqStopTimer) eqStopTimer = setTimeout(() => { eqStopTimer = null; PCCAudio.stop(); }, 8000);
  if(on === eqRunning) return;
  eqRunning = on;
  if(on) requestAnimationFrame(eqFrame);
}

window.island.onState((next) => { state = next; render(); });
window.island.onMedia((next) => { media = next; render(); });
window.island.onUpdate((next) => { update = next; render(); });
window.island.onNudge((next) => { nudge = next; render(); });
window.island.onMini((next) => { mini = next; render(); });
window.island.onCover((url) => { const img = $('media-cover'); img.hidden = !url; if(url) img.src = url; else img.removeAttribute('src'); IslandLook.cover(url); });
if(window.island.onPerf) window.island.onPerf((profile) => IslandLook.perf(profile));
window.island.onPosition((position) => { document.body.dataset.position = position; });
setInterval(render, 500); // keeps countdowns and the clock moving between snapshots

// --- Typing ---
// The island's window refuses keyboard focus so it can never steal typing
// from another app. Clicking the text box asks the main process to allow
// focus for as long as the box is in use.
const input = $('compose-input');

function startComposing(){
  if(composing) return;
  composing = true;
  window.island.setFocus(true);
  setTimeout(() => { input.focus(); $('row-compose').scrollIntoView({ block: 'end' }); }, 60); // once the window has the keyboard; the box sits at the bottom of the panel
}

function stopComposing(){
  if(!composing) return;
  composing = false;
  input.blur();
  window.island.setFocus(false);
  if(!hovering) closeIsland();
}

function submitCompose(){
  const text = input.value.trim();
  if(!text) return;
  if(composeMode === 'note') window.island.action({ type: 'quick-note', text });
  else if(composeMode === 'task') window.island.action({ type: 'quick-task', text });
  else window.island.action({ type: 'send-message', channelId: composeMode, text });
  input.value = '';
  sentNote = composeMode === 'note' ? 'Saved to Notes' : composeMode === 'task' ? 'Added to Tasks' : 'Sent';
  clearTimeout(sentTimer);
  sentTimer = setTimeout(() => { sentNote = ''; render(); }, 1800);
  render();
}

input.addEventListener('mousedown', startComposing);
input.addEventListener('keydown', (e) => {
  if(e.key === 'Enter') submitCompose();
  else if(e.key === 'Escape'){ input.value = ''; stopComposing(); }
});
window.addEventListener('blur', stopComposing); // clicked into another app

// Buttons
document.addEventListener('click', (e) => {
  const modeBtn = e.target.closest('[data-mode]');
  if(modeBtn){ composeMode = modeBtn.dataset.mode; render(); return startComposing(); }
  if(e.target.closest('#compose-send')) return submitCompose();
  const nudgeBtn = e.target.closest('[data-nudge]');
  if(nudgeBtn){
    window.island.action({ type: 'send-message', channelId: composeMode, text: nudgeBtn.dataset.nudge, kind: 'nudge' });
    sentNote = 'Sent'; clearTimeout(sentTimer); sentTimer = setTimeout(() => { sentNote = ''; render(); }, 1800);
    return render();
  }
  const card = e.target.closest('[data-reply]');
  if(card && !e.target.closest('.x')){ composeMode = card.dataset.reply; render(); return startComposing(); }
  const mediaBtn = e.target.closest('[data-media]');
  if(mediaBtn) return window.island.action({ type: 'media', command: mediaBtn.dataset.media });
  const btn = e.target.closest('[data-action]');
  if(btn) window.island.action({ type: btn.dataset.action, page: btn.dataset.page, id: btn.dataset.id, minutes: btn.dataset.minutes });
});

// Open once the pointer has rested on the island for a moment. Until then
// the window ignores the mouse completely, so passing over the island on
// the way to a browser tab doesn't open it, and a click goes to whatever is
// underneath.
const OPEN_DELAY_MS = 280;
const islandEl = $('island');
let closeTimer = null;
let openTimer = null;

function closeIsland(){
  window.island.setHover(false);
  closeTimer = setTimeout(() => islandEl.classList.remove('open'), 220);
}

islandEl.addEventListener('mouseenter', () => {
  hovering = true;
  clearTimeout(closeTimer);
  if(islandEl.classList.contains('open')){ window.island.setHover(true); return; } // came back before it closed
  clearTimeout(openTimer);
  openTimer = setTimeout(() => {
    window.island.setHover(true);
    islandEl.classList.add('open');
  }, OPEN_DELAY_MS);
});
islandEl.addEventListener('mouseleave', () => {
  hovering = false;
  clearTimeout(openTimer);
  if(!composing) closeIsland(); // stays open while you're typing in it
});
// While typing, the whole window takes clicks; one outside the island ends it.
document.addEventListener('mousedown', (e) => { if(composing && !e.target.closest('#island')) stopComposing(); });
