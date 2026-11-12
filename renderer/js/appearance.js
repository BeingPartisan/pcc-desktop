/* ---------- Appearance and layout preferences ---------- */
// Everything the user can customise lives in one object, state.settings.prefs
// (saved with the rest of the settings). Two functions do the work:
//
//   applyAppearance()          - makes the live app match the preferences:
//                                sets CSS variables and data-* attributes on
//                                <html> (the stylesheet does the rest), and
//                                arranges the rail and the Today page.
//   renderAppearanceSettings() - makes the Settings controls show the
//                                current preferences.
//
// setPref(key, value) is the single way a control changes a preference: it
// saves, applies and re-renders.

const ACCENT_PRESETS = [
  { name: 'Lime',   value: '#C9F26C' },
  { name: 'Sky',    value: '#86C6FF' },
  { name: 'Violet', value: '#B9A5FF' },
  { name: 'Coral',  value: '#FF8A73' },
  { name: 'Amber',  value: '#F4B860' },
  { name: 'Mint',   value: '#7FE0C4' },
  { name: 'Pink',   value: '#FF8FC7' },
];

// The cards on Today that can be hidden and reordered.
const TODAY_CARDS = {
  classes:   { label: "Today's classes", el: 'card-today-classes' },
  timer:     { label: 'Focus timer',     el: 'card-today-timer' },
  tasks:     { label: 'Tasks',           el: 'card-today-tasks' },
  deadlines: { label: 'Deadlines',       el: 'card-today-deadlines' },
};

const PREF_DEFAULTS = {
  theme: 'dark',              // 'dark' | 'light' | 'system'
  accent: '#C9F26C',
  accentFromWindows: false,   // use the Windows accent colour instead of `accent`
  background: 'blur',         // 'blur' | 'solid' | 'image'
  density: 'comfortable',     // 'comfortable' | 'compact'
  textSize: 100,              // percent
  reduceMotion: false,
  logoText: 'P',
  appName: 'Personal Command Center',
  clock24: false,
  startPage: 'today',
  showStatusChips: true,
  focusMinutes: 25,
  breakMinutes: 5,
  todayCards: Object.keys(TODAY_CARDS).map(id => ({ id, visible: true })),
  pages: Object.keys(PAGES).map(id => ({ id, visible: true })),
};

let systemAccent = null;                             // Windows accent colour, once known
const customImages = { logo: null, wallpaper: null }; // file URLs of user-chosen images

function prefs(){ return state.settings.prefs; }
function use24Hour(){ return !!(state.settings.prefs && state.settings.prefs.clock24); }

// A saved ordered list may predate a newly added page or card: keep the
// saved order and visibility, drop unknown ids, append new ones.
function reconcileOrder(saved, ids){
  const list = (Array.isArray(saved) ? saved : []).filter(item => item && ids.includes(item.id))
    .map(item => ({ id: item.id, visible: item.visible !== false }));
  for(const id of ids) if(!list.some(item => item.id === id)) list.push({ id, visible: true });
  return list;
}

function initPrefs(){
  const saved = state.settings.prefs || {};
  const p = { ...PREF_DEFAULTS, ...saved };
  p.todayCards = reconcileOrder(saved.todayCards, Object.keys(TODAY_CARDS));
  p.pages = reconcileOrder(saved.pages, Object.keys(PAGES));
  p.pages.find(item => item.id === 'today').visible = true; // Today is home; it can't be hidden
  state.settings.prefs = p;
}

function setPref(key, value){
  prefs()[key] = value;
  Store.set('settings', state.settings);
  applyAppearance();
  renderAppearanceSettings();
  if(key === 'clock24'){ updateClock(); renderTimetable(); }
}

/* ----- Applying ----- */

// Dark text on light accents, light text on dark ones.
function inkForAccent(hex){
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16 & 255, n >> 8 & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#151A07' : '#FFFFFF';
}

function currentAccent(){
  const p = prefs();
  const hex = p.accentFromWindows && systemAccent ? systemAccent : p.accent;
  return /^#[0-9a-f]{6}$/i.test(hex) ? hex : PREF_DEFAULTS.accent;
}

function applyAppearance(){
  const p = prefs();
  const root = document.documentElement;

  const dark = p.theme === 'dark' || (p.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';

  const accent = currentAccent();
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-ink', inkForAccent(accent));

  // An image background needs an image; fall back to the blur until one is chosen.
  root.dataset.background = p.background === 'image' && !customImages.wallpaper ? 'blur' : p.background;
  root.style.setProperty('--wallpaper', customImages.wallpaper ? `url("${customImages.wallpaper}")` : 'none');

  root.dataset.density = p.density;
  root.dataset.motion = p.reduceMotion ? 'reduced' : 'full';
  root.style.setProperty('--zoom', String(p.textSize / 100));

  const logo = document.querySelector('.rail-logo');
  logo.classList.toggle('has-image', !!customImages.logo);
  logo.style.backgroundImage = customImages.logo ? `url("${customImages.logo}")` : '';
  logo.textContent = p.logoText || PREF_DEFAULTS.logoText;

  const name = (p.appName || '').trim() || PREF_DEFAULTS.appName;
  document.title = name; // the window title follows this
  if(window.pcc && window.pcc.setAppName){ window.pcc.setAppName(name); window.pcc.setThemeSource(p.theme); }

  if(POMO_MINUTES.focus !== p.focusMinutes || POMO_MINUTES.break !== p.breakMinutes) setPomoMinutes(p.focusMinutes, p.breakMinutes);

  applyTodayLayout();
  applyRailLayout();
}

function applyTodayLayout(){
  const p = prefs();
  p.todayCards.forEach((item, i) => {
    const el = document.getElementById(TODAY_CARDS[item.id].el);
    el.style.order = i;
    el.style.display = item.visible ? '' : 'none';
  });
  document.getElementById('card-pending-updates').style.order = 99; // mail updates stay last
  document.getElementById('today-status').style.display = p.showStatusChips ? '' : 'none';
}

function applyRailLayout(){
  const rail = document.querySelector('.rail');
  const spacer = rail.querySelector('.rail-spacer');
  for(const item of prefs().pages){
    const btn = rail.querySelector(`.rail-btn[data-page="${item.id}"]`);
    rail.insertBefore(btn, spacer);
    btn.style.display = item.visible ? '' : 'none';
  }
  PAGE_ORDER = prefs().pages.filter(item => item.visible).map(item => item.id);
  if(!PAGE_ORDER.includes(currentPage)) navigate('today');
}

/* ----- Things that arrive after startup ----- */

// Follow Windows when the theme is set to System.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if(state.settings.prefs && prefs().theme === 'system') applyAppearance();
});

async function loadAppearanceExtras(){
  if(!window.pcc || !window.pcc.getSystemAccent) return;
  [systemAccent, customImages.logo, customImages.wallpaper] = await Promise.all([
    window.pcc.getSystemAccent(), window.pcc.getCustomImage('logo'), window.pcc.getCustomImage('wallpaper'),
  ]);
  applyAppearance();
}

/* ----- Settings controls ----- */

async function chooseCustomImage(kind){
  const result = await window.pcc.pickCustomImage(kind);
  if(!result.ok){ if(!result.canceled) showToast('Could not use that image'); return; }
  customImages[kind] = result.url;
  if(kind === 'wallpaper') setPref('background', 'image');
  else { applyAppearance(); renderAppearanceSettings(); }
}

async function removeCustomImage(kind){
  await window.pcc.removeCustomImage(kind);
  customImages[kind] = null;
  if(kind === 'wallpaper' && prefs().background === 'image') setPref('background', 'blur');
  else { applyAppearance(); renderAppearanceSettings(); }
}

function setLogoText(value){
  // Up to two characters; spreading keeps an emoji in one piece.
  setPref('logoText', [...value.trim()].slice(0, 2).join('') || PREF_DEFAULTS.logoText);
}

function setAccent(hex){
  prefs().accentFromWindows = false;
  setPref('accent', hex);
}

function setTimerPref(key, value, max){
  const minutes = Math.round(Number(value));
  if(!(minutes >= 1 && minutes <= max)){ showToast(`Enter between 1 and ${max} minutes`); renderAppearanceSettings(); return; }
  setPref(key, minutes);
}

// Reordering and showing/hiding items in the Today-cards and pages lists.
function movePrefItem(key, index, delta){
  const list = prefs()[key];
  const target = index + delta;
  if(target < 0 || target >= list.length) return;
  [list[index], list[target]] = [list[target], list[index]];
  setPref(key, list);
}
function togglePrefItem(key, index, visible){
  const list = prefs()[key];
  list[index].visible = visible;
  setPref(key, list);
}

function renderOrderList(elId, key, labels, lockedId){
  const list = prefs()[key];
  document.getElementById(elId).innerHTML = list.map((item, i) => `
    <div class="order-item ${item.visible ? '' : 'off'}">
      <span class="order-name">${esc(labels[item.id])}</span>
      <button class="order-move" onclick="movePrefItem('${key}', ${i}, -1)" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(labels[item.id])} up">&uarr;</button>
      <button class="order-move" onclick="movePrefItem('${key}', ${i}, 1)" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(labels[item.id])} down">&darr;</button>
      <input type="checkbox" class="switch" ${item.visible ? 'checked' : ''} ${item.id === lockedId ? 'disabled' : ''}
        onchange="togglePrefItem('${key}', ${i}, this.checked)" aria-label="Show ${esc(labels[item.id])}" />
    </div>`).join('');
}

function renderAppearanceSettings(){
  if(!document.getElementById('accent-swatches')) return;
  const p = prefs();

  // Segmented controls mark the button whose value matches the preference.
  document.querySelectorAll('.segmented[data-pref]').forEach(group => {
    const value = String(p[group.dataset.pref]);
    group.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.value === value));
  });
  // Switches
  document.querySelectorAll('input.switch[data-pref]').forEach(input => { input.checked = !!p[input.dataset.pref]; });

  const accent = currentAccent();
  const usingPreset = !p.accentFromWindows && ACCENT_PRESETS.some(a => a.value.toLowerCase() === p.accent.toLowerCase());
  document.getElementById('accent-swatches').innerHTML =
    ACCENT_PRESETS.map(a => `<button class="swatch ${!p.accentFromWindows && a.value.toLowerCase() === p.accent.toLowerCase() ? 'active' : ''}"
      style="background:${a.value}" onclick="setAccent('${a.value}')" title="${a.name}" aria-label="${a.name} accent"></button>`).join('')
    + (systemAccent ? `<button class="swatch windows ${p.accentFromWindows ? 'active' : ''}" onclick="setPref('accentFromWindows', true)" title="Use my Windows accent colour" aria-label="Windows accent colour"></button>` : '')
    // Any other colour: a rainbow dot that opens the colour picker, shown filled once a custom colour is in use
    + `<label class="swatch custom ${!p.accentFromWindows && !usingPreset ? 'active' : ''}" ${!p.accentFromWindows && !usingPreset ? `style="background:${accent}"` : ''} title="Pick any colour"><input type="color" value="${accent}" onchange="setAccent(this.value)" aria-label="Custom accent colour" /></label>`;

  document.getElementById('pref-app-name').value = p.appName;
  document.getElementById('pref-logo-text').value = p.logoText;
  document.getElementById('logo-remove-btn').style.display = customImages.logo ? '' : 'none';
  document.getElementById('wallpaper-remove-btn').style.display = customImages.wallpaper ? '' : 'none';
  document.getElementById('wallpaper-choose-btn').textContent = customImages.wallpaper ? 'Change image…' : 'Choose image…';
  document.getElementById('pref-focus-minutes').value = p.focusMinutes;
  document.getElementById('pref-break-minutes').value = p.breakMinutes;

  const start = document.getElementById('pref-start-page');
  start.innerHTML = PAGE_ORDER.map(id => `<option value="${id}" ${id === p.startPage ? 'selected' : ''}>${esc(PAGES[id])}</option>`).join('');

  renderOrderList('today-cards-order', 'todayCards', Object.fromEntries(Object.entries(TODAY_CARDS).map(([id, c]) => [id, c.label])), null);
  renderOrderList('pages-order', 'pages', PAGES, 'today');
}
