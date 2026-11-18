// Draws the desktop music visualiser. The window sits in the wallpaper layer
// (behind the desktop icons, see island.js), and island.js says when to
// listen (music is playing) and when to draw (some desktop can be seen).
//
// It reads the *feel* of what's playing, not just how loud it is, and
// moves to match (see "Mood" below): a heavy, fast, bass-driven track
// (phonk, drill, EDM) makes it snap, punch on every kick and throw sparks;
// soft, slow music makes it drift, glow and leave long, dreamy trails.
//
// Styles:
//   bars  a row of bars along the bottom of the screen, with a soft reflection
//   wave  a few glowing ribbons that roll along the bottom and swell with the music
//   ring  a circle of rays in the middle of the screen, around the track name
//   nebula, orbit, album: the larger scenes in scenes.js
//
// Kept light: at most 40 frames a second, glows made from a few
// translucent layers rather than blur, and everything fades in and out.

const canvas = document.getElementById('c');
const g = canvas.getContext('2d');
const DPR = Math.min(window.devicePixelRatio || 1, 1.5);   // a sharper canvas than this costs more than it shows
const FRAME_MS = 1000 / 40;

let style = 'bars', accent = '#C9F26C', bottomInset = 48;
let listening = false, active = false, running = false;
let fade = 0;                         // 0 = invisible, 1 = fully drawn; eased towards active
let smooth = [];                      // eased band levels
let lastFrame = 0, clock = 0;         // clock: seconds of animation, sped up or slowed down by the mood

function resize(){
  canvas.width = Math.round(innerWidth * DPR);
  canvas.height = Math.round(innerHeight * DPR);
}
addEventListener('resize', resize);
resize();

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const avg = (arr, from, to) => { let s = 0; for(let i = from; i < to; i++) s += arr[i]; return s / (to - from); };

/* ---------- Colour ---------- */
// The accent colour, shifted by the mood: softer and paler for calm music,
// fully saturated for energetic music, flashing towards white on a kick, and
// a second hue (a little round the colour wheel) for the tips of things.

function hexToHsl(hex){
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16 & 255) / 255, gr = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, gr, b), min = Math.min(r, gr, b), l = (max + min) / 2;
  if(max === min) return [0, 0, l * 100];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (gr - b) / d + (gr < b ? 6 : 0) : max === gr ? (b - r) / d + 2 : (r - gr) / d + 4;
  return [h * 60, s * 100, l * 100];
}
let accentHsl = hexToHsl(accent);

// alpha 0-1; tip: 0 = the accent itself, 1 = the second hue
function tone(alpha, tip = 0){
  const [h, s, l] = accentHsl;
  const I = mood.intensity, flash = mood.pulse * I;
  const hue = (h + tip * lerp(18, 48, I) + 360) % 360;
  const sat = clamp01((s * lerp(0.55, 1.05, I)) / 100) * 100;
  const light = lerp(l, Math.min(92, l + lerp(8, 2, I)), 1 - I) + flash * 22;
  return `hsla(${hue.toFixed(0)}, ${sat.toFixed(0)}%, ${Math.min(96, light).toFixed(0)}%, ${clamp01(alpha * fade).toFixed(3)})`;
}

/* ---------- Mood ---------- */
// Worked out continuously from the sound:
//   energy    how loud it is on average over the last few seconds
//   bass      how much of that loudness is in the low end
//   beats     kicks, found as sudden jumps in the bass; their spacing gives the tempo
// These blend into `intensity`, 0 (still, soft) to 1 (hard, fast, bass-heavy),
// which changes slowly, over a few seconds, so the mood follows the song
// rather than flickering. `pulse` jumps to 1 on each kick and dies away.
// Levels are also auto-scaled, so a quiet song still fills the screen.

const mood = {
  intensity: 0.35, pulse: 0,
  energy: 0, kickAvg: 0, kickPrev: 0, bassShare: 0.3, peak: 0.35,
  lastBeat: 0, beats: [],               // times of recent kicks (ms)
  bpm: 0,
};
window.__mood = mood; // for checking in tests

function updateMood(now){
  mood.pulse *= lerp(0.84, 0.74, mood.intensity);     // kicks fade faster when the music is fast
  if(!PCCAudio.listening){ mood.intensity += (0.3 - mood.intensity) * 0.02; return; }
  const b = PCCAudio.bands(24);
  const bass = avg(b, 0, 4), all = avg(b, 0, 24);

  // Auto-gain: follow the loudest recent level, falling back slowly.
  mood.peak = Math.max(all, mood.peak * 0.997, 0.12);
  mood.energy += (all / mood.peak - mood.energy) * 0.02;
  mood.bassShare += (clamp01((bass / Math.max(all, 0.01)) / 2) - mood.bassShare) * 0.02;

  // A kick: the deep bass (unsmoothed) jumps well above its recent average,
  // and is rising rather than already fading. Ratios, so loudness doesn't matter.
  const kick = PCCAudio.kickLevel();
  const ratio = kick / Math.max(mood.kickAvg, 1e-4);
  const rising = kick > mood.kickPrev * 1.08;
  mood.kickPrev = kick;
  mood.kickAvg += (kick - mood.kickAvg) * 0.06;
  if(kick > 0.002 && ratio > 1.45 && rising && now - mood.lastBeat > 240){
    mood.lastBeat = now;
    mood.pulse = Math.min(1, 0.45 + (ratio - 1.45) * 0.6);
    mood.beats.push(now);
    onBeat();
  }
  mood.beats = mood.beats.filter(t => now - t < 6000);
  // Tempo only from a steady beat: the gaps between kicks have to agree.
  let steady = 0;
  mood.bpm = 0;
  if(mood.beats.length >= 4){
    const gaps = mood.beats.slice(1).map((t, i) => t - mood.beats[i]).sort((x, y) => x - y);
    const median = gaps[Math.floor(gaps.length / 2)];
    const spread = gaps.reduce((sum, gp) => sum + Math.abs(gp - median), 0) / gaps.length / median;
    steady = clamp01(1 - spread * 3);
    if(steady > 0.4) mood.bpm = Math.round(60000 / median);
  }

  // Blend: loudness, bass weight, and a steady, fast kick (60 to 160 BPM maps to 0 to 1).
  // Kicks only count with real bass behind them, so swells in soft music don't pass for drums.
  const bassy = clamp01((mood.bassShare - 0.2) * 3.5);
  const tempo = mood.bpm ? clamp01((mood.bpm - 60) / 100) : 0;
  const kickRate = clamp01(mood.beats.length / 12) * steady * bassy;
  const target = clamp01(0.3 * mood.energy + 0.3 * clamp01((mood.bassShare - 0.3) * 2.2) + 0.2 * tempo * bassy + 0.3 * kickRate - 0.08);
  mood.intensity += (target - mood.intensity) * 0.012;
}

// Levels to draw, auto-scaled and eased. Calm music rises and falls slowly;
// energetic music snaps up and drops fast.
function levels(n){
  let raw;
  if(PCCAudio.listening){ raw = PCCAudio.bands(n); const k = 0.85 / mood.peak; raw = raw.map(v => clamp01(v * k)); }
  else { const t = performance.now() / 1000; raw = Array.from({ length: n }, (_, i) => 0.22 + 0.16 * Math.sin(t * 2.1 + i * 0.45) * Math.sin(t * 0.6 + i * 0.11)); }
  if(smooth.length !== n) smooth = raw.slice();
  const I = mood.intensity, attack = lerp(0.22, 0.8, I), release = lerp(0.95, 0.78, I);
  for(let i = 0; i < n; i++) smooth[i] = raw[i] > smooth[i] ? smooth[i] + (raw[i] - smooth[i]) * attack : smooth[i] * release + raw[i] * (1 - release);
  return smooth;
}

/* ---------- Particles ---------- */
// Energetic music: sparks thrown up on every kick. Calm music: a few motes
// of light drifting slowly upwards.
let particles = [];
function onBeat(){
  if(mood.intensity < 0.45 || !active) return;
  const w = canvas.width, h = canvas.height;
  const count = Math.round(lerp(4, 14, mood.intensity));
  for(let i = 0; i < count && particles.length < 90; i++){
    // Centred styles throw sparks out from their middle; the others from the floor.
    const centre = { ring: [0.5, 0.5, 0.2], nebula: [0.5, 0.46, 0.08], orbit: [0.5, 0.46, 0.06], album: [0.86, 0.72, 0.08] }[style];
    const ring = !!centre;
    const angle = Math.random() * Math.PI * 2;
    const m = Math.min(w, h);
    particles.push({
      x: ring ? w * centre[0] + Math.cos(angle) * m * centre[2] : Math.random() * w,
      y: ring ? h * centre[1] + Math.sin(angle) * m * centre[2] : floorY(h),
      vx: ring ? Math.cos(angle) * lerp(2, 7, Math.random()) * DPR : (Math.random() - 0.5) * 2 * DPR,
      vy: ring ? Math.sin(angle) * lerp(2, 7, Math.random()) * DPR : -lerp(3, 9, Math.random()) * DPR,
      life: 1, decay: lerp(0.02, 0.04, Math.random()), size: lerp(1.5, 3.5, Math.random()) * DPR, spark: true,
    });
  }
}
function drawParticles(w, h){
  // calm motes
  if(mood.intensity < 0.4 && particles.length < 24 && Math.random() < 0.06){
    particles.push({ x: Math.random() * w, y: floorY(h) - Math.random() * h * 0.1, vx: (Math.random() - 0.5) * 0.3 * DPR, vy: -lerp(0.3, 0.8, Math.random()) * DPR,
      life: 1, decay: lerp(0.003, 0.006, Math.random()), size: lerp(1.5, 3, Math.random()) * DPR, spark: false });
  }
  for(const p of particles){
    p.x += p.vx; p.y += p.vy; p.life -= p.decay;
    if(p.spark) p.vy += 0.12 * DPR; // sparks arc back down
    const a = (p.spark ? p.life : Math.sin(Math.PI * p.life) * 0.7);
    g.fillStyle = tone(a * 0.25, 1); g.beginPath(); g.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2); g.fill();
    g.fillStyle = tone(a, 1); g.beginPath(); g.arc(p.x, p.y, p.size, 0, Math.PI * 2); g.fill();
  }
  particles = particles.filter(p => p.life > 0);
}

/* ---------- Shapes ---------- */

// The floor the shapes stand on: just above the taskbar.
const floorY = (h) => h - (bottomInset + 64) * DPR;

function roundRect(x, y, w, h, r){
  r = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

function drawBars(w, h){
  const n = Math.max(40, Math.min(96, Math.round(w / (26 * DPR))));
  const lv = levels(n);
  const I = mood.intensity, kick = mood.pulse * I;
  const floor = floorY(h), gap = w / n, bw = gap * lerp(0.62, 0.5, I), maxH = h * lerp(0.22, 0.32, I);
  document.body.style.setProperty('--floor', `${(h - floor + maxH * 0.85) / DPR}px`); // the title sits above the tallest bars
  for(let i = 0; i < n; i++){
    const v = clamp01(Math.pow(lv[i], lerp(1.3, 1.7, I)) * (1 + kick * 0.35)) * fade;
    const bh = Math.max(3 * DPR, v * maxH), x = i * gap + (gap - bw) / 2;
    g.fillStyle = tone(lerp(0.1, 0.18, I) + kick * 0.15); roundRect(x - bw * 0.35, floor - bh - 6 * DPR, bw * 1.7, bh + 6 * DPR, bw); g.fill();
    const grad = g.createLinearGradient(0, floor - bh, 0, floor);
    grad.addColorStop(0, tone(0.95, v)); grad.addColorStop(1, tone(0.4));
    g.fillStyle = grad; roundRect(x, floor - bh, bw, bh, bw / 2); g.fill();
    const ref = g.createLinearGradient(0, floor, 0, floor + bh * 0.4);
    ref.addColorStop(0, tone(0.2)); ref.addColorStop(1, tone(0));
    g.fillStyle = ref; roundRect(x, floor + 4 * DPR, bw, bh * 0.4, bw / 2); g.fill();
  }
  // energetic: a flash line along the floor on each kick
  if(kick > 0.05){ g.fillStyle = tone(kick * 0.5, 1); g.fillRect(0, floor + 1 * DPR, w, 2 * DPR); }
}

// Ribbons: each is a slow sine that rolls sideways; its height follows one
// band of the music. Calm music: few, long, slow swells. Energetic music:
// tighter, faster ribbons, and a ripple that runs out from the middle on each kick.
const RIBBONS = [
  { band: 0, len: 0.9, speed: 0.55, width: 3.0, alpha: 1.0,  height: 0.17 },
  { band: 1, len: 1.6, speed: -0.8, width: 2.0, alpha: 0.6,  height: 0.12 },
  { band: 2, len: 2.7, speed: 1.2,  width: 1.5, alpha: 0.4,  height: 0.08 },
];
let ribbonLevel = [0, 0, 0];
let ripples = [];                       // { born } kick ripples
function drawWave(w, h){
  const b = levels(12);
  const I = mood.intensity;
  const bandLevels = [(b[0] + b[1] + b[2]) / 3, (b[4] + b[5] + b[6]) / 3, (b[8] + b[9] + b[10]) / 3];
  ribbonLevel = ribbonLevel.map((v, i) => v + (bandLevels[i] - v) * lerp(0.08, 0.3, I));
  if(mood.pulse > 0.95 && I > 0.4 && (!ripples.length || clock - ripples[ripples.length - 1].born > 0.2)) ripples.push({ born: clock });
  ripples = ripples.filter(r => clock - r.born < 1.4);
  const mid = floorY(h) - h * 0.06;
  document.body.style.setProperty('--floor', `${(h - mid) / DPR + h * 0.1 / DPR}px`);
  const steps = 96;
  RIBBONS.forEach((r, ri) => {
    const amp = h * r.height * (0.15 + ribbonLevel[r.band] * lerp(0.9, 1.4, I)) * (1 + mood.pulse * I * 0.4) * fade;
    const len = r.len * lerp(0.75, 1.5, I);
    const path = [];
    for(let i = 0; i <= steps; i++){
      const x = i / steps;
      const edge = Math.sin(Math.PI * x);                       // calm at the screen edges
      let y = Math.sin((x * len * Math.PI * 2) + clock * r.speed * Math.PI) * 0.75
            + Math.sin((x * len * 1.7 * Math.PI * 2) - clock * r.speed * 1.3) * 0.25;
      // kick ripples: a bump travelling outwards from the centre
      for(const rp of ripples){
        const age = clock - rp.born, front = age * 0.45, d = Math.abs(x - 0.5);
        y += Math.exp(-Math.pow((d - front) / 0.04, 2)) * (1 - age / 1.4) * 1.4 * (ri === 0 ? 1 : 0.5);
      }
      path.push([x * w, mid + y * amp * edge]);
    }
    for(const [lw, a] of [[r.width * 6, 0.07], [r.width * 2.5, 0.18], [r.width, 0.95]]){
      g.beginPath(); g.moveTo(path[0][0], path[0][1]);
      for(let i = 1; i < path.length - 1; i++){
        const mx = (path[i][0] + path[i + 1][0]) / 2, my = (path[i][1] + path[i + 1][1]) / 2;
        g.quadraticCurveTo(path[i][0], path[i][1], mx, my);
      }
      g.lineWidth = lw * DPR * lerp(1.15, 1, I); g.strokeStyle = tone(a * r.alpha, ri / 2);
      g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke();
    }
  });
}

function drawRing(w, h){
  const n = 96, lv = levels(n);
  const I = mood.intensity, kick = mood.pulse * I;
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.17 * (1 + kick * 0.06);
  const bass = (lv[0] + lv[1] + lv[2] + lv[3]) / 4;
  const spin = clock * lerp(0.04, 0.35, I);                     // slow turn when calm, faster when it's driving
  const disc = g.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * (1.05 + bass * 0.15));
  disc.addColorStop(0, `rgba(0,0,0,${0.3 * fade})`); disc.addColorStop(1, tone(0.08 + kick * 0.12));
  g.fillStyle = disc; g.beginPath(); g.arc(cx, cy, r * (1.05 + bass * 0.15), 0, Math.PI * 2); g.fill();
  // a ring of light that bursts outwards on each kick
  if(kick > 0.05){ g.strokeStyle = tone(kick * 0.6, 1); g.lineWidth = 2 * DPR; g.beginPath(); g.arc(cx, cy, r * (1.15 + (1 - mood.pulse) * 0.9), 0, Math.PI * 2); g.stroke(); }
  g.lineCap = 'round';
  const lw = Math.max(2, (2 * Math.PI * r / n) * lerp(0.6, 0.45, I));
  for(let i = 0; i < n; i++){
    const v = Math.pow(lv[i < n / 2 ? i * 2 : (n - 1 - i) * 2] || 0, lerp(1.3, 1.6, I)) * fade;
    const a = (i / n) * Math.PI * 2 - Math.PI / 2 + spin;
    const r1 = r * (1.12 + bass * 0.12), r2 = r1 + 6 * DPR + v * r * lerp(0.9, 1.3, I);
    const x1 = cx + Math.cos(a) * r1, y1 = cy + Math.sin(a) * r1, x2 = cx + Math.cos(a) * r2, y2 = cy + Math.sin(a) * r2;
    g.strokeStyle = tone(0.12); g.lineWidth = lw * 2.6;
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    g.strokeStyle = tone(0.35 + v * 0.65, v); g.lineWidth = lw;
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  }
}

/* ---------- Loop ---------- */

function frame(now){
  if(!running) return;
  requestAnimationFrame(frame);
  if(now - lastFrame < FRAME_MS) return;
  const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : FRAME_MS / 1000;
  lastFrame = now;
  updateMood(now);
  clock += dt * lerp(0.55, 1.6, mood.intensity);               // calm music slows everything down
  fade += ((active ? 1 : 0) - fade) * 0.08;
  const w = canvas.width, h = canvas.height;
  // Trails: calm music leaves soft afterimages; energetic music is crisp.
  // The scenes (nebula, orbit, album) move enough on their own and always draw crisp.
  const trail = SCENES[style] ? 1 : lerp(0.18, 1, clamp01((mood.intensity - 0.15) / 0.5));
  if(trail >= 0.99) g.clearRect(0, 0, w, h);
  else { g.globalCompositeOperation = 'destination-out'; g.fillStyle = `rgba(0,0,0,${trail})`; g.fillRect(0, 0, w, h); g.globalCompositeOperation = 'source-over'; }
  if(!active && fade < 0.02){ g.clearRect(0, 0, w, h); running = false; fade = 0; particles = []; return; }   // faded out: stop until needed
  if(SCENES[style]) SCENES[style](w, h);
  else if(style === 'wave') drawWave(w, h);
  else if(style === 'ring') drawRing(w, h);
  else drawBars(w, h);
  drawParticles(w, h);
}

function startDrawing(){ if(!running){ running = true; lastFrame = 0; requestAnimationFrame(frame); } }

window.viz.onConfig((config) => {
  style = config.style || 'bars';
  if(/^#[0-9a-f]{6}$/i.test(config.accent || '')){ accent = config.accent; accentHsl = hexToHsl(accent); }
  if(typeof config.bottomInset === 'number') bottomInset = config.bottomInset;
  document.body.dataset.style = style;
  smooth = []; particles = []; ripples = []; nebula = null; orbitTrails = PLANETS.map(() => []); starfield = null;
});
window.viz.onMedia((media) => {
  document.getElementById('title').textContent = media.title || '';
  document.getElementById('artist').textContent = media.artist || '';
  document.getElementById('now').classList.toggle('on', active && media.status === 'playing' && !!(media.title || media.artist));
});
window.viz.onCover((url) => setCover(url || ''));
// Listening starts with the music and outlasts short pauses, so showing the desktop again is instant.
window.viz.onListen((on) => { listening = on; if(on) PCCAudio.start(); else PCCAudio.stop(); });
window.viz.onActive((on) => {
  active = on;
  document.getElementById('now').classList.toggle('on', on && !!document.getElementById('title').textContent);
  if(on && listening) PCCAudio.start();
  startDrawing(); // when turning off, it keeps going until it has faded out
});
