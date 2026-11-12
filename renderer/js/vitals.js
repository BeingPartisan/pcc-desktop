// --- System Vitals ---

const VITALS_HISTORY_MAX = 60; // 5 min at 5s interval
let cpuHistory = [];
let ramHistory = [];

function buildSparklinePoints(history){
  const w = 300, h = 50;
  if(history.length < 2) return '';
  const step = w / (VITALS_HISTORY_MAX - 1);
  const offset = VITALS_HISTORY_MAX - history.length;
  return history.map((v, i) => {
    const x = (offset + i) * step;
    const y = h - Math.max(0, Math.min(100, v)) / 100 * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function renderSparkline(svgId, history, colorVar){
  const svgEl = document.getElementById(svgId);
  if(!svgEl) return;
  const points = buildSparklinePoints(history);
  svgEl.innerHTML = points
    ? `<polyline points="${points}" fill="none" stroke="${colorVar}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round" />`
    : '';
}

async function loadSystemVitals(){
  if(!window.pcc || !window.pcc.getSystemInfo) return;
  if(document.hidden) return; // don't poll while PCC is hidden in the tray
  if(currentPage !== 'system') return; // ...or while the System page isn't showing
  try{
    const info = await window.pcc.getSystemInfo();
    const cpuPct = parseFloat(info.load.currentLoadPercent) || 0;
    const ramTotal = parseFloat(info.memory.totalGB) || 0;
    const ramUsed = parseFloat(info.memory.usedGB) || 0;
    const ramPct = ramTotal ? (ramUsed / ramTotal * 100) : 0;

    cpuHistory.push(cpuPct); if(cpuHistory.length > VITALS_HISTORY_MAX) cpuHistory.shift();
    ramHistory.push(ramPct); if(ramHistory.length > VITALS_HISTORY_MAX) ramHistory.shift();

    const cpuLabel = document.getElementById('vitals-cpu-pct');
    const ramLabel = document.getElementById('vitals-ram-pct');
    if(cpuLabel) cpuLabel.textContent = cpuPct.toFixed(0) + '%';
    if(ramLabel) ramLabel.textContent = ramPct.toFixed(0) + '%';

    renderSparkline('vitals-cpu-spark', cpuHistory, 'var(--accent)');
    renderSparkline('vitals-ram-spark', ramHistory, 'var(--cyan)');

    const disksBody = document.getElementById('vitals-disks');
    if(disksBody && info.disks){
      disksBody.innerHTML = info.disks.map(d => `
        <div class="vitals-disk-row">
          <span class="vdname">${esc(d.mount)}</span>
          <div class="budget-bar-bg"><div class="budget-bar-fill" style="width:${d.usePercent}%; background:${d.usePercent > 85 ? 'var(--red)' : 'var(--accent)'};"></div></div>
          <span class="vdpct">${d.usedGB} / ${d.sizeGB} GB</span>
        </div>
      `).join('');
    }
  } catch(e){
    console.error('Failed to load system vitals', e);
  }
}

loadSystemVitals();
setInterval(loadSystemVitals, 5000);
// Refresh straight away when the window comes back from the tray.
document.addEventListener('visibilitychange', () => { if(!document.hidden) loadSystemVitals(); });
