/* ---------- Performance ---------- */
// Settings > Performance: one choice for how smooth (and how hungry) the
// visualiser and the Desktop mode dashboard are, plus two switches. The main
// process (performance.js) adds the power state and applies it live.
//   perfMode: 'saver' | 'balanced' | 'best'
//   perfBatterySaver: use Battery saver while the laptop runs on battery
//   perfPauseGaming: stop the visualiser listening while a full-screen app is in front

const PERF_USAGE_EVERY_MS = 2000;

async function configurePerformance(){
  if(!window.pcc || !window.pcc.perfConfigure) return;
  const p = prefs();
  const profile = await window.pcc.perfConfigure({ mode: p.perfMode, batterySaver: !!p.perfBatterySaver, pauseGaming: !!p.perfPauseGaming });
  renderPerfStatus(profile);
}

// "Using Battery saver while on battery" under the mode picker, when that's what's happening.
function renderPerfStatus(profile){
  const el = document.getElementById('perf-status');
  if(!el || !profile) return;
  el.textContent = profile.savingForBattery ? 'Running on battery, so Battery saver is in use until you plug in.' : '';
  el.hidden = !profile.savingForBattery;
}

// What PCC is using, by part. Refreshed only while the Performance pane is open.
async function renderPerfUsage(){
  const pane = document.querySelector('.settings-pane[data-tab="performance"]');
  const open = document.getElementById('settings-overlay').classList.contains('open') && pane && pane.classList.contains('active');
  if(!open || !window.pcc || !window.pcc.perfUsage) return;
  const rows = await window.pcc.perfUsage();
  const order = ['PCC window', 'Island', 'Visualiser', 'Desktop mode', 'Electron (shared)', 'Other'];
  rows.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  const total = rows.reduce((t, r) => ({ cpu: t.cpu + r.cpu, memoryMB: t.memoryMB + r.memoryMB }), { cpu: 0, memoryMB: 0 });
  document.getElementById('perf-usage').innerHTML = rows.map(r => `
    <div class="perf-row"><span>${esc(r.name)}</span><span>${r.cpu.toFixed(1)}% CPU</span><span>${r.memoryMB} MB</span></div>`).join('')
    + `<div class="perf-row total"><span>All of PCC</span><span>${total.cpu.toFixed(1)}% CPU</span><span>${total.memoryMB} MB</span></div>`;
  configurePerformance();   // also picks up plugging in / unplugging for the note above
}
setInterval(renderPerfUsage, PERF_USAGE_EVERY_MS);
