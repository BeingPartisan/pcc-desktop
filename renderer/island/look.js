// The island's music look, while something plays:
//   wave  - glowing lines that swell with the sound
//   bars  - small bars mirrored from the middle
//   glow  - light breathing out around the island like coloured smoke
// At full size it sits softly behind the track name (fainter with the panel
// open). When the island has shrunk to its small handle (another app's
// maximised window is in front), the handle itself becomes the look, with no
// black behind it. Colours come from the album cover (or the accent colour,
// or a slow rainbow).
//
// island.js calls IslandLook.update({ look, colors, accent, active, handle, open, nudging })
// whenever it renders, IslandLook.cover(url) for a new cover and
// IslandLook.perf(profile) when the Performance mode changes. The sound itself
// comes from PCCAudio (../visualizer/audio.js), already listening for the bars.

const IslandLook = (() => {
  const canvas = document.getElementById('look');
  const ctx = canvas.getContext('2d');
  const N = 16;                       // levels from low to high
  const island = document.getElementById('island');
  let opts = { look: 'off', colors: 'album', accent: '#C9F26C', active: false, handle: false, open: false, nudging: false };
  let albumColors = null;             // up to three colours from the cover
  let fps = 60, lastFrame = 0, running = false;
  let lv = new Array(N).fill(0), peaks = new Array(N).fill(0);
  let fast = 0, slow = 0;             // loudness, quickly and slowly averaged: the gap is a "drop"
  let fade = 0;                       // 0..1, eases in when music starts and out when it stops

  /* ----- Colours ----- */

  const hex = (h, s, l) => {
    const a = s * Math.min(l, 1 - l), f = (n) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return '#' + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
  };
  function toHsl(r, g, b){
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if(!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }
  // The cover's strongest colours, brightened so they glow on black.
  function pickColors(img){
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0, 32, 32);
    const px = x.getImageData(0, 0, 32, 32).data;
    const buckets = new Array(12).fill(null).map(() => ({ w: 0, h: 0, s: 0 }));
    for(let i = 0; i < px.length; i += 4){
      const [h, s, l] = toHsl(px[i], px[i + 1], px[i + 2]);
      if(s < 0.22 || l < 0.12 || l > 0.9) continue;
      const b = buckets[Math.floor(h / 30) % 12], w = s * (1 - Math.abs(l - 0.5));
      b.w += w; b.h += h * w; b.s += s * w;
    }
    // The strongest colours that are clearly different from each other (at least 50° apart).
    const top = [];
    for(const b of buckets.filter(b => b.w > 1.5).sort((a, b) => b.w - a.w)){
      const h = b.h / b.w, dist = (x) => Math.min(Math.abs(x - h), 360 - Math.abs(x - h));
      if(top.every(([x]) => dist(x) >= 50)) top.push([h, Math.max(0.7, b.s / b.w)]);
      if(top.length === 3) break;
    }
    if(!top.length) return null;
    while(top.length < 3) top.push([(top[0][0] + 40 * top.length) % 360, top[0][1]]);   // a single-colour cover: its neighbours
    return top.map(([h, s]) => hex(h, Math.min(1, s), 0.62));
  }
  function cover(url){
    albumColors = null;
    if(!url) return;
    const img = new Image();
    img.onload = () => { try { albumColors = pickColors(img); } catch(e){ albumColors = null; } };
    img.src = url;
  }
  function palette(t){
    if(opts.colors === 'rainbow'){ const h = (t * 30) % 360; return [hex(h, 0.9, 0.62), hex((h + 70) % 360, 0.9, 0.6), hex((h + 140) % 360, 0.9, 0.62)]; }
    if(opts.colors === 'album' && albumColors) return albumColors;
    const [h, s] = toHsl(...[1, 3, 5].map(i => parseInt(opts.accent.slice(i, i + 2), 16)));
    return [hex(h, Math.max(s, 0.6), 0.62), hex((h + 25) % 360, Math.max(s, 0.6), 0.5), hex((h - 25 + 360) % 360, Math.max(s, 0.6), 0.72)];
  }

  /* ----- Sound ----- */

  function levels(t){
    if(typeof PCCAudio !== 'undefined' && PCCAudio.listening) return PCCAudio.bands(N);
    // Can't hear the sound (not allowed, or nothing reaches the speakers yet): a gentle made-up beat.
    const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 * 1.9)), 6);
    return Array.from({ length: N }, (_, i) => { const f = i / N; return Math.min(1, 0.85 * (1 - f) * beat + 0.4 * Math.abs(Math.sin(t * 2.6 + i * 0.8)) * (0.5 + f * 0.5)); });
  }

  /* ----- Drawing ----- */

  function size(){
    const r = canvas.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
    if(canvas.width !== w || canvas.height !== h){ canvas.width = w; canvas.height = h; }
    ctx.setTransform(d, 0, 0, d, 0, 0);
    return [r.width, r.height];
  }
  const gradient = (w, p) => { const g = ctx.createLinearGradient(0, 0, w, 0); g.addColorStop(0, p[0]); g.addColorStop(0.5, p[1]); g.addColorStop(1, p[2]); return g; };
  // The level for a point across the island: lows in the middle, highs at the ends.
  const at = (u) => lv[Math.min(N - 1, Math.floor(Math.abs(u - 0.5) * 2 * N))];

  function drawWave(w, h, p, t, boost){
    for(let k = 0; k < 3; k++){
      ctx.beginPath();
      for(let s = 0; s <= 64; s++){
        const u = s / 64;
        const a = at(u) * h * 0.44 * (1 - k * 0.22) * boost;
        const y = h / 2 + Math.sin(u * Math.PI * (3 + k) + t * (2.2 + k) * 1.3) * a * Math.sin(u * Math.PI);
        s ? ctx.lineTo(u * w, y) : ctx.moveTo(0, y);
      }
      ctx.strokeStyle = gradient(w, [p[k % 3], p[(k + 1) % 3], p[(k + 2) % 3]]);
      ctx.lineWidth = k ? 1.6 : 2.6;
      ctx.globalAlpha *= k ? 0.7 : 1;
      ctx.stroke();
    }
  }
  function drawBars(w, h, p, boost){
    const n = Math.max(10, Math.floor(w / 8)), bw = w / n, room = Math.max(2, h - (h > 20 ? 8 : 2));
    ctx.fillStyle = gradient(w, p);
    for(let j = 0; j < n; j++){
      const i = Math.min(N - 1, Math.floor(Math.abs(j - (n - 1) / 2) / (n / 2) * N));
      const bh = Math.max(1.5, Math.min(1, lv[i] * boost) * room);
      ctx.beginPath(); ctx.roundRect(j * bw + bw * 0.22, (h - bh) / 2, bw * 0.56, bh, Math.min(2, bw * 0.28)); ctx.fill();
      if(h > 20) ctx.fillRect(j * bw + bw * 0.22, (h - Math.min(1, peaks[i] * boost) * room) / 2 - 2.5, bw * 0.56, 1.5);
    }
  }
  // Glow at full size: mostly outside the island (its shadow, below); inside, a faint wash of colour.
  function drawGlowWash(w, h, p, t, bass){
    const cx = w * (0.5 + 0.3 * Math.sin(t * 0.6));
    const g = ctx.createRadialGradient(cx, h / 2, 0, cx, h / 2, w * 0.6);
    g.addColorStop(0, p[0]); g.addColorStop(1, 'transparent');
    ctx.globalAlpha *= 0.12 + bass * 0.25;
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
  // Light breathing out around the full-size island: three colours drifting like smoke, and a wide haze on the bass.
  function glowShadow(p, t, bass, boost){
    // Only around the closed island: opened into its panel, it's a plain panel again.
    if(opts.look !== 'glow' || opts.handle || fade <= 0 || opts.nudging || island.classList.contains('open')) return '';
    const alpha = (v) => Math.round(Math.max(0, Math.min(1, v * fade)) * 255).toString(16).padStart(2, '0');
    const a = alpha(0.6 + bass * 0.4), soft = alpha(0.35 + bass * 0.45), haze = alpha(0.18 + bass * 0.3);
    const blur = 14 + bass * 26 * boost, spread = bass * 5 * boost;
    const puff = (k, al, scale) => {
      const x = Math.sin(t * 0.7 + k * 2.1) * 9 * (0.6 + bass), y = 4 + Math.cos(t * 0.5 + k * 1.7) * 5 * (0.6 + bass);
      return `${x.toFixed(1)}px ${y.toFixed(1)}px ${(blur * scale).toFixed(1)}px ${spread.toFixed(1)}px ${p[k]}${al}`;
    };
    return [puff(0, a, 1), puff(1, soft, 1.4), puff(2, soft, 1.2),
      `0 6px ${(36 + bass * 30 * boost).toFixed(1)}px ${(2 + bass * 6).toFixed(1)}px ${p[1]}${haze}`, `0 0 0 1px ${p[0]}${a}`].join(', ');
  }
  // Glow as the shrunk handle: soft puffs of colour drifting past each other like smoke,
  // swelling with the bass, around a thin bright line through the middle.
  function drawGlow(w, h, p, t, bass, boost){
    const base = ctx.globalAlpha;
    ctx.filter = `blur(${(2.5 + bass * 2.5).toFixed(1)}px)`;
    for(const [k, speed, phase] of [[0, 0.6, 0], [2, 0.45, 2.2], [1, 0.8, 4.1]]){
      const cx = w * (0.5 + 0.32 * Math.sin(t * speed + phase));
      ctx.globalAlpha = base * (0.45 + bass * 0.5);
      ctx.fillStyle = p[k];
      ctx.beginPath(); ctx.ellipse(cx, h / 2, w * (0.16 + bass * 0.1 * boost), h * (0.18 + bass * 0.22 * boost), 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.filter = 'none';
    ctx.globalAlpha = base * (0.7 + bass * 0.3);
    ctx.fillStyle = gradient(w, p);
    const lh = 1.5 + bass * 2.5 * boost;
    ctx.beginPath(); ctx.roundRect(w * 0.1, (h - lh) / 2, w * 0.8, lh, lh / 2); ctx.fill();
  }

  function frame(now){
    if(!running) return;
    requestAnimationFrame(frame);
    if(fps && now - lastFrame < 1000 / fps - 2) return;
    const dt = Math.min(0.25, (now - (lastFrame || now)) / 1000);
    lastFrame = now;
    const t = now / 1000;

    // Eases in over about a third of a second, out over half a second, whatever the frame rate.
    fade = Math.max(0, Math.min(1, fade + (opts.active ? dt / 0.35 : -dt / 0.5)));
    const raw = opts.active ? levels(t) : new Array(N).fill(0);
    lv = lv.map((s, i) => raw[i] > s ? s + (raw[i] - s) * 0.55 : s * 0.86 + raw[i] * 0.14);
    peaks = peaks.map((s, i) => Math.max(lv[i], s - 0.012));
    const loud = lv.reduce((a, b) => a + b, 0) / N;
    fast += (loud - fast) * 0.3; slow += (loud - slow) * 0.01;
    const boost = 1 + Math.min(0.6, Math.max(0, fast - slow) * 4);   // the drop: a bit bigger and brighter
    const bass = Math.min(1, (lv[0] + lv[1] + lv[2]) / 3 * boost);

    const [w, h] = size();
    ctx.clearRect(0, 0, w, h);
    const p = palette(t);
    // As the handle it's the whole thing, full strength, with a soft halo of its own colour so it stands
    // out over light and dark windows alike. At full size it stays soft enough to read the line over it.
    const open = island.classList.contains('open');   // checked every frame, so opening never catches it mid-look
    const handle = opts.handle && !open;
    ctx.globalAlpha = fade * (handle ? 1 : open ? 0.35 : opts.look === 'glow' ? 1 : opts.look === 'bars' ? 0.55 : 0.8);
    ctx.shadowColor = p[1]; ctx.shadowBlur = handle && opts.look !== 'glow' ? 4 + bass * 4 : 0;
    if(opts.look === 'wave') drawWave(w, h, p, t, boost);
    else if(opts.look === 'bars') drawBars(w, h, p, boost);
    else if(opts.look === 'glow') handle ? drawGlow(w, h, p, t, bass, boost) : drawGlowWash(w, h, p, t, bass);
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    island.style.boxShadow = glowShadow(p, t, bass, boost);

    if(fade <= 0 && !opts.active) stop();   // faded out: rest
  }

  function stop(){
    running = false;
    island.style.boxShadow = '';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.classList.remove('on');
  }

  function update(next){
    opts = { ...opts, ...next };
    if(opts.look === 'off'){ opts.active = false; }
    if(opts.active){
      canvas.classList.add('on');
      if(!running){ running = true; requestAnimationFrame(frame); }
    }
  }

  function perf(profile){ fps = profile && profile.barsFps != null ? profile.barsFps : 60; }

  return { update, cover, perf, get running(){ return running; }, get colors(){ return palette(performance.now() / 1000); } };
})();
