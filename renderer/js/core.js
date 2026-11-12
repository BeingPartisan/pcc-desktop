/* ---------- Storage & Helpers ---------- */
function uid(){ return 'id' + Math.random().toString(36).slice(2,10); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
// Local calendar date as YYYY-MM-DD. (toISOString() would give the UTC date,
// which is still "yesterday" until 5:30 AM in IST.)
function todayStr(d){
  d = d || new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}
// Parse a stored YYYY-MM-DD as local midnight rather than UTC midnight.
function parseLocalDate(s){ return new Date(s + 'T00:00'); }

function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

const Store = {
  get: (key, fallback) => {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } 
    catch { return fallback; }
  },
  set: (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } 
    catch { return false; }
  }
};

/* ---------- Seed Data ---------- */
// Shown the first time the app runs, so the pages aren't empty. Deliberately
// generic: this file is public, so nothing personal belongs here.
const SEED_TASKS = [
  {id:uid(), text:'Add your first task', done:false, priority:'high'},
  {id:uid(), text:'Press Ctrl+K to try the command palette', done:false, priority:'med'},
  {id:uid(), text:'Connect your timetable in Settings', done:false, priority:'low'}
];

const SEED_NOTES = [
  { id:uid(), title:'Welcome', body:'Notes save as you type. Use /note in the command palette (Ctrl+K) to capture one from anywhere.', updatedAt:Date.now() },
];

const SEED_LINKS = [
  {id:uid(), name:'GitHub', url:'https://github.com'},
  {id:uid(), name:'Steam', url:'https://store.steampowered.com'},
  {id:uid(), name:'SCC Online', url:'https://www.scconline.com'}
];

const SEED_FLASHCARDS = [
  {id:uid(), deck:'LAW', term:'Jus Cogens', def:'Peremptory norms of general international law from which no derogation is permitted.'},
  {id:uid(), deck:'DEV', term:'Event Delegation', def:'Attaching a single event listener to a parent element to manage events for all of its children.'}
];

const SEED_FINANCES = [
  {id:uid(), name:'Music streaming', amount: 119, type:'sub', tag:'SOFTWARE'},
  {id:uid(), name:'Cloud storage', amount: 130, type:'sub', tag:'SOFTWARE'},
  {id:uid(), name:'Cab', amount: 350, type:'exp', tag:'TRAVEL'},
  {id:uid(), name:'Books', amount: 1200, type:'exp', tag:'ACADEMIC'}
];

// The manual timetable starts empty: five periods a day, Monday to Friday.
// Fill it in with Edit on the Study page, or connect Digiicampus in Settings
// to use the real one instead.
const SEED_TIMETABLE = {
  slots: ["9:00-10:50 AM", "11:30 AM-1:20 PM", "2:00-3:50 PM", "4:00-5:00 PM", "5:10-7:00 PM"],
  days: {
    Monday:    [null, null, null, null, null],
    Tuesday:   [null, null, null, null, null],
    Wednesday: [null, null, null, null, null],
    Thursday:  [null, null, null, null, null],
    Friday:    [null, null, null, null, null]
  }
};

// Each subject gets a stable colour picked from its name, so the same
// subject is always the same colour across the timetable and Today.
const SUBJECT_PALETTE = ["var(--accent)", "var(--cyan)", "var(--amber)", "var(--red)", "#C4A7FF", "#7FE0C4"];
function colorForSubject(subject){
  if(!subject) return "var(--line)";
  let hash = 0;
  for(const ch of subject) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return SUBJECT_PALETTE[hash % SUBJECT_PALETTE.length];
}

const QUOTES = [
  "The life of the law has not been logic; it has been experience.",
  "Code is law. Law is code.",
  "Discipline is remembering what you want most, not what you want now.",
  "Consistency beats intensity, almost every time.",
  "Fall seven times, stand up eight.",
  "A calm mind finds the shortest path."
];

/* ---------- State ---------- */
let state = {
  tasks: [], agenda: [], habits: {list:[], log:{}}, notes: [], links: [], images: [],
  flashcards: [], finances: [], financeHistory: [],
  timetable: SEED_TIMETABLE, timetableOverrides: [], pendingUpdates: [], dismissedUpdateIds: [],
  settings: { name: '', weatherCity: '', budget: 15000 }
};

let currentWidgetQuote = QUOTES[0];
let currentImageIdx = 0;
let currentFcIdx = 0;
let finViewMode = 'main';

/* ---------- Init ---------- */
function init(){
  state.tasks = Store.get('tasks', SEED_TASKS);
  state.agenda = Store.get('agenda', []);
  state.habits = Store.get('habits', {list:[{id:uid(), name:'Code / Build'}, {id:uid(), name:'Read Case Law'}], log:{}});
  state.notes = Store.get('notes', SEED_NOTES);
  state.links = Store.get('links', SEED_LINKS);
  state.images = Store.get('images', []);
  state.flashcards = Store.get('flashcards', SEED_FLASHCARDS);
  state.finances = Store.get('finances', SEED_FINANCES);
  state.financeHistory = Store.get('financeHistory', []);
  state.timetable = Store.get('timetable', SEED_TIMETABLE);
  state.timetableOverrides = Store.get('timetableOverrides', []);
  state.pendingUpdates = Store.get('pendingUpdates', []);
  state.dismissedUpdateIds = Store.get('dismissedUpdateIds', []);
  state.settings = Store.get('settings', { name: '', weatherCity: '', budget: 15000 });

  if(!state.settings.budget) state.settings.budget = 15000;

  if(!localStorage.getItem('tasks')) Store.set('tasks', state.tasks);
  if(!localStorage.getItem('notes')) Store.set('notes', state.notes);
  if(!localStorage.getItem('flashcards')) Store.set('flashcards', state.flashcards);
  if(!localStorage.getItem('finances')) Store.set('finances', state.finances);

  document.getElementById('set-name').value = state.settings.name;
  document.getElementById('set-city').value = state.settings.weatherCity;

  initPrefs();       // fills in any missing preferences with defaults
  applyAppearance(); // theme, accent, layout… before anything is drawn
  startClock();
  initFlashcards();
  renderAll();
}

function renderAll() {
  renderGreeting(); renderTasks(); renderAgenda(); 
  renderHabits(); renderNotes(); renderLinks();
  loadGamesFolderLabel(); // the games scan itself runs when the Launch page is first opened
  renderFinances();
  loadWeather(false); updateAestheticWidget();
  renderTimetable(); renderPending();
  scanMail(false); // silent scan on every load, per the "semi-automatic" plan
}

/* ---------- Clock & Greeting ---------- */
function startClock(){ updateClock(); setInterval(updateClock, 1000); }
function updateClock(){
  const now = new Date();
  document.getElementById('hero-clock').textContent = now.toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long'}) + '  ·  ' + now.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit',hour12:!use24Hour()});
}
function renderGreeting(){
  const h = new Date().getHours();
  const g = h<5 ? 'Still up' : h<12 ? 'Good morning' : h<17 ? 'Good afternoon' : h<21 ? 'Good evening' : 'Good night';
  // The name is set in italic accent type by the stylesheet (#hero-greeting em)
  document.getElementById('hero-greeting').innerHTML = esc(g) + (state.settings.name ? ', <em>' + esc(state.settings.name) + '</em>' : '');
}
