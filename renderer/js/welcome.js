/* ---------- First-run welcome ---------- */
// Shown once, the first time PCC opens on a computer with no saved data.
// It fills the window and walks through eight short steps, each of which can
// be skipped, and everything in it can be changed later in Settings:
//   hello (or restore a backup from another computer), you, your colour,
//   classes, mail, your desktop, friends and start-up, done (then a tour).
// Most steps change settings as you go, so the window updates live.
//
// app.js decides whether this is a first run (before anything is saved) and
// sets WELCOME_PENDING_KEY; it stays set until the welcome is finished, so
// closing the app halfway brings it back next time.

const WELCOME_PENDING_KEY = '__welcomePending';
const WELCOME_STEPS = ['hello', 'you', 'look', 'classes', 'mail', 'desktop', 'friends', 'done'];
const WELCOME_VIZ_STYLES = [['bars', 'Bars'], ['wave', 'Wave'], ['ring', 'Ring'], ['nebula', 'Nebula'], ['orbit', 'Orbit'], ['album', 'Album art']];
let welcomeStep = 0;
let welcomeLaterPage = null;   // a Settings tab to open when the welcome closes ("type my timetable in later")
let welcomeWeatherTimer = null;
let welcomeOnLaptop = false;
let welcomeMailOk = false;       // mail signed in on the Mail step

function showWelcome(){
  welcomeStep = 0;
  document.getElementById('welcome-overlay').classList.add('open');
  // A laptop gets a word about battery on the desktop step. (A desktop PC reports itself as always charging and full.)
  if(navigator.getBattery) navigator.getBattery().then(b => { welcomeOnLaptop = !(b.charging && b.level === 1 && b.chargingTime === 0); renderWelcome(); }).catch(() => {});
  renderWelcome();
}

function renderWelcome(){
  const step = WELCOME_STEPS[welcomeStep];
  document.querySelectorAll('.wl-step').forEach(el => el.classList.toggle('active', el.dataset.step === step));
  document.getElementById('welcome-progress').innerHTML = WELCOME_STEPS.slice(1).map((s, i) => `<i class="${i < welcomeStep ? 'on' : ''}"></i>`).join('');
  document.getElementById('welcome-progress').style.visibility = step === 'hello' ? 'hidden' : 'visible';
  // The first and last steps have their own buttons.
  document.getElementById('welcome-foot').style.display = step === 'hello' || step === 'done' ? 'none' : '';
  document.getElementById('welcome-next-btn').textContent = step === 'friends' ? 'Finish' : 'Continue';

  const p = prefs();
  document.querySelectorAll('#welcome-clock button').forEach(b => b.classList.toggle('active', (b.dataset.value === '24') === !!p.clock24));
  document.querySelectorAll('#welcome-theme button').forEach(b => b.classList.toggle('active', b.dataset.value === (p.theme || 'dark')));
  document.getElementById('welcome-swatches').innerHTML = ACCENT_PRESETS.map(a => `
    <button class="wl-swatch ${!p.accentFromWindows && a.value.toLowerCase() === String(p.accent).toLowerCase() ? 'active' : ''}" style="--c:${a.value}" onclick="setAccent('${a.value}'); renderWelcome()">
      <i></i><span>${esc(a.name)}</span></button>`).join('');

  renderWelcomeCampus();
  document.getElementById('welcome-island').checked = !!p.islandEnabled;
  document.getElementById('welcome-viz').checked = p.visualizer !== 'off';
  document.getElementById('welcome-viz-styles').innerHTML = WELCOME_VIZ_STYLES.map(([value, label]) =>
    `<button class="${p.visualizer === value ? 'on' : ''}" onclick="welcomeVisualizer(true, '${value}')">${label}</button>`).join('');
  document.getElementById('welcome-desk').checked = !!p.desktopMode;
  document.getElementById('welcome-desk-icons').style.display = p.desktopMode ? '' : 'none';
  document.getElementById('welcome-desk-note').textContent = p.desktopMode ? 'Where are your desktop icons? The dashboard leaves them room.' : 'A dashboard on your wallpaper, under your icons.';
  const modeName = { saver: 'Battery saver', balanced: 'Balanced', best: 'Best quality' }[p.perfMode] || 'Balanced';
  document.getElementById('welcome-perf-title').textContent = `Performance: ${modeName}`;
  document.getElementById('welcome-perf-note').textContent = welcomeOnLaptop
    ? 'Picked for your laptop: lighter whenever you\'re on battery.'
    : 'How smooth the visualiser and dashboard are. You can change it any time.';
  renderAppearanceSettings();   // the segmented controls with data-pref, here and in Settings
  if(step === 'done') renderWelcomeChecklist();

  // Put the cursor where it's useful.
  const focus = { you: 'welcome-name', mail: 'welcome-mail', friends: 'welcome-code' }[step];
  if(focus) setTimeout(() => { const el = document.getElementById(focus); if(el && !el.value) el.focus(); }, 60);
}

function welcomeBack(){ if(welcomeStep){ welcomeStep--; renderWelcome(); } }
function welcomeSkip(){ welcomeStep = Math.min(WELCOME_STEPS.length - 1, welcomeStep + 1); renderWelcome(); }

function welcomeNext(){
  const step = WELCOME_STEPS[welcomeStep];
  if(step === 'you'){
    const name = document.getElementById('welcome-name').value.trim();
    const city = document.getElementById('welcome-city').value.trim();
    if(name){ updateSettings('name', name); document.getElementById('set-name').value = name; }
    if(city){ updateSettings('weatherCity', city); document.getElementById('set-city').value = city; }
  }
  welcomeSkip();
}

function finishWelcome(){
  localStorage.removeItem(WELCOME_PENDING_KEY);
  document.getElementById('welcome-overlay').classList.remove('open');
  if(welcomeLaterPage){ const page = welcomeLaterPage; welcomeLaterPage = null; openSettingsAt(page); }
}

// A link on the Done step: close the welcome and go there.
function welcomeGo(where){
  finishWelcome();
  if(where === 'messages') navigate('messages'); else openSettingsAt(where);
}

/* ----- Hello: restore from another computer ----- */
// The same as Settings > Data > Import. The app restarts with the restored data,
// so the welcome is marked done first (the backup holds a set-up PCC).
async function welcomeRestore(){
  localStorage.removeItem(WELCOME_PENDING_KEY);
  await importData();
  // Still here: the restore was cancelled, so the welcome carries on.
  localStorage.setItem(WELCOME_PENDING_KEY, '1');
}

/* ----- You ----- */
function welcomeWeatherSoon(){
  clearTimeout(welcomeWeatherTimer);
  const el = document.getElementById('welcome-weather');
  const city = document.getElementById('welcome-city').value.trim();
  if(city.length < 3){ el.textContent = ''; return; }
  welcomeWeatherTimer = setTimeout(async () => {
    try {
      const place = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`).then(r => r.json());
      if(!place.results){ el.textContent = "Can't find that city yet. Keep typing, or check the spelling."; return; }
      const { latitude, longitude, name, country } = place.results[0];
      const d = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`).then(r => r.json());
      el.textContent = `${Math.round(d.current_weather.temperature)}°, ${weatherWords(d.current_weather.weathercode)} in ${name}${country ? ', ' + country : ''}`;
    } catch(e){ el.textContent = ''; }   // offline: no preview, the city is still saved
  }, 600);
}
function welcomeClock(on24){ setPref('clock24', on24); renderWelcome(); }

/* ----- Your look ----- */
function welcomeTheme(theme){ setPref('theme', theme); renderWelcome(); }

/* ----- Classes ----- */
function renderWelcomeCampus(){
  const connected = campusActive();
  document.getElementById('welcome-campus-btn').style.display = connected ? 'none' : '';
  document.getElementById('welcome-campus-state').textContent = connected
    ? `Connected: ${evalCourses().length} courses and your timetable are in.` : 'Not connected';
  const withPattern = evalCourses().filter(c => evalFor(c).components.length).length;
  if(withPattern) document.getElementById('welcome-eval-state').textContent = `Evaluation pattern in for ${withPattern} course${withPattern === 1 ? '' : 's'}.`;
}
async function welcomeConnectCampus(){ await connectCampus(); renderWelcomeCampus(); }
async function welcomeImportEvaluation(){ await importFromWord(); }
function welcomeLater(page){ welcomeLaterPage = page; showToast('Timetable settings will open when you finish'); }
// After the import dialog closes, show what came in.
hookRender('renderEvaluation', () => { if(document.getElementById('welcome-overlay').classList.contains('open')) renderWelcomeCampus(); });

/* ----- Mail ----- */
async function welcomeSaveMail(){
  const email = document.getElementById('welcome-mail').value.trim();
  const appPassword = document.getElementById('welcome-mail-pass').value.replace(/\s+/g, '');
  const state = document.getElementById('welcome-mail-state');
  if(!email || !appPassword){ state.className = 'wl-note bad'; state.textContent = 'Enter your email and the app password first.'; return; }
  state.className = 'wl-note'; state.textContent = 'Checking the sign-in…';
  const imapHost = 'imap.gmail.com';   // Gmail and Google-run university mail; anything else is set up in Settings > Mail
  await window.pcc.setMailConfig({ email, imapHost, allowedSenders: [], daysBack: 14, appPassword });
  document.getElementById('welcome-mail-pass').value = '';
  inboxAccount = { email, gmail: true };
  const test = await window.pcc.testMailLogin();
  state.className = 'wl-note ' + (test.ok ? 'ok' : 'bad');
  state.textContent = test.ok ? 'Signed in. Your mail will be on the Inbox page.' : test.error;
  if(test.ok){ welcomeMailOk = true; scanMail(true); }
}

/* ----- Your desktop ----- */
function welcomeVisualizer(on, style){
  setPref('visualizer', on ? (style || (prefs().visualizer !== 'off' ? prefs().visualizer : 'bars')) : 'off');
  renderWelcome();
}

/* ----- Friends ----- */
let welcomeJoined = 0;
function welcomeJoin(){
  const codeInput = document.getElementById('welcome-code'), nameInput = document.getElementById('welcome-code-name');
  const state = document.getElementById('welcome-join-state');
  const topic = codeToTopic(codeInput.value);
  if(!topic){ state.className = 'wl-note bad'; state.textContent = "That code doesn't look right. It starts with PCC and has 16 more characters."; return; }
  if(msg.channels.some(c => c.topic === topic)){ state.className = 'wl-note'; state.textContent = 'You already have this channel.'; return; }
  const name = (nameInput.value.trim() || 'Friends').slice(0, 30);
  msg.channels.push({ id: uid(), name, topic });
  saveMessages(); configureMessages(); pushIsland();
  welcomeJoined++;
  codeInput.value = ''; nameInput.value = '';
  state.className = 'wl-note ok'; state.textContent = `Joined "${name}". Add another if you like.`;
}
async function welcomeAutostart(on){
  const result = await window.pcc.setAutostart(on);
  if(result && !result.supported){
    document.getElementById('welcome-autostart').checked = false;
    document.getElementById('welcome-autostart-note').textContent = 'This works in the installed app (not when running from source).';
  }
}

/* ----- Done ----- */
async function renderWelcomeChecklist(){
  const p = prefs();
  const name = state.settings.name;
  document.getElementById('welcome-done-title').innerHTML = name ? `You're all set, <em>${esc(name)}</em>` : "You're all set";
  const auto = window.pcc && window.pcc.getAutostartStatus ? await window.pcc.getAutostartStatus() : { enabled: false };
  const courses = evalCourses().filter(c => evalFor(c).components.length).length;
  const items = [
    [!!name || !!state.settings.weatherCity, `Name${state.settings.weatherCity ? ' and weather (' + esc(state.settings.weatherCity) + ')' : ''}`, 'Set up', 'general'],
    [campusActive(), 'Digiicampus connected', 'Connect', 'timetable'],
    [courses > 0, courses ? `Evaluation pattern for ${courses} course${courses === 1 ? '' : 's'}` : 'Evaluation pattern', 'Later, on Academics', null],
    [welcomeMailOk, 'Mail', 'Set up', 'mail'],
    [p.islandEnabled, 'The island', 'Turn on', 'island'],
    [p.visualizer !== 'off', 'Music visualiser', 'Turn on', 'island'],
    [!!p.desktopMode, 'Desktop mode', 'Turn on', 'desktop'],
    [msg.channels.length > 0, msg.channels.length ? `Messages: ${msg.channels.map(c => esc(c.name)).join(', ')}` : "A friend's channel", 'Join', 'messages'],
    [!!auto.enabled, 'Starts with Windows', 'Turn on', 'general'],
  ];
  document.getElementById('welcome-checklist').innerHTML = items.map(([done, label, action, where]) => `
    <div class="wl-check ${done ? 'done' : ''}">
      <span class="wl-tick">${done ? '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : ''}</span>
      <span>${label}</span>
      ${!done && where ? `<button class="btn wl-link" onclick="welcomeGo('${where}')">${action}</button>` : !done ? `<span class="wl-later">${action}</span>` : ''}
    </div>`).join('');
}

/* ---------- The tour ---------- */
// A spotlight on a few things that aren't obvious, one at a time.
const TOUR_STEPS = [
  { target: '.rail', title: 'Your pages', text: 'Today, Inbox, Messages, Focus and the rest. Hover to see their names; Ctrl+1, 2, 3… jumps straight to one.' },
  { target: '#search-input', title: 'Ctrl+K does almost anything', text: 'Search everything, open any page, start the timer, add a task or note, or change a setting, all from the keyboard.' },
  { target: '.rail-feedback', title: 'Tell the developer', text: 'Found a bug or have an idea? The star sends it straight to Partisan, encrypted.' },
  { target: null, title: 'PCC lives in your tray', text: 'Closing the window keeps PCC running by the clock, so the island, reminders and your desktop keep going. Right-click its icon for quick switches.' },
];
let tourIndex = 0;

function startTour(){ tourIndex = 0; document.getElementById('tour-overlay').classList.add('open'); showTourStep(); }
function endTour(){ document.getElementById('tour-overlay').classList.remove('open'); }
function tourNext(){ if(++tourIndex >= TOUR_STEPS.length) return endTour(); showTourStep(); }

function showTourStep(){
  const step = TOUR_STEPS[tourIndex];
  const spot = document.getElementById('tour-spot'), card = document.getElementById('tour-card');
  document.getElementById('tour-count').textContent = `${tourIndex + 1} of ${TOUR_STEPS.length}`;
  document.getElementById('tour-title').textContent = step.title;
  document.getElementById('tour-text').textContent = step.text;
  document.getElementById('tour-next').textContent = tourIndex === TOUR_STEPS.length - 1 ? 'Done' : 'Next';
  const el = step.target && document.querySelector(step.target);
  const pad = 8, W = innerWidth, H = innerHeight;
  // The tray is outside the window: point at the bottom-right corner, where it is.
  const r = el ? el.getBoundingClientRect() : { left: W - 70, top: H - 70, width: 56, height: 56 };
  Object.assign(spot.style, { left: (r.left - pad) + 'px', top: (r.top - pad) + 'px', width: (r.width + pad * 2) + 'px', height: (r.height + pad * 2) + 'px' });
  spot.classList.toggle('corner', !el);
  // The card goes beside the spotlight, wherever there's room.
  const cw = 320, ch = 170;
  let x = r.left + r.width + 24, y = r.top;
  if(x + cw > W - 16) x = Math.max(16, r.left - cw - 24);
  if(r.height > H * 0.6) y = H / 2 - ch / 2;          // the rail is tall: centre the card on it
  y = Math.min(Math.max(16, y), H - ch - 16);
  if(r.top > H - 140){ y = r.top - ch - 20; x = Math.min(x, W - cw - 16); }
  Object.assign(card.style, { left: x + 'px', top: y + 'px' });
}

document.addEventListener('keydown', e => {
  if(!document.getElementById('tour-overlay').classList.contains('open')) return;
  if(e.key === 'Escape') endTour();
  else if(e.key === 'Enter' || e.key === 'ArrowRight') tourNext();
});
window.addEventListener('resize', () => { if(document.getElementById('tour-overlay').classList.contains('open')) showTourStep(); });
