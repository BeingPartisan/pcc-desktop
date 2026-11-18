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
let place = 'raised';                   // where bars and wave stand: 'raised' (just above the taskbar) or 'edge' (the screen's bottom edge)
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
// Rounds off the top: loud stays loud but never pins flat against the ceiling.
const softTop = (v) => Math.tanh(Math.max(0, v) * 1.5) / Math.tanh(1.5);
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
// These blend into `intensity`, 0 (still, soft) to 1 (hard, fast, bass-heavy).
// It rises within a fraction of a second, so a slow intro that drops into
// phonk is picked up the moment the drop hits, and falls back slowly, so a
// short break in the beat doesn't make it flicker. `pulse` jumps to 1 on
// each kick and dies away.
// Levels are also auto-scaled, so a quiet song still fills the screen.

const mood = {
  intensity: 0.35, pulse: 0,
  loud: { now: 0.3, recent: 0.3 }, loudState: {},           // real loudness against the loudest of the last minute (dynamics.js)
  kickAvg: 0, kickPrev: 0, bassShare: 0.3,
  lastBeat: 0, beats: [],               // times of recent kicks (ms)
  bpm: 0,
};
window.__mood = mood; // for checking in tests

function updateMood(now, dt){
  mood.pulse *= lerp(0.84, 0.74, mood.intensity);     // kicks fade faster when the music is fast
  if(!PCCAudio.listening){ mood.intensity += (0.3 - mood.intensity) * 0.02; return; }

  // How loud it really is, now and over the last few seconds, against the loudest of the last minute.
  mood.loud = Dyn.loudness(mood.loudState, PCCAudio.rms(), dt);
  const b = PCCAudio.bands(24);
  const bass = avg(b, 0, 4), all = avg(b, 0, 24);
  mood.bassShare += (clamp01((bass / Math.max(all, 0.01)) / 2) - mood.bassShare) * Math.min(1, dt * 4);

  // A kick: the deep bass (unsmoothed) jumps well above its recent average,
  // and is rising rather than already fading. Ratios, so loudness doesn't matter.
  const kick = PCCAudio.kickLevel();
  const ratio = kick / Math.max(mood.kickAvg, 1e-4);
  const rising = kick > mood.kickPrev * 1.08;
  mood.kickPrev = kick;
  mood.kickAvg += (kick - mood.kickAvg) * Math.min(1, dt * 2.4);
  let kicked = false;
  if(kick > 0.002 && ratio > 1.45 && rising && now - mood.lastBeat > 240){
    mood.lastBeat = now;
    mood.pulse = Math.min(1, 0.45 + (ratio - 1.45) * 0.6);
    mood.beats.push(now);
    kicked = true;
  }
  mood.beats = mood.beats.filter(t => now - t < 4000);
  // Tempo only from a steady beat: the gaps between kicks have to agree. Three kicks are enough.
  mood.bpm = 0;
  if(mood.beats.length >= 3){
    const gaps = mood.beats.slice(1).map((t, i) => t - mood.beats[i]).sort((x, y) => x - y);
    const median = gaps[Math.floor(gaps.length / 2)];
    const spread = gaps.reduce((sum, gp) => sum + Math.abs(gp - median), 0) / gaps.length / median;
    if(spread < 0.2) mood.bpm = Math.round(60000 / median);
  }

  // Mostly how loud it is right now; extra when it just got much louder (a drop);
  // and kicks with real bass behind them. Up within a fraction of a second,
  // back down over a couple of seconds.
  const bassy = clamp01((mood.bassShare - 0.2) * 3.5);
  const kickRate = clamp01(mood.beats.length / 8) * bassy;
  const jump = Math.max(0, mood.loud.now - mood.loud.recent) * 3;
  const target = clamp01(0.55 * mood.loud.now + 0.15 * jump + 0.3 * kickRate - 0.05);
  mood.intensity += (target - mood.intensity) * Math.min(1, dt * (target > mood.intensity ? 6 : 0.5));
  if(kicked) onBeat(ratio);
}

// The readings everything is drawn from (see dynamics.js): the raw spectrum
// through a fixed loudness window, rising instantly and falling quickly.
//   spectrum(n, key, fall)  for the bars and the wave: falls fast, so kicks land sharply
//   levels(n)               for the other styles: the same reading, falling at a pace that suits the mood
const levelStates = {};
let frameDt = 1 / 60;
let sensitivity = 1;                    // Settings > Island > Music: shifts the loudness window
let calibrateWith = 0;                  // the band count of the first reading each frame, used for calibration
function frameStartReadings(){ calibrateWith = 0; }

function readSpectrum(n){
  if(PCCAudio.listening){
    const db = PCCAudio.spectrumDb(n);
    if(n === calibrateWith) Dyn.calibrate(db, frameDt);
    return db.map((d, i) => Dyn.windowed(d, i, n, sensitivity));
  }
  const t = performance.now() / 1000;  // not listening: a gentle made-up motion
  return Array.from({ length: n }, (_, i) => 0.22 + 0.16 * Math.sin(t * 2.1 + i * 0.45) * Math.sin(t * 0.6 + i * 0.11));
}

function spectrum(n, key, fall){
  if(!calibrateWith) calibrateWith = n;
  const st = levelStates[key + n] || (levelStates[key + n] = {});
  const target = readSpectrum(n);
  st.target = target;                   // the raw reading this frame, for spotting sudden jumps
  return Dyn.follow(st, target, frameDt, fall);
}

function levels(n){
  return spectrum(n, 'levels', lerp(1.6, 3.6, mood.intensity));
}

/* ---------- Particles ---------- */
// Energetic music: sparks thrown up on every kick. Calm music: a few motes
// of light drifting slowly upwards.
let particles = [];
function onBeat(strength = 1.5){
  // Sparks for energetic music, or for any really hard kick (so the first kicks of a drop get them too).
  if(!active || (mood.intensity < 0.45 && strength < 2.2)) return;
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
const floorY = (h) => place === 'edge' ? h - 2 * DPR : h - (bottomInset + 64) * DPR;

function roundRect(x, y, w, h, r){
  r = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// Bars, mirrored from the middle: the bass in the centre, the highs out to
// both edges, so the shape is symmetric and the beat lands in the middle.
// Heights are the raw spectrum through the fixed loudness window, so quiet
// passages sit low and a drop jumps up. A bar that jumps hard lights up and
// fades back over a moment. Every bar is a glowing capsule
// with a bright tip; a small cap marks its recent peak and falls back
// slowly; the floor flashes on a kick and the bars reflect in it.
let barPeaks = [], barFlash = [], barPrev = [];
function drawBars(w, h){
  const half = Math.max(24, Math.min(48, Math.round(w / (48 * DPR))));
  const lv = spectrum(half, 'bars', 3.2);
  const I = mood.intensity, kick = mood.pulse * I;
  if(barPeaks.length !== half){ barPeaks = lv.map(() => 0); barFlash = lv.map(() => 0); barPrev = lv.slice(); }
  // a sudden jump in a band lights its bars up
  for(let i = 0; i < half; i++){
    if(lv[i] - barPrev[i] > 0.18) barFlash[i] = 1;
    barFlash[i] = Math.max(0, barFlash[i] - frameDt * 2.8);
    barPrev[i] = lv[i];
  }
  const floor = floorY(h), n = half * 2, gap = w / n, bw = gap * lerp(0.58, 0.5, I), maxH = h * lerp(0.2, 0.3, I);
  document.body.style.setProperty('--floor', `${(h - floor + maxH * 0.85) / DPR}px`); // the title sits above the tallest bars

  // floor line, glowing with the bass and flashing on a kick
  const bass = (lv[0] + lv[1] + lv[2]) / 3;
  const line = g.createLinearGradient(0, 0, w, 0);
  line.addColorStop(0, tone(0)); line.addColorStop(0.5, tone(0.35 + bass * 0.3 + kick * 0.4, 1)); line.addColorStop(1, tone(0));
  g.fillStyle = line; g.fillRect(0, floor + 2 * DPR, w, (1.5 + kick * 2) * DPR);

  for(let k = 0; k < n; k++){
    const band = k < half ? half - 1 - k : k - half;                // centre outwards
    const v = clamp01(lv[band]) * fade, flash = barFlash[band] * fade;
    const bh = Math.max(4 * DPR, v * maxH), x = k * gap + (gap - bw) / 2, top = floor - bh;
    // peak cap: jumps up with the bar, then sinks slowly
    barPeaks[band] = Math.max(v, (barPeaks[band] || 0) - frameDt * 0.5);
    // glow behind
    g.fillStyle = tone(lerp(0.08, 0.14, I) + v * 0.1 + flash * 0.25, flash); roundRect(x - bw * (0.4 + flash * 0.5), top - (4 + flash * 6) * DPR, bw * (1.8 + flash), bh + (4 + flash * 6) * DPR, bw); g.fill();
    // the capsule: brighter and shifting hue towards its tip
    const body = g.createLinearGradient(0, top, 0, floor);
    body.addColorStop(0, tone(1, 0.6 + v * 0.4)); body.addColorStop(0.35, tone(0.9 + flash * 0.1, v * 0.5 + flash * 0.5)); body.addColorStop(1, tone(0.35 + flash * 0.3));
    g.fillStyle = body; roundRect(x, top, bw, bh, bw / 2); g.fill();
    // a thin highlight down its left side, like light on glass
    g.fillStyle = `rgba(255,255,255,${0.18 * v * fade})`; roundRect(x + bw * 0.18, top + bw * 0.3, bw * 0.18, Math.max(0, bh - bw * 0.6), bw * 0.1); g.fill();
    // peak cap
    const py = floor - Math.max(4 * DPR, barPeaks[band] * fade * maxH) - 6 * DPR;
    g.fillStyle = tone(0.85, 1); roundRect(x, py, bw, 2.5 * DPR, 1.25 * DPR); g.fill();
    // reflection
    const ref = g.createLinearGradient(0, floor + 5 * DPR, 0, floor + 5 * DPR + bh * 0.45);
    ref.addColorStop(0, tone(0.22)); ref.addColorStop(1, tone(0));
    g.fillStyle = ref; roundRect(x, floor + 5 * DPR, bw, bh * 0.45, bw / 2); g.fill();
  }
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
  const I = mood.intensity;
  const spec = spectrum(40, 'wave', 2.6);                            // the raw reading: follows the song as it plays
  const bandLevels = [(spec[0] + spec[2] + spec[4]) / 3, (spec[12] + spec[15] + spec[18]) / 3, (spec[26] + spec[30] + spec[34]) / 3];
  // the ambient ribbons follow their bands quickly on the way up, gently on the way down
  ribbonLevel = ribbonLevel.map((v, i) => v + (bandLevels[i] - v) * (bandLevels[i] > v ? 0.5 : 0.12));
  if(mood.pulse > 0.9 && (I > 0.3 || mood.pulse > 0.98) && (!ripples.length || clock - ripples[ripples.length - 1].born > 0.2)) ripples.push({ born: clock });
  ripples = ripples.filter(r => clock - r.born < 1.4);
  const mid = floorY(h) - h * 0.06;
  document.body.style.setProperty('--floor', `${(h - mid) / DPR + h * 0.12 / DPR}px`);
  const steps = 96;

  // 1. ambient ribbons, behind, fainter than before
  RIBBONS.forEach((r, ri) => {
    const amp = h * r.height * (0.12 + ribbonLevel[r.band] * lerp(0.8, 1.2, I)) * fade;
    const len = r.len * lerp(0.75, 1.5, I);
    const path = [];
    for(let i = 0; i <= steps; i++){
      const x = i / steps, edge = Math.sin(Math.PI * x);
      const y = Math.sin((x * len * Math.PI * 2) + clock * r.speed * Math.PI) * 0.75 + Math.sin((x * len * 1.7 * Math.PI * 2) - clock * r.speed * 1.3) * 0.25;
      path.push([x * w, mid + y * amp * edge]);
    }
    strokeSmooth(path, [[r.width * 5, 0.05], [r.width * 1.6, 0.4]], r.alpha * 0.7, ri / 2);
  });

  // 2. the live wave: the spectrum drawn as one smooth line, bass in the middle,
  //    highs out to both edges, with kick ripples running along it
  const pts = [];
  for(let i = 0; i <= steps; i++){
    const x = i / steps, d = Math.abs(x - 0.5) * 2;                  // 0 at the centre, 1 at the edges
    const pos = d * (spec.length - 1), lo = Math.floor(pos), t = pos - lo;
    let v = lerp(spec[lo], spec[Math.min(spec.length - 1, lo + 1)], t);
    for(const rp of ripples){ const age = clock - rp.born; v += Math.exp(-Math.pow((d - age * 0.8) / 0.06, 2)) * (1 - age / 1.4) * 0.5 * mood.intensity; }
    const edge = Math.pow(Math.sin(Math.PI * x), 0.6);
    pts.push([x * w, mid - clamp01(v) * h * lerp(0.16, 0.26, I) * edge * fade]);
  }
  // soft fill under the line
  const fill = g.createLinearGradient(0, mid - h * 0.25, 0, mid);
  fill.addColorStop(0, tone(0.22 + mood.pulse * I * 0.15, 0.6)); fill.addColorStop(1, tone(0));
  g.beginPath(); g.moveTo(0, mid);
  traceSmooth(pts); g.lineTo(w, mid); g.closePath();
  g.fillStyle = fill; g.fill();
  strokeSmooth(pts, [[12, 0.07], [5, 0.2], [2.2, 1]], 1, 0.4);
  // its mirror, faint, below the line
  strokeSmooth(pts.map(([x, y]) => [x, mid + (mid - y) * 0.35]), [[2, 0.25]], 1, 0.4);
}

function traceSmooth(path){
  for(let i = 1; i < path.length - 1; i++){
    const mx = (path[i][0] + path[i + 1][0]) / 2, my = (path[i][1] + path[i + 1][1]) / 2;
    g.quadraticCurveTo(path[i][0], path[i][1], mx, my);
  }
  g.lineTo(path[path.length - 1][0], path[path.length - 1][1]);
}

// layers: [[width, alpha], ...] from the widest glow to the line itself
function strokeSmooth(path, layers, alpha, tip){
  for(const [lw, a] of layers){
    g.beginPath(); g.moveTo(path[0][0], path[0][1]); traceSmooth(path);
    g.lineWidth = lw * DPR; g.strokeStyle = tone(a * alpha, tip);
    g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke();
  }
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
  const minGap = (style === 'bars' || style === 'wave') ? 0 : FRAME_MS;   // the sharp styles draw every frame
  if(now - lastFrame < minGap) return;
  const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 1 / 60;
  lastFrame = now;
  frameDt = dt;
  frameStartReadings();
  updateMood(now, dt);
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
  if(config.place) place = config.place;
  if(typeof config.sensitivity === 'number') sensitivity = config.sensitivity;
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
