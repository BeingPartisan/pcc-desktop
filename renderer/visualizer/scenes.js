// The three larger visualiser styles: Nebula, Orbit and Album art.
// Loaded after visualizer.js and drawn by its loop; they use its helpers
// (levels, mood, tone, clock, fade, DPR, g) and follow the same rules: the
// music's mood decides how they move (see "Mood" in visualizer.js).

/* ---------- Nebula ---------- */
// A slowly turning spiral galaxy wrapped in coloured gas.
//   Gas: soft, uneven clouds in three colours (your accent and two
//     neighbours on the colour wheel) that drift along the spiral arms and
//     brighten with their part of the music: bass near the core, highs at
//     the misty edge. Darker dust lanes run along the arms for depth.
//   Stars: tiny points of light with soft halos, some blue-white, some
//     warm; the brightest carry a little four-pointed sparkle. They twinkle
//     and glow with their band of the music.
//   Core: a bright bulge that swells with the bass and flashes on a kick.
// Inner parts turn faster than outer ones, as in a real galaxy. A kick
// sends a ring of light out through the arms and pushes the stars outwards;
// soft music lets the whole thing drift and breathe.
// Everything is painted once into small images ("sprites") and then only
// moved and scaled, which keeps it light.

const NEBULA_STARS = 420, NEBULA_CLOUDS = 70, NEBULA_DUST = 26;
let nebula = null;
let nebulaSprites = null;              // { key, clouds: [3 canvases], dust, stars: [3 canvases], sparkle }

function hslCss(h, s, l, a = 1){ return `hsla(${(h + 360) % 360}, ${s}%, ${l}%, ${a})`; }

// A soft, lumpy cloud: many faint blobs, faded out towards the edge.
function paintCloud(colour, seed){
  const n = 128, c = document.createElement('canvas'); c.width = c.height = n;
  const t = c.getContext('2d'), rnd = seeded(seed);
  for(let k = 0; k < 26; k++){
    const x = n * (0.25 + rnd() * 0.5), y = n * (0.25 + rnd() * 0.5), r = n * (0.08 + rnd() * 0.22);
    const gr = t.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, colour(0.22 + rnd() * 0.18)); gr.addColorStop(1, colour(0));
    t.fillStyle = gr; t.fillRect(0, 0, n, n);
  }
  const mask = t.createRadialGradient(n / 2, n / 2, n * 0.1, n / 2, n / 2, n / 2);
  mask.addColorStop(0, 'rgba(0,0,0,1)'); mask.addColorStop(1, 'rgba(0,0,0,0)');
  t.globalCompositeOperation = 'destination-in'; t.fillStyle = mask; t.fillRect(0, 0, n, n);
  return c;
}

// A star: bright centre, soft halo.
function paintStar(rgb){
  const n = 32, c = document.createElement('canvas'); c.width = c.height = n;
  const t = c.getContext('2d'), gr = t.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.12, `rgba(${rgb},0.95)`); gr.addColorStop(0.35, `rgba(${rgb},0.25)`); gr.addColorStop(1, `rgba(${rgb},0)`);
  t.fillStyle = gr; t.fillRect(0, 0, n, n);
  return c;
}

// A four-pointed sparkle for the brightest stars.
function paintSparkle(){
  const n = 64, c = document.createElement('canvas'); c.width = c.height = n;
  const t = c.getContext('2d');
  for(const [w, h] of [[n, 3], [3, n]]){
    const gr = w > h ? t.createLinearGradient(0, 0, n, 0) : t.createLinearGradient(0, 0, 0, n);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    t.fillStyle = gr; t.fillRect((n - w) / 2, (n - h) / 2, w, h);
  }
  return c;
}

function nebulaSpritesFor(hsl){
  const key = hsl.map(Math.round).join(',');
  if(nebulaSprites && nebulaSprites.key === key) return nebulaSprites;
  const [h, s] = hsl;
  const sat = Math.max(55, Math.min(85, s));
  // The accent, a close neighbour, and a deep-space blue-violet nudged towards the accent:
  // that keeps any accent colour looking like a nebula rather than a set of party lights.
  const hues = [h, h + 30, 245 + ((((h - 245) % 360) + 540) % 360 - 180) * 0.15];
  nebulaSprites = {
    key,
    clouds: hues.map((hue, i) => paintCloud((a) => hslCss(hue, sat, 62, a), 11 + i * 17)),
    dust: paintCloud((a) => `rgba(0,0,0,${a * 1.6})`, 77),
    stars: ['255,255,255', '200,220,255', '255,226,190'].map(paintStar),
    sparkle: paintSparkle(),
  };
  return nebulaSprites;
}

function makeNebula(){
  const rnd = seeded(2024);
  const armAngle = (r, arm, spread) => arm * (Math.PI * 2 / 3) + r * 4.4 + (rnd() - 0.5) * spread;
  const stars = [], clouds = [], dust = [];
  for(let i = 0; i < NEBULA_STARS; i++){
    const r = Math.pow(rnd(), 0.8);
    stars.push({
      r, a: armAngle(r, i % 3, lerp(1.4, 0.45, r)),
      band: Math.min(23, Math.floor(r * 22 + rnd() * 3)),
      depth: rnd(), tw: rnd() * Math.PI * 2,
      kind: rnd() < 0.55 ? 0 : rnd() < 0.6 ? 1 : 2,                 // white, blue-white, warm
      bright: rnd() < 0.05,                                         // gets a sparkle
      push: 0,
    });
  }
  for(let i = 0; i < NEBULA_CLOUDS; i++){
    const r = 0.12 + Math.pow(rnd(), 0.9) * 0.9;
    clouds.push({ r, a: armAngle(r, i % 3, 0.7), size: lerp(0.28, 0.6, rnd()), colour: Math.floor(rnd() * 3), spin: rnd() * Math.PI * 2, band: Math.min(23, Math.floor(r * 20)), alpha: lerp(0.35, 0.8, rnd()) });
  }
  for(let i = 0; i < NEBULA_DUST; i++){
    const r = 0.25 + rnd() * 0.65;
    dust.push({ r, a: armAngle(r, i % 3, 0.3) - 0.25, size: lerp(0.18, 0.35, rnd()), spin: rnd() * Math.PI * 2 });   // along the inner edge of each arm
  }
  return { stars, clouds, dust, shockAt: -10 };
}

function drawNebula(w, h){
  if(!nebula) nebula = makeNebula();
  const sp = nebulaSpritesFor(accentHsl);
  const lv = levels(24);
  const I = mood.intensity, kick = mood.pulse * I;
  const cx = w * 0.5, cy = h * 0.46;
  const R = Math.min(w, h) * 0.4 * (1 + (lv[0] + lv[1]) * 0.04);
  const tilt = 0.44;                                               // the disc is seen at an angle
  const swirl = clock * 0.16;
  const turn = (r) => swirl * lerp(0.3, 1, 1 - r);                 // inner parts turn faster
  const place = (r, a) => [cx + Math.cos(a) * r * R, cy + Math.sin(a) * r * R * tilt];
  if(mood.pulse > 0.95 && I > 0.4 && clock - nebula.shockAt > 0.3) nebula.shockAt = clock;
  const shockAge = clock - nebula.shockAt;
  document.body.style.setProperty('--floor', `${(bottomInset + 60)}px`);

  // 1. gas clouds, glowing with their band
  g.globalCompositeOperation = 'lighter';
  for(const c of nebula.clouds){
    const [x, y] = place(c.r, c.a + turn(c.r));
    const glow = lv[c.band];
    const size = R * c.size * (1 + glow * 0.25);
    g.save(); g.translate(x, y); g.rotate(c.spin + swirl * 0.3); g.scale(1, 0.6);
    g.globalAlpha = c.alpha * (0.2 + glow * lerp(0.4, 0.65, I)) * fade;
    g.drawImage(sp.clouds[c.colour], -size / 2, -size / 2, size, size);
    g.restore();
  }
  // 2. dark dust along the arms, for depth
  g.globalCompositeOperation = 'source-over';
  for(const d of nebula.dust){
    const [x, y] = place(d.r, d.a + turn(d.r));
    const size = R * d.size;
    g.save(); g.translate(x, y); g.rotate(d.spin); g.scale(1, 0.5);
    g.globalAlpha = 0.28 * fade; g.drawImage(sp.dust, -size / 2, -size / 2, size, size);
    g.restore();
  }
  // 3. the core: a bright bulge that swells with the bass and flashes on a kick
  g.globalCompositeOperation = 'lighter';
  const bass = (lv[0] + lv[1] + lv[2]) / 3;
  const coreR = R * (0.2 + bass * 0.06 + kick * 0.05);
  const core = g.createRadialGradient(cx, cy, 0, cx, cy, coreR);
  core.addColorStop(0, `rgba(255,250,240,${(0.75 + kick * 0.25) * fade})`); core.addColorStop(0.25, tone(0.45 + bass * 0.3)); core.addColorStop(1, tone(0));
  g.save(); g.translate(cx, cy); g.scale(1, tilt * 1.25); g.translate(-cx, -cy);
  g.fillStyle = core; g.beginPath(); g.arc(cx, cy, coreR, 0, Math.PI * 2); g.fill();
  g.restore();

  // 4. a ring of light running outwards after a kick
  if(shockAge < 1.3){
    const front = shockAge * 0.85, a = (1 - shockAge / 1.3) * 0.5 * fade;
    g.strokeStyle = tone(a, 0.5); g.lineWidth = R * 0.02 * (1 - shockAge / 1.3) + DPR;
    g.beginPath(); g.ellipse(cx, cy, front * R, front * R * tilt, 0, 0, Math.PI * 2); g.stroke();
  }

  // 5. stars
  for(const s of nebula.stars){
    if(shockAge < 1.3){ const hit = Math.exp(-Math.pow((s.r - shockAge * 0.85) / 0.07, 2)); s.push = Math.max(s.push, hit * 0.1 * I); }
    s.push *= 0.93;
    const [x, y] = place(s.r + s.push, s.a + turn(s.r));
    const glow = lv[s.band];
    const twinkle = 0.7 + 0.3 * Math.sin(clock * lerp(1.5, 4, I) + s.tw * 5);
    const size = (2.2 + s.depth * 4) * DPR * (1 + glow * lerp(0.5, 1.1, I));
    g.globalAlpha = Math.min(1, (0.3 + glow * 0.8) * lerp(0.55, 1, s.depth) * twinkle) * fade;
    g.drawImage(sp.stars[s.kind], x - size, y - size, size * 2, size * 2);
    if(s.bright){
      const ss = size * (2.2 + glow * 2 + kick * 2);
      g.globalAlpha = (0.35 + glow * 0.5 + kick * 0.3) * twinkle * fade;
      g.drawImage(sp.sparkle, x - ss, y - ss, ss * 2, ss * 2);
    }
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}

/* ---------- Orbit ---------- */
// A small solar system. The star glows in your accent colour; the planets
// look like planets: a banded gas giant for the bass, a ringed world with a
// moon for the middle, an icy world and a little rocky one for the highs.
// Their surfaces are painted once into textures and slide past as they
// turn, and each is lit from the star's side with a soft day/night edge.
// Each planet's orbit swings wider and its atmosphere glows brighter as its
// part of the music gets louder, so you can see which part of the song is
// doing the work. A kick makes the star flare.

const PLANETS = [
  { band: [0, 3],   orbit: 0.36, speed: 0.36, size: 0.050, kind: 'gas',  colours: ['#c98f5a', '#e8c39a', '#a8683c', '#f1dcc0', '#8c5532'], spin: 0.05, phase: 0.3 },
  { band: [6, 11],  orbit: 0.56, speed: -0.26, size: 0.036, kind: 'gas', colours: ['#d9c08e', '#efe0b8', '#bfa06a', '#e6cf9d'], spin: 0.04, phase: 2.2, ring: true, moon: true },
  { band: [14, 18], orbit: 0.74, speed: 0.5,  size: 0.022, kind: 'ice',  colours: ['#8fc8e8', '#d8f0fb', '#5c9cc4'], spin: 0.03, phase: 4.0 },
  { band: [19, 23], orbit: 0.88, speed: -0.7, size: 0.015, kind: 'rock', colours: ['#c0603e', '#e0906a', '#7c3a24'], spin: 0.06, phase: 5.1 },
];
let orbitTrails = PLANETS.map(() => []);
let planetTextures = null;
let starfield = null;

// Deterministic pseudo-random numbers, so a planet looks the same every time.
function seeded(seed){ return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

// A planet's surface, painted twice as wide as it is tall so it can scroll as the planet turns.
function paintPlanet(p, index){
  const h = 128, w = 256;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const t = c.getContext('2d');
  const rnd = seeded(97 + index * 131);
  const [base, ...others] = p.colours;
  t.fillStyle = base; t.fillRect(0, 0, w, h);
  if(p.kind === 'gas'){
    // bands of cloud, each wobbling a little
    for(let y = 0; y < h; y += 2){
      const colour = p.colours[Math.floor((Math.sin(y * 0.19 + rnd() * 0.6) * 0.5 + 0.5) * p.colours.length) % p.colours.length];
      t.globalAlpha = 0.35 + rnd() * 0.4; t.fillStyle = colour;
      t.beginPath(); t.moveTo(0, y);
      for(let x = 0; x <= w; x += 16) t.lineTo(x, y + Math.sin(x * 0.05 + y) * 1.5);
      t.lineTo(w, y + 3); t.lineTo(0, y + 3); t.closePath(); t.fill();
    }
    // a storm or two
    for(let k = 0; k < 2; k++){
      const sx = rnd() * w, sy = h * (0.3 + rnd() * 0.4), sr = 6 + rnd() * 8;
      t.globalAlpha = 0.7; t.fillStyle = others[k % others.length];
      t.beginPath(); t.ellipse(sx, sy, sr * 1.8, sr, 0, 0, Math.PI * 2); t.fill();
      t.globalAlpha = 0.5; t.fillStyle = base; t.beginPath(); t.ellipse(sx, sy, sr, sr * 0.5, 0, 0, Math.PI * 2); t.fill();
    }
  } else {
    // mottled surface: patches of the other colours, then craters (rock) or bright frost (ice)
    for(let k = 0; k < 140; k++){
      t.globalAlpha = 0.15 + rnd() * 0.3; t.fillStyle = others[k % others.length];
      t.beginPath(); t.arc(rnd() * w, rnd() * h, 3 + rnd() * 14, 0, Math.PI * 2); t.fill();
    }
    for(let k = 0; k < (p.kind === 'rock' ? 30 : 12); k++){
      const x = rnd() * w, y = rnd() * h, r = 1.5 + rnd() * 5;
      t.globalAlpha = 0.45; t.fillStyle = p.kind === 'rock' ? 'rgba(40,15,8,1)' : '#ffffff';
      t.beginPath(); t.arc(x, y, r, 0, Math.PI * 2); t.fill();
      if(p.kind === 'rock'){ t.globalAlpha = 0.3; t.fillStyle = '#f2b08c'; t.beginPath(); t.arc(x - r * 0.3, y - r * 0.3, r * 0.6, 0, Math.PI * 2); t.fill(); }
    }
    if(p.kind === 'ice'){ t.globalAlpha = 0.6; t.fillStyle = '#ffffff'; t.fillRect(0, 0, w, 10); t.fillRect(0, h - 10, w, 10); }   // polar caps
  }
  t.globalAlpha = 1;
  return c;
}

function makeStarfield(w, h){
  const rnd = seeded(7);
  return Array.from({ length: 70 }, () => ({ x: rnd() * w, y: rnd() * h * 0.85, r: (0.4 + rnd() * 1.1) * DPR, tw: rnd() * 6 }));
}

function drawPlanetBody(pl, x, y, r, cx, cy){
  const tex = planetTextures[pl.i];
  // surface, scrolling as it turns
  g.save();
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.clip();
  const scroll = ((clock * pl.p.spin) % 1) * 2 * r * 2;
  g.globalAlpha = fade;
  g.drawImage(tex, x - r - scroll, y - r, r * 4, r * 2);
  g.drawImage(tex, x - r - scroll + r * 4, y - r, r * 4, r * 2);
  // a round look: darker towards the rim
  const round = g.createRadialGradient(x, y, r * 0.2, x, y, r);
  round.addColorStop(0, 'rgba(0,0,0,0)'); round.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = round; g.fillRect(x - r, y - r, r * 2, r * 2);
  // night side: dark away from the star, with a soft edge
  const toStar = Math.atan2(cy - y, cx - x);
  const lx = x + Math.cos(toStar) * r * 0.9, ly = y + Math.sin(toStar) * r * 0.9;
  const night = g.createRadialGradient(lx, ly, r * 0.3, lx, ly, r * 2.1);
  night.addColorStop(0, 'rgba(0,0,0,0)'); night.addColorStop(0.5, 'rgba(0,0,0,0.55)'); night.addColorStop(1, 'rgba(0,0,0,0.92)');
  g.fillStyle = night; g.fillRect(x - r, y - r, r * 2, r * 2);
  g.restore();
  // atmosphere: a thin bright rim on the lit side, brighter when its part of the music is loud
  g.strokeStyle = `rgba(255,255,255,${(0.18 + pl.v * 0.35) * fade})`; g.lineWidth = Math.max(1, r * 0.08);
  g.beginPath(); g.arc(x, y, r * 0.98, toStar - 1.2, toStar + 1.2); g.stroke();
  const haze = g.createRadialGradient(x, y, r, x, y, r * (1.35 + pl.v * 0.4));
  haze.addColorStop(0, `rgba(${hexRgb(pl.p.colours[1])},${(0.18 + pl.v * 0.3) * fade})`); haze.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = haze; g.beginPath(); g.arc(x, y, r * (1.35 + pl.v * 0.4), 0, Math.PI * 2); g.fill();
}

const hexRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `${n >> 16 & 255},${n >> 8 & 255},${n & 255}`; };

// Saturn-like rings: several translucent bands; `half` is 'back' or 'front' so the planet sits between them.
function drawRings(x, y, r, half){
  const tiltA = -0.32;
  g.save(); g.translate(x, y); g.rotate(tiltA);
  const start = half === 'back' ? Math.PI : 0, end = half === 'back' ? Math.PI * 2 : Math.PI;
  [[1.45, 0.25], [1.65, 0.5], [1.85, 0.35], [2.05, 0.55], [2.25, 0.2]].forEach(([k, a]) => {
    g.strokeStyle = `rgba(230,214,170,${a * fade})`; g.lineWidth = r * 0.16;
    g.beginPath(); g.ellipse(0, 0, r * k, r * k * 0.28, 0, start, end); g.stroke();
  });
  g.restore();
}

function drawOrbit(w, h){
  const lv = levels(24);
  const I = mood.intensity;
  const cx = w * 0.5, cy = h * 0.46, M = Math.min(w, h) * 0.5;
  const tilt = 0.34;
  const bass = (lv[0] + lv[1] + lv[2]) / 3;
  if(!planetTextures) planetTextures = PLANETS.map(paintPlanet);
  if(!starfield || starfield.w !== w) { starfield = makeStarfield(w, h); starfield.w = w; }
  document.body.style.setProperty('--floor', `${(bottomInset + 60)}px`);

  // faint background stars, twinkling with the highs
  const highs = (lv[18] + lv[20] + lv[22]) / 3;
  for(const s of starfield){
    g.fillStyle = `rgba(255,255,255,${(0.25 + 0.35 * Math.sin(clock * 2 + s.tw) * 0.5 + highs * 0.3) * fade})`;
    g.beginPath(); g.arc(s.x, s.y, s.r, 0, Math.PI * 2); g.fill();
  }

  const planets = PLANETS.map((p, i) => {
    let v = 0; for(let b = p.band[0]; b <= p.band[1]; b++) v += lv[b]; v /= (p.band[1] - p.band[0] + 1);
    const angle = p.phase + clock * p.speed;
    const rr = M * p.orbit * (1 + v * 0.1);
    const depth = Math.sin(angle);                                   // -1 far side, 1 near side
    return { p, i, v, angle, rr, depth, x: cx + Math.cos(angle) * rr, y: cy + depth * rr * tilt, behind: depth < 0 };
  });

  // orbit paths: fine dotted ellipses
  g.save(); g.setLineDash([2 * DPR, 7 * DPR]);
  for(const pl of planets){
    g.strokeStyle = `rgba(255,255,255,${(0.12 + pl.v * 0.18) * fade})`; g.lineWidth = 1 * DPR;
    g.beginPath(); g.ellipse(cx, cy, pl.rr, pl.rr * tilt, 0, 0, Math.PI * 2); g.stroke();
  }
  g.restore();

  const drawPlanet = (pl) => {
    const { p } = pl;
    const r = M * p.size * (1 + pl.v * lerp(0.15, 0.3, I)) * (1 + pl.depth * 0.12);   // nearer looks bigger
    // a fading trail of light behind it
    const trail = orbitTrails[pl.i];
    trail.push([pl.x, pl.y]); if(trail.length > Math.round(lerp(22, 10, I))) trail.shift();
    trail.forEach(([tx, ty], k) => { g.fillStyle = `rgba(${hexRgb(p.colours[1])},${(k / trail.length) * 0.18 * (0.4 + pl.v) * fade})`; g.beginPath(); g.arc(tx, ty, r * 0.35 * (k / trail.length), 0, Math.PI * 2); g.fill(); });
    if(p.ring) drawRings(pl.x, pl.y, r, 'back');
    drawPlanetBody(pl, pl.x, pl.y, r, cx, cy);
    if(p.ring) drawRings(pl.x, pl.y, r, 'front');
    if(p.moon){
      const ma = clock * 1.8, mx = pl.x + Math.cos(ma) * r * 2.9, my = pl.y + Math.sin(ma) * r * 0.9;
      const toStar = Math.atan2(cy - my, cx - mx);
      g.fillStyle = `rgba(210,210,215,${fade})`; g.beginPath(); g.arc(mx, my, r * 0.22, 0, Math.PI * 2); g.fill();
      g.fillStyle = `rgba(0,0,0,${0.6 * fade})`; g.beginPath(); g.arc(mx, my, r * 0.22, toStar + Math.PI / 2, toStar + Math.PI * 1.5); g.fill();   // its night side
    }
  };

  planets.filter(pl => pl.behind).sort((a, b) => a.depth - b.depth).forEach(drawPlanet);

  // the star: wide soft glow in the accent colour, flares with the rhythm, white-hot centre
  const coreR = M * (0.065 + bass * 0.02) * (1 + mood.pulse * I * 0.2);
  g.globalCompositeOperation = 'lighter';
  const glow = g.createRadialGradient(cx, cy, coreR * 0.5, cx, cy, coreR * (5 + bass * 2));
  glow.addColorStop(0, tone(0.55 + mood.pulse * I * 0.3)); glow.addColorStop(0.25, tone(0.18)); glow.addColorStop(1, tone(0));
  g.fillStyle = glow; g.beginPath(); g.arc(cx, cy, coreR * (5 + bass * 2), 0, Math.PI * 2); g.fill();
  // soft corona streaks that follow the spectrum
  const rays = 36;
  for(let i = 0; i < rays; i++){
    const v = lv[Math.floor((i < rays / 2 ? i : rays - 1 - i) / (rays / 2) * 23)];
    const a = (i / rays) * Math.PI * 2 + clock * 0.06;
    const r2 = coreR * (1.6 + v * lerp(1.2, 2.6, I));
    const streak = g.createLinearGradient(cx, cy, cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
    streak.addColorStop(0, tone(0.5 * v + 0.1)); streak.addColorStop(1, tone(0));
    g.strokeStyle = streak; g.lineWidth = coreR * 0.18;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); g.stroke();
  }
  g.globalCompositeOperation = 'source-over';
  const core = g.createRadialGradient(cx - coreR * 0.25, cy - coreR * 0.25, coreR * 0.1, cx, cy, coreR);
  core.addColorStop(0, `rgba(255,255,255,${fade})`); core.addColorStop(0.55, tone(1)); core.addColorStop(1, tone(0.9, 0.3));
  g.fillStyle = core; g.beginPath(); g.arc(cx, cy, coreR, 0, Math.PI * 2); g.fill();

  planets.filter(pl => !pl.behind).sort((a, b) => a.depth - b.depth).forEach(drawPlanet);
}

/* ---------- Album art ---------- */
// A small card in the bottom-right corner: the cover of what's playing,
// shown no bigger than the picture really is so it stays sharp, with a
// vinyl record sliding out from behind it that spins with the music, a
// soft glow in the cover's own colours, and a row of bars underneath. The
// title and artist sit to its left. The whole style takes its colours from
// the cover. With no cover (some apps don't give Windows one) the record
// is shown on its own.

let cover = { url: '', img: null, ready: false, small: null, hsl: null };

function setCover(url){
  if(url === cover.url) return;
  cover = { url, img: null, ready: false, small: null, hsl: null };
  if(!url) return;
  const img = new Image();
  img.onload = () => {
    if(cover.url !== url) return;
    const small = document.createElement('canvas'); small.width = small.height = 12;
    const sg = small.getContext('2d'); sg.drawImage(img, 0, 0, 12, 12);
    // The glow: the cover blurred (tiny copy drawn big), faded towards its edge.
    const halo = document.createElement('canvas'); halo.width = halo.height = 96;
    const hg = halo.getContext('2d'); hg.imageSmoothingEnabled = true; hg.drawImage(small, 0, 0, 96, 96);
    const mask = hg.createRadialGradient(48, 48, 6, 48, 48, 48);
    mask.addColorStop(0, 'rgba(0,0,0,1)'); mask.addColorStop(0.55, 'rgba(0,0,0,0.6)'); mask.addColorStop(1, 'rgba(0,0,0,0)');
    hg.globalCompositeOperation = 'destination-in'; hg.fillStyle = mask; hg.fillRect(0, 0, 96, 96);
    cover.img = img; cover.small = halo; cover.hsl = vividColour(sg.getImageData(0, 0, 12, 12).data); cover.ready = true;
  };
  img.src = url;
}

// The most colourful bright-enough pixel of the cover, as [h, s, l].
function vividColour(px){
  let best = null, bestScore = -1;
  for(let i = 0; i < px.length; i += 4){
    const hsl = hexToHsl('#' + [px[i], px[i + 1], px[i + 2]].map(v => v.toString(16).padStart(2, '0')).join(''));
    const score = hsl[1] * (1 - Math.abs(hsl[2] - 55) / 55);
    if(score > bestScore){ bestScore = score; best = hsl; }
  }
  if(!best || best[1] < 18) return null;                       // a grey cover: keep the accent
  return [best[0], Math.max(55, best[1]), Math.min(68, Math.max(52, best[2]))];
}

function drawAlbum(w, h){
  const lv = levels(32);
  const I = mood.intensity;
  const saved = accentHsl;
  if(cover.hsl) accentHsl = cover.hsl;                           // this style wears the cover's colours
  // No bigger than the picture really is (a little over is fine), between 120 and 220 points.
  const natural = cover.ready ? cover.img.naturalWidth * 1.3 : 200 * DPR;
  const size = Math.max(120 * DPR, Math.min(220 * DPR, natural)) * (1 + mood.pulse * I * 0.03);
  const margin = 56 * DPR;
  const barRoom = size * 0.24 + 14 * DPR;                         // the bars stand below the card, never over it
  const cx = w - margin - size / 2, cy = h - (bottomInset + 56) * DPR - barRoom - size / 2;
  const recordX = cx - size * 0.42;                               // the record peeks out to the left
  document.body.style.setProperty('--album-right', `${(w - recordX + size * 0.62) / DPR}px`);
  document.body.style.setProperty('--album-mid', `${(h - cy) / DPR}px`);

  // glow
  if(cover.ready){
    g.save(); g.globalAlpha = (0.35 + (lv[0] + lv[1]) * 0.2) * fade;
    const hs = size * (2.4 + (lv[0] + lv[1]) * 0.2);
    g.drawImage(cover.small, cx - size * 0.2 - hs / 2, cy - hs / 2, hs, hs);
    g.restore();
  }

  // the record, spinning
  g.save(); g.translate(recordX + Math.sin(clock * 0.8) * size * 0.01, cy); drawVinyl(size * 0.94); g.restore();

  // the cover (or nothing, when the record stands alone)
  if(cover.ready){
    const tilt = Math.sin(clock * 0.6) * lerp(0.01, 0.025, I);
    g.save(); g.translate(cx, cy + Math.sin(clock * 0.9) * size * 0.012); g.rotate(tilt);
    g.fillStyle = `rgba(0,0,0,${0.4 * fade})`; roundRect(-size / 2 + 4 * DPR, -size / 2 + 10 * DPR, size, size, size * 0.04); g.fill();
    g.save(); roundRect(-size / 2, -size / 2, size, size, size * 0.04); g.clip();
    g.globalAlpha = fade; g.imageSmoothingQuality = 'high'; g.drawImage(cover.img, -size / 2, -size / 2, size, size);
    const shine = g.createLinearGradient(-size / 2, -size / 2, size / 2, size / 2);
    shine.addColorStop(0, `rgba(255,255,255,${0.12 + mood.pulse * I * 0.1})`); shine.addColorStop(0.45, 'rgba(255,255,255,0)');
    g.fillStyle = shine; g.fillRect(-size / 2, -size / 2, size, size);
    g.restore(); g.restore();
  }

  // a row of bars under the card
  const left = recordX - size * 0.47, right = cx + size / 2, n = 28, gap = (right - left) / n, floor = cy + size / 2 + barRoom;
  for(let i = 0; i < n; i++){
    const v = Math.pow(lv[i], 1.4) * fade, bh = Math.max(2 * DPR, v * size * 0.24), bw = gap * 0.55;
    g.fillStyle = tone(0.35 + v * 0.65, v); roundRect(left + i * gap + (gap - bw) / 2, floor - bh, bw, bh, bw / 2); g.fill();
  }
  accentHsl = saved;
}

function drawVinyl(size){
  const r = size * 0.5;
  g.rotate(clock * lerp(0.6, 1.8, mood.intensity));
  g.fillStyle = `rgba(14,14,16,${0.97 * fade})`; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
  g.lineWidth = 1 * DPR;
  for(let k = 0.42; k < 0.98; k += 0.04){ g.strokeStyle = `rgba(255,255,255,${0.05 * fade})`; g.beginPath(); g.arc(0, 0, r * k, 0, Math.PI * 2); g.stroke(); }
  g.strokeStyle = `rgba(255,255,255,${0.12 * fade})`; g.lineWidth = 5 * DPR;   // light catching the grooves
  g.beginPath(); g.arc(0, 0, r * 0.72, -0.6, -0.1); g.stroke();
  if(cover.ready){ g.save(); g.beginPath(); g.arc(0, 0, r * 0.33, 0, Math.PI * 2); g.clip(); g.globalAlpha = fade; g.drawImage(cover.img, -r * 0.33, -r * 0.33, r * 0.66, r * 0.66); g.restore(); }
  else { g.fillStyle = tone(0.95); g.beginPath(); g.arc(0, 0, r * 0.33, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = `rgba(14,14,16,${fade})`; g.beginPath(); g.arc(0, 0, r * 0.035, 0, Math.PI * 2); g.fill();
}

const SCENES = { nebula: drawNebula, orbit: drawOrbit, album: drawAlbum };
