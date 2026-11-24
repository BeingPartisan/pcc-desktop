/* ---------- Colour themes ---------- */
// A theme sets the whole look, in a dark and a light version: the page, cards
// and text, a main colour (the accent) and a second one that goes with it, and
// its own red / amber / blue for urgent, soon and info. Those three are picked
// per theme so a warning never looks like the theme's own colour (in Sakura the
// pink is the theme, so "overdue" is an orange-red; in Sunset the peach is the
// theme, so "soon" is a clear yellow).
//
// prefs().palette: a theme id below, 'wallpaper' (colours taken from your
// wallpaper) or 'custom' (today's single accent colour, from the dots).
//   each mode: [page, card surface, text, dim text, accent, second colour, red, amber, blue]

const THEMES = {
  partisan: { name: 'Partisan', desc: 'Red and gold',
    dark:  ['#140D0E', '#1F1415', '#F4E9E9', '#A69293', '#E5484D', '#E9B949', '#FF7A85', '#F4B860', '#86C6FF'],
    light: ['#FBF3F2', '#FFFFFF', '#2A1516', '#7C6263', '#C62F35', '#B7871C', '#CF3A49', '#A9650A', '#1F6FCC'] },
  midnight: { name: 'Midnight', desc: 'Indigo and violet',
    dark:  ['#0F1020', '#171932', '#E8E8F5', '#9796B0', '#8B8CF6', '#C4A7FF', '#FF6B7A', '#F5B95F', '#5FD0E8'],
    light: ['#F3F3FB', '#FFFFFF', '#1B1B33', '#6B6A85', '#5B5BD6', '#8E6BE0', '#CF3A49', '#A9650A', '#0E7C99'] },
  sakura: { name: 'Sakura', desc: 'Soft pink and plum',
    dark:  ['#17111A', '#22182A', '#F3E8F0', '#A897A6', '#F4A6C6', '#B98BD9', '#FF6A3D', '#F2C14E', '#7CC4F5'],
    light: ['#FCF4F7', '#FFFFFF', '#2B1A26', '#7D6676', '#D9578E', '#9A62C2', '#D9480F', '#A16207', '#1F6FCC'] },
  ocean: { name: 'Ocean', desc: 'Teal and blue',
    dark:  ['#0B1418', '#122128', '#E3F1F3', '#8CA3A8', '#5CC8C2', '#6FA8FF', '#FF6B6B', '#FFB547', '#B49CFF'],
    light: ['#F1F8F8', '#FFFFFF', '#132227', '#5E7479', '#1F8F8A', '#3F7BE0', '#D23B3B', '#A9650A', '#7048D8'] },
  forest: { name: 'Forest', desc: 'Sage and birch',
    dark:  ['#0F1511', '#18211A', '#E7EFE4', '#94A390', '#9CCB8A', '#C9B79C', '#FF7A70', '#FF9F43', '#7FB7E8'],
    light: ['#F4F7F1', '#FFFFFF', '#1A2418', '#68745F', '#4F8A3E', '#8C7558', '#CF3A3A', '#C2570C', '#1F6FCC'] },
  sunset: { name: 'Sunset', desc: 'Peach and dusk lavender',
    dark:  ['#18110F', '#241915', '#F6EBE6', '#A9958D', '#FFAE87', '#B7A3F5', '#FF4D5E', '#F5D04C', '#7CC4F5'],
    light: ['#FDF5F0', '#FFFFFF', '#2B1B15', '#80695F', '#D9663A', '#7E5BD6', '#C81E3A', '#8A6D00', '#1F6FCC'] },
  classic: { name: 'Classic', desc: 'The original lime, softened',
    dark:  ['#101112', '#18191B', '#EDEEEA', '#8F9199', '#B9E36A', '#86C6FF', '#FF7A85', '#F4B860', '#86C6FF'],
    light: ['#F6F7F2', '#FFFFFF', '#1A1C14', '#6C6F63', '#5E8A12', '#2F7FD1', '#CF3A49', '#A9650A', '#1F6FCC'] },
};
const THEME_ORDER = ['partisan', 'midnight', 'sakura', 'ocean', 'forest', 'sunset', 'classic', 'wallpaper', 'custom'];

/* ----- Colour helpers ----- */

function hexToHsl(hex){
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if(!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslToHex(h, s, l){
  const a = s * Math.min(l, 1 - l), f = (n) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return '#' + [f(0), f(8), f(4)].map(x => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('');
}
const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };

// Red / amber / blue that stay clear of a given accent: if the accent is close to
// red, "urgent" moves to orange-red; close to amber, "soon" moves to yellow.
function warningColoursFor(accent, dark){
  const [h, s] = hexToHsl(accent);
  const vivid = s > 0.25;
  let red = dark ? '#FF7A85' : '#CF3A49', amber = dark ? '#F4B860' : '#A9650A', blue = dark ? '#86C6FF' : '#1F6FCC';
  if(vivid && hueGap(h, 355) < 30) red = dark ? '#FF6A3D' : '#D9480F';
  if(vivid && hueGap(h, 35) < 25) amber = dark ? '#F5D04C' : '#8A6D00';
  if(vivid && hueGap(h, 210) < 25) blue = dark ? '#B49CFF' : '#7048D8';
  return [red, amber, blue];
}

/* ----- Match my wallpaper ----- */

let wallpaperTheme = null;    // { dark: [...], light: [...] } once worked out
async function loadWallpaperTheme(){
  let url = customImages.wallpaper;
  if(!url && window.pcc && window.pcc.getWindowsWallpaper) url = await window.pcc.getWindowsWallpaper();
  if(!url){ wallpaperTheme = null; return; }
  await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try { wallpaperTheme = themeFromImage(img); } catch(e){ wallpaperTheme = null; }
      resolve();
    };
    img.onerror = () => { wallpaperTheme = null; resolve(); };
    img.src = url;
  });
}

// The picture's two strongest colours that differ from each other, made gentle,
// with a page tinted by the first.
function themeFromImage(img){
  const c = document.createElement('canvas'); c.width = c.height = 48;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0, 48, 48);
  const px = x.getImageData(0, 0, 48, 48).data;
  const buckets = Array.from({ length: 12 }, () => ({ w: 0, h: 0, s: 0 }));
  for(let i = 0; i < px.length; i += 4){
    const hex = '#' + [px[i], px[i + 1], px[i + 2]].map(v => v.toString(16).padStart(2, '0')).join('');
    const [h, s, l] = hexToHsl(hex);
    if(s < 0.18 || l < 0.1 || l > 0.92) continue;
    const b = buckets[Math.floor(h / 30) % 12], w = s * (1 - Math.abs(l - 0.5));
    b.w += w; b.h += h * w; b.s += s * w;
  }
  const picks = [];
  for(const b of buckets.filter(b => b.w > 2).sort((a, b) => b.w - a.w)){
    const h = b.h / b.w;
    if(picks.every(p => hueGap(p, h) >= 45)) picks.push(h);
    if(picks.length === 2) break;
  }
  if(!picks.length) return null;
  if(picks.length < 2) picks.push((picks[0] + 150) % 360);
  const [h1, h2] = picks;
  const mode = (dark) => {
    const accent = hslToHex(h1, 0.62, dark ? 0.72 : 0.42), second = hslToHex(h2, 0.55, dark ? 0.72 : 0.45);
    return [
      hslToHex(h1, 0.22, dark ? 0.07 : 0.965), dark ? hslToHex(h1, 0.2, 0.11) : '#FFFFFF',
      hslToHex(h1, 0.15, dark ? 0.93 : 0.12), hslToHex(h1, 0.08, dark ? 0.62 : 0.42),
      accent, second, ...warningColoursFor(accent, dark),
    ];
  };
  return { dark: mode(true), light: mode(false) };
}

/* ----- Which colours are in use ----- */

function themeColours(dark){
  const id = prefs().palette || 'partisan';
  if(id === 'custom') return null;
  if(id === 'wallpaper') return wallpaperTheme ? wallpaperTheme[dark ? 'dark' : 'light'] : THEMES.partisan[dark ? 'dark' : 'light'];
  return (THEMES[id] || THEMES.partisan)[dark ? 'dark' : 'light'];
}

// Sets (or, for a single custom accent, clears) the theme's colours on the page.
function applyThemeColours(root, dark, accent){
  const c = themeColours(dark);
  const keys = ['--bg', '--panel', '--ink', '--ink-dim', '--accent2', '--red', '--amber', '--cyan'];
  if(!c){
    // A colour of your own: the standard look, with warnings kept clear of your colour.
    keys.slice(0, 5).forEach(k => root.style.removeProperty(k));
    root.style.removeProperty('--body-bg');
    const [red, amber, blue] = warningColoursFor(accent, dark);
    root.style.setProperty('--red', red); root.style.setProperty('--amber', amber); root.style.setProperty('--cyan', blue);
    return;
  }
  const [bg, panel, ink, dim, , second, red, amber, blue] = c;
  root.style.setProperty('--bg', bg);
  root.style.setProperty('--panel', panel);
  root.style.setProperty('--ink', ink);
  root.style.setProperty('--ink-dim', dim);
  root.style.setProperty('--accent2', second);
  root.style.setProperty('--red', red); root.style.setProperty('--amber', amber); root.style.setProperty('--cyan', blue);
  // The see-through window background (for the Windows blur) in the theme's page colour.
  const n = parseInt(bg.slice(1), 16);
  root.style.setProperty('--body-bg', `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${dark ? 0.82 : 0.9})`);
}

function setPalette(id){
  if(id === 'wallpaper') loadWallpaperTheme().then(() => { setPref('palette', id); if(!wallpaperTheme) showToast('Couldn\'t read colours from your wallpaper, so Partisan it is for now'); });
  else setPref('palette', id);
}

function renderThemePicker(){
  const el = document.getElementById('theme-picker');
  if(!el) return;
  const p = prefs();
  const dark = document.documentElement.dataset.theme !== 'light';
  const current = p.palette || 'partisan';
  el.innerHTML = THEME_ORDER.map(id => {
    let sw, name, desc;
    if(id === 'custom'){ name = 'Custom'; desc = 'One colour of your own'; const a = p.accentFromWindows && systemAccent ? systemAccent : p.accent; sw = [dark ? '#101112' : '#F5F4F0', dark ? '#18191B' : '#FFFFFF', a, a]; }
    else if(id === 'wallpaper'){ name = 'Match my wallpaper'; desc = 'Colours from your wallpaper'; const c = wallpaperTheme ? wallpaperTheme[dark ? 'dark' : 'light'] : null; sw = c ? [c[0], c[1], c[4], c[5]] : null; }
    else { const t = THEMES[id]; name = t.name; desc = t.desc; const c = t[dark ? 'dark' : 'light']; sw = [c[0], c[1], c[4], c[5]]; }
    const swatch = sw ? sw.map(col => `<i style="background:${col}"></i>`).join('') : '<i class="theme-rainbow"></i>';
    return `<button class="theme-card ${current === id ? 'active' : ''}" onclick="setPalette('${id}')"><span class="theme-swatch">${swatch}</span><b>${name}</b><small>${desc}</small></button>`;
  }).join('');
  // The colour dots belong to Custom.
  const dots = document.getElementById('accent-swatches');
  const row = dots && dots.closest('.setting-row');
  if(row) row.hidden = current !== 'custom';
}
