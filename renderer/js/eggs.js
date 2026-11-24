/* ---------- Little surprises ---------- */
// A few hidden moments, found by doing something. Nothing in PCC points to
// them; the full list, with how to set each one off and whether it has been
// found, is only on the developer's own PC (Settings > Developer, shown when
// the main process finds the private announcement key there).

const EGGS = [
  { id: 'credits', name: 'The credits', how: 'Settings › About: click the Partisan logo 7 times quickly.', does: 'A credits screen rolls up, with confetti. Click to close.' },
  { id: 'konami', name: 'Konami code', how: 'Anywhere in PCC (not while typing in a box), press ↑ ↑ ↓ ↓ ← → ← → B A.', does: 'The island dances and PCC\'s colour cycles through a rainbow for a minute.' },
  { id: 'partisan', name: 'Partisan mode', how: 'Ctrl+K, type “partisan”, press Enter. The same again turns it off.', does: 'PCC and the island turn Partisan red until you turn it off.' },
  { id: 'wish', name: '11:11', how: 'Have PCC running at 11:11, morning or night.', does: 'The island says “Make a wish” for that minute.' },
  { id: 'streak', name: 'Ten in a row', how: 'Keep any habit going for 10 days in a row.', does: 'Confetti, the island dances, and a Tada (unless a Sounds rule already plays one).' },
  { id: 'countdown', name: 'The big day', how: 'Have PCC open on the day one of your countdowns reaches zero.', does: 'Confetti and a little message for the day, once per countdown.' },
  { id: 'century', name: 'A hundred done', how: 'Tick off your 100th task in PCC.', does: 'Confetti, and a trophy in Settings › About from then on.' },
];

function eggFound(id){
  const found = Store.get('__eggs', {});
  if(!found[id]){ found[id] = Date.now(); Store.set('__eggs', found); }
  renderDevEggs();
}

// Confetti where it's seen, and optionally a dance or a glow on the island.
function eggCelebrate(island){
  PCCConfetti.burst();
  if(island && window.pcc && window.pcc.islandCelebrate && prefs().islandEnabled) window.pcc.islandCelebrate(island);
}

/* ----- Colour: Partisan red, and the Konami rainbow ----- */

let eggAccent = null;   // a colour that wins over the chosen accent while set
const eggOwnAccent = currentAccent;
currentAccent = function(){ return eggAccent || (Store.get('__partisanMode', false) ? '#E63946' : eggOwnAccent()); };
if(Store.get('__partisanMode', false)) setTimeout(() => { applyAppearance(); pushIsland(); }, 0);

function eggPaletteCommand(query){
  if(query !== 'partisan') return null;
  const on = Store.get('__partisanMode', false);
  return { id: 'egg-partisan', title: on ? 'Partisan mode: turn off' : 'Partisan mode', cat: 'Partisan', action: () => {
    Store.set('__partisanMode', !on);
    applyAppearance(); pushIsland();
    if(!on){ eggFound('partisan'); eggCelebrate('party'); showToast('Partisan mode on. Welcome back, boss.'); }
    else showToast('Partisan mode off');
  } };
}

/* ----- The Konami code ----- */

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
let konamiAt = 0, rainbowTimer = null;
document.addEventListener('keydown', (e) => {
  const a = document.activeElement;
  if(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  konamiAt = key === KONAMI[konamiAt] ? konamiAt + 1 : key === KONAMI[0] ? 1 : 0;
  if(konamiAt < KONAMI.length) return;
  konamiAt = 0;
  eggFound('konami');
  eggCelebrate('dance');
  // A minute of rainbow, then back to your colour.
  clearInterval(rainbowTimer);
  const started = Date.now();
  let lastPush = 0;
  rainbowTimer = setInterval(() => {
    const t = Date.now() - started;
    if(t > 60000){ clearInterval(rainbowTimer); eggAccent = null; applyAppearance(); pushIsland(); return; }
    const h = (t / 30) % 360, s = 0.85, l = 0.65;
    const f = (n) => { const k = (n + h / 30) % 12; return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    eggAccent = '#' + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
    applyAppearance();
    if(t - lastPush > 1000){ lastPush = t; pushIsland(); }
  }, 120);
});

/* ----- The credits ----- */

let logoClicks = [];
document.addEventListener('click', (e) => {
  if(!e.target.closest('.about-maker img')) return;
  const now = Date.now();
  logoClicks = logoClicks.filter(t => now - t < 2500).concat(now);
  if(logoClicks.length >= 7){ logoClicks = []; showCredits(); }
});

async function showCredits(){
  eggFound('credits');
  const version = window.pcc && window.pcc.getAppVersion ? await window.pcc.getAppVersion() : '';
  const el = document.createElement('div');
  el.id = 'credits-overlay';
  el.innerHTML = `<div class="roll">
      <img src="../assets/partisan.png" alt="" />
      <h1>Personal Command Center</h1>
      <div class="dim">${version ? 'Version ' + esc(version) : ''}</div>
      <div class="role">Made by</div><div class="name">Partisan</div>
      <div class="role">Built with</div><div class="name">Champ</div>
      <div class="role">Ideas and bug reports</div><div class="name">Every friend who said “it would be cool if…”</div>
      <div class="role">From</div><div class="name">Partisan's workshop, with Champ</div>
    </div><div class="hint">Click anywhere to close</div>`;
  el.addEventListener('click', () => el.remove());
  document.body.appendChild(el);
  setTimeout(() => PCCConfetti.burst({ count: 200 }), 300);
  setTimeout(() => el.remove(), 17000);
}

/* ----- Streaks, countdowns, a hundred tasks ----- */

function eggStreak(habit){
  eggFound('streak');
  eggCelebrate('dance');
  if(!soundRuleFor('streak-10')) playSound('tada');
  showToast(`${habit ? habit.name : 'A habit'}: ten days in a row. Legend.`);
}

function eggCountdowns(){
  if(typeof visibleCountdowns !== 'function') return;
  const seen = Store.get('__eggDays', {});
  const today = todayStr();
  for(const c of visibleCountdowns()){
    const key = c.id + '@' + today;
    if(c.days !== 0 || seen[key]) continue;
    seen[key] = 1; Store.set('__eggDays', seen);
    eggFound('countdown');
    eggCelebrate('party');
    showToast(`Today's the day: ${c.title}`);
    break;   // one at a time; the next one gets its turn in a minute
  }
}
setTimeout(eggCountdowns, 6000);
setInterval(eggCountdowns, 60000);

function eggTaskDone(){
  let count = Store.get('__eggTasksDone', null);
  if(count === null) count = state.tasks.filter(t => t.done).length - 1;   // start from what's already done
  count++;
  Store.set('__eggTasksDone', count);
  if(count !== 100) return;
  eggFound('century');
  eggCelebrate('party');
  showToast('That\'s 100 tasks done. There\'s a trophy for you in Settings › About.');
  renderEggTrophy();
}

function renderEggTrophy(){
  const pane = document.querySelector('.settings-pane[data-tab="about"] .about-maker');
  if(!pane || document.getElementById('egg-trophy') || !Store.get('__eggs', {}).century) return;
  pane.insertAdjacentHTML('afterend', '<div class="egg-trophy" id="egg-trophy"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>100 tasks done</div>');
}
setTimeout(renderEggTrophy, 0);

/* ----- Settings > Developer: only on the developer's PC ----- */

let isDevDevice = false;
function renderDevEggs(){
  const el = document.getElementById('dev-eggs');
  if(!el || !isDevDevice) return;
  const found = Store.get('__eggs', {});
  el.innerHTML = `<h3 class="pane-subtitle">Easter eggs</h3>` + EGGS.map(e => `
    <div class="dev-egg">
      <div><b>${esc(e.name)}</b><div class="how">${esc(e.how)}</div><div class="how">${esc(e.does)}</div></div>
      <span class="state ${found[e.id] ? 'found' : ''}">${found[e.id] ? 'Found ' + new Date(found[e.id]).toLocaleDateString() : 'Not found yet'}</span>
    </div>`).join('');
}
if(window.pcc && window.pcc.isDevDevice){
  window.pcc.isDevDevice().then(dev => {
    isDevDevice = !!dev;
    if(!dev) return;
    document.getElementById('dev-tab').style.display = '';
    renderDevEggs();
  }).catch(() => {});
}
