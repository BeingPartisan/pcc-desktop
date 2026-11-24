/* ---------- Confetti ---------- */
// A burst of confetti over the whole window, on a canvas that takes no clicks
// and removes itself when the last piece has fallen. Used by Sounds and actions
// and a few surprises, in the main window and on the island.
//   PCCConfetti.burst({ x, y, colors, count, spread })   x, y: 0..1 of the window (default: top middle)

const PCCConfetti = (() => {
  let canvas = null, ctx = null, pieces = [], running = false, last = 0;
  const DEFAULT_COLORS = ['#FF8FC7', '#C9F26C', '#86C6FF', '#F4B860', '#B9A5FF', '#7FE0C4'];

  function ensureCanvas(){
    if(canvas) return;
    canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed; inset:0; width:100vw; height:100vh; pointer-events:none; z-index:99999;';
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
  }

  function burst({ x = 0.5, y = 0, colors = DEFAULT_COLORS, count = 140, spread = 1 } = {}){
    ensureCanvas();
    const d = window.devicePixelRatio || 1;
    canvas.width = innerWidth * d; canvas.height = innerHeight * d;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    for(let i = 0; i < count; i++){
      const angle = Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9 * spread;   // mostly downwards and outwards
      const speed = 3 + Math.random() * 7;
      pieces.push({
        x: x * innerWidth, y: y * innerHeight,
        vx: Math.cos(angle) * speed * (Math.random() < 0.5 ? -1 : 1), vy: Math.sin(angle) * speed - 4 * Math.random(),
        w: 5 + Math.random() * 6, h: 8 + Math.random() * 8,
        r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
        color: colors[i % colors.length], life: 0,
      });
    }
    if(!running){ running = true; last = performance.now(); requestAnimationFrame(frame); }
  }

  function frame(now){
    const dt = Math.min(2, (now - last) / 16.7); last = now;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for(const p of pieces){
      p.vy += 0.18 * dt; p.vx *= Math.pow(0.99, dt);
      p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt; p.life += dt;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.globalAlpha = Math.max(0, Math.min(1, (400 - p.life) / 60));
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2 * Math.abs(Math.cos(p.r * 1.7)), p.w, p.h * Math.abs(Math.cos(p.r * 1.7)) + 1);
      ctx.restore();
    }
    pieces = pieces.filter(p => p.y < innerHeight + 40 && p.life < 400);
    if(pieces.length) requestAnimationFrame(frame);
    else { running = false; canvas.remove(); canvas = null; }
  }

  return { burst };
})();
