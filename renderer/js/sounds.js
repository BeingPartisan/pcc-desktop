/* ---------- Sounds and actions ---------- */
// Rules that make PCC react when something happens: "when the charger is
// plugged in, play Power up", "when all the tasks are done, play Level up and
// let the island celebrate". Set up in Settings > Sounds.
//
// Each rule (prefs().soundRules):
//   { id, trigger, sound, fileName?, confetti?, island?, notify?, on }
//   sound: a built-in sound's id, 'file:<id>' for an audio file of your own
//          (copied into PCC's data folder by the main process), or '' for none
// Built-in sounds are made here with Web Audio, so there are no sound files to ship.
//
// Other parts of PCC call soundEvent('<trigger>') when something happens; the
// charger, battery, class and first-open-of-the-day triggers are watched here.

const SOUND_TRIGGERS = [
  { id: 'charger-in', name: 'Charger plugged in' },
  { id: 'charger-out', name: 'Charger unplugged' },
  { id: 'battery-low', name: 'Battery below 20%' },
  { id: 'battery-full', name: 'Battery full' },
  { id: 'task-done', name: 'A task is done' },
  { id: 'all-tasks-done', name: 'All tasks are done' },
  { id: 'deadline-done', name: 'A deadline is ticked off' },
  { id: 'focus-done', name: 'Focus timer ends' },
  { id: 'streak-7', name: 'A habit streak reaches 7 days' },
  { id: 'streak-10', name: 'A habit streak reaches 10 days' },
  { id: 'streak-30', name: 'A habit streak reaches 30 days' },
  { id: 'message', name: 'A new message' },
  { id: 'class-soon', name: 'A class starts in 5 minutes' },
  { id: 'day-start', name: 'PCC opens for the first time today' },
];
const SOUND_NAMES = { chime: 'Chime', pop: 'Pop', power: 'Power up', level: 'Level up', tada: 'Tada', whoosh: 'Whoosh', uhoh: 'Uh-oh' };
const SOUND_DEFAULT_RULES = [
  { id: 'r1', trigger: 'focus-done', sound: 'chime', on: true },
  { id: 'r2', trigger: 'all-tasks-done', sound: 'level', confetti: true, island: true, on: true },
  { id: 'r3', trigger: 'streak-10', sound: 'tada', confetti: true, on: true },
  { id: 'r4', trigger: 'charger-in', sound: 'power', on: false },
  { id: 'r5', trigger: 'battery-low', sound: 'uhoh', notify: true, on: false },
];

const soundRules = () => prefs().soundRules || (prefs().soundRules = SOUND_DEFAULT_RULES.map(r => ({ ...r })));
const triggerName = (id) => (SOUND_TRIGGERS.find(t => t.id === id) || {}).name || id;

/* ----- Playing ----- */

let audioCtx = null;
function soundVolume(){ return Math.max(0, Math.min(1, (prefs().soundsVolume ?? 70) / 100)); }

function tone(freq, start, length, type = 'sine', level = 0.2){
  const t0 = audioCtx.currentTime + start;
  const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
  osc.type = type; osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(level * soundVolume(), t0 + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t0); osc.stop(t0 + length + 0.05);
  return osc;
}

const BUILT_IN_SOUNDS = {
  chime: () => { tone(880, 0, 0.9); tone(1320, 0.12, 0.9, 'sine', 0.12); },
  pop: () => { const o = tone(600, 0, 0.12, 'sine', 0.3); o.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.08); },
  power: () => { const o = tone(220, 0, 0.5, 'sawtooth', 0.08); o.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.4); tone(1046, 0.42, 0.4, 'triangle', 0.15); },
  level: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.09, 0.35, 'square', 0.07)); },
  tada: () => { tone(392, 0, 0.15, 'triangle', 0.18); tone(523, 0.12, 0.15, 'triangle', 0.18); [659, 784, 1046].forEach(f => tone(f, 0.26, 0.9, 'triangle', 0.12)); },
  whoosh: () => {
    const len = 0.6, buf = audioCtx.createBuffer(1, audioCtx.sampleRate * len, audioCtx.sampleRate), data = buf.getChannelData(0);
    for(let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / data.length);
    const src = audioCtx.createBufferSource(), filter = audioCtx.createBiquadFilter(), gain = audioCtx.createGain();
    src.buffer = buf; filter.type = 'bandpass'; filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(300, audioCtx.currentTime); filter.frequency.exponentialRampToValueAtTime(3000, audioCtx.currentTime + len);
    gain.gain.value = 0.35 * soundVolume();
    src.connect(filter).connect(gain).connect(audioCtx.destination); src.start();
  },
  uhoh: () => { tone(523, 0, 0.25, 'triangle', 0.18); tone(392, 0.22, 0.45, 'triangle', 0.18); },
};

async function playSound(sound){
  if(!sound) return;
  try {
    if(sound.startsWith('file:')){
      const url = window.pcc && window.pcc.soundFileUrl ? await window.pcc.soundFileUrl(sound.slice(5)) : null;
      if(!url) return;
      const audio = new Audio(url);
      audio.volume = soundVolume();
      await audio.play();
      return;
    }
    if(!BUILT_IN_SOUNDS[sound]) return;
    audioCtx = audioCtx || new AudioContext();
    if(audioCtx.state === 'suspended') await audioCtx.resume();
    BUILT_IN_SOUNDS[sound]();
  } catch(e){ console.warn('Sound could not play', e); }
}

function inQuietHours(){
  if(!prefs().soundsQuiet) return false;
  const h = new Date().getHours();
  return h >= 23 || h < 7;
}

// Confetti where it will be seen: in PCC's window if it's open, otherwise falling from the island.
function celebrate(kind = 'confetti'){
  if(document.visibilityState === 'visible' && document.hasFocus()) PCCConfetti.burst();
  else if(window.pcc && window.pcc.islandCelebrate && prefs().islandEnabled) window.pcc.islandCelebrate(kind === 'party' ? 'party' : 'confetti');
}

/* ----- When something happens ----- */

function soundEvent(trigger, detail){
  if(!prefs().soundsOn) return;
  for(const rule of soundRules()){
    if(!rule.on || rule.trigger !== trigger) continue;
    if(!inQuietHours()) playSound(rule.sound);
    if(rule.confetti) celebrate();
    if(rule.island && window.pcc && window.pcc.islandCelebrate && prefs().islandEnabled) window.pcc.islandCelebrate('party');
    if(rule.notify && window.pcc && window.pcc.showNotification) window.pcc.showNotification('PCC', detail || triggerName(trigger));
  }
}

// Whether any rule would make a sound for this trigger (a surprise uses its own sound only if not).
function soundRuleFor(trigger){ return prefs().soundsOn && soundRules().some(r => r.on && r.trigger === trigger && r.sound); }

// The charger and the battery, from the system (laptops; a desktop PC simply never reports a change).
(async () => {
  if(!navigator.getBattery) return;
  try {
    const battery = await navigator.getBattery();
    let lowSaid = false, fullSaid = battery.charging && battery.level >= 1;
    battery.addEventListener('chargingchange', () => soundEvent(battery.charging ? 'charger-in' : 'charger-out'));
    battery.addEventListener('levelchange', () => {
      const pct = Math.round(battery.level * 100);
      if(!battery.charging && pct <= 20 && !lowSaid){ lowSaid = true; soundEvent('battery-low', `Battery is at ${pct}%`); }
      if(battery.charging || pct > 25) lowSaid = false;
      if(battery.charging && pct >= 100 && !fullSaid){ fullSaid = true; soundEvent('battery-full', 'Battery full'); }
      if(pct < 95) fullSaid = false;
    });
  } catch(e){ /* no battery information */ }
})();

// A class in five minutes, and the first open of the day.
const soundClassesSaid = new Set();
setInterval(() => {
  if(typeof islandClasses !== 'function') return;
  const now = Date.now();
  for(const c of islandClasses()){
    const key = c.start + c.subject;
    if(c.start - now > 0 && c.start - now <= 5 * 60000 && !soundClassesSaid.has(key)){ soundClassesSaid.add(key); soundEvent('class-soon', `${c.subject} starts in 5 minutes`); }
  }
}, 30000);
setTimeout(() => {
  const today = todayStr();
  if(Store.get('__soundsLastDay', '') !== today){ Store.set('__soundsLastDay', today); soundEvent('day-start', 'Good to see you'); }
}, 4000);

/* ----- Settings > Sounds ----- */

function saveSoundRules(){ setPref('soundRules', soundRules()); renderSoundSettings(); }
function addSoundRule(){ soundRules().push({ id: 'r' + uid(), trigger: 'task-done', sound: 'pop', on: true }); saveSoundRules(); }
function removeSoundRule(id){
  const rule = soundRules().find(r => r.id === id);
  if(rule && rule.sound.startsWith('file:') && window.pcc && window.pcc.removeSoundFile) window.pcc.removeSoundFile(rule.sound.slice(5));
  prefs().soundRules = soundRules().filter(r => r.id !== id); saveSoundRules();
}
function setSoundRule(id, key, value){ const r = soundRules().find(x => x.id === id); if(r){ r[key] = value; saveSoundRules(); } }
async function setRuleSound(id, value){
  const r = soundRules().find(x => x.id === id); if(!r) return;
  if(value === 'pick'){
    const result = await window.pcc.pickSoundFile();
    if(!result.ok){ if(!result.canceled) showToast(result.error || 'Could not add that file'); return renderSoundSettings(); }
    if(r.sound.startsWith('file:')) window.pcc.removeSoundFile(r.sound.slice(5));
    r.sound = 'file:' + result.id; r.fileName = result.name;
    saveSoundRules(); playSound(r.sound);
    return;
  }
  if(r.sound.startsWith('file:') && window.pcc.removeSoundFile) window.pcc.removeSoundFile(r.sound.slice(5));
  r.sound = value; delete r.fileName; saveSoundRules(); playSound(value);
}
function previewSoundRule(id){
  const r = soundRules().find(x => x.id === id); if(!r) return;
  playSound(r.sound);
  if(r.confetti) PCCConfetti.burst();
  if(r.island && window.pcc && window.pcc.islandCelebrate) window.pcc.islandCelebrate('party');
}

function renderSoundSettings(){
  const el = document.getElementById('sound-rules');
  if(!el) return;
  const options = (rule) => [
    ...Object.entries(SOUND_NAMES).map(([id, name]) => `<option value="${id}" ${rule.sound === id ? 'selected' : ''}>${name}</option>`),
    rule.sound.startsWith('file:') ? `<option value="${esc(rule.sound)}" selected>${esc(rule.fileName || 'Your file')}</option>` : '',
    `<option value="pick">Choose a file of your own…</option>`,
    `<option value="" ${!rule.sound ? 'selected' : ''}>No sound</option>`,
  ].join('');
  const extra = (rule, key, label) => `<button class="sound-chip ${rule[key] ? 'on' : ''}" onclick="setSoundRule('${rule.id}', '${key}', ${!rule[key]})" title="${label}">${label}</button>`;
  el.innerHTML = soundRules().map(rule => `
    <div class="sound-rule ${rule.on ? '' : 'off'}">
      <span class="dim">When</span>
      <select onchange="setSoundRule('${rule.id}', 'trigger', this.value)">${SOUND_TRIGGERS.map(t => `<option value="${t.id}" ${rule.trigger === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}</select>
      <span class="dim">play</span>
      <select onchange="setRuleSound('${rule.id}', this.value)">${options(rule)}</select>
      ${extra(rule, 'confetti', 'Confetti')}${extra(rule, 'island', 'Island celebrates')}${extra(rule, 'notify', 'Notification')}
      <span class="sound-rule-end">
        <button class="btn btn-icon" onclick="previewSoundRule('${rule.id}')" title="Try it" aria-label="Try it"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg></button>
        <input type="checkbox" class="switch" ${rule.on ? 'checked' : ''} onchange="setSoundRule('${rule.id}', 'on', this.checked)" aria-label="Rule on" />
        <button class="btn btn-icon btn-danger" onclick="removeSoundRule('${rule.id}')" aria-label="Remove rule">&times;</button>
      </span>
    </div>`).join('') || '<div class="empty">No rules yet. Add one below.</div>';
  const vol = document.getElementById('sounds-volume');
  if(vol && document.activeElement !== vol) vol.value = prefs().soundsVolume ?? 70;
  const out = document.getElementById('sounds-volume-out');
  if(out) out.textContent = `${prefs().soundsVolume ?? 70}%`;
}
document.addEventListener('DOMContentLoaded', renderSoundSettings);
setTimeout(renderSoundSettings, 0);
