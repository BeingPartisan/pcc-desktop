// --- System Console ---

let consoleLogs = [];
let consoleFilter = 'all';
let consoleAutoScroll = true;
let consoleHistoryLoaded = false;

function openConsole(){
  document.getElementById('console-overlay').classList.add('open');
  loadConsoleHistory();
}
function closeConsole(){
  document.getElementById('console-overlay').classList.remove('open');
}

async function loadConsoleHistory(){
  if(!consoleHistoryLoaded && window.pcc && window.pcc.getLogHistory){
    consoleLogs = await window.pcc.getLogHistory();
    consoleHistoryLoaded = true;
  }
  renderConsole();
}

function setConsoleFilter(level){
  consoleFilter = level;
  document.querySelectorAll('.console-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.level === level));
  renderConsole();
}

function clearConsole(){
  consoleLogs = [];
  renderConsole();
}

function formatLogTime(ts){
  const d = new Date(ts);
  return d.toLocaleTimeString('en-GB', { hour12:false });
}

function renderConsole(){
  const body = document.getElementById('console-body');
  if(!body) return;
  const filtered = consoleFilter === 'all' ? consoleLogs : consoleLogs.filter(l => l.level === consoleFilter);
  if(!filtered.length){
    body.innerHTML = '<div class="console-empty">No log entries yet.</div>';
    return;
  }
  body.innerHTML = filtered.map(l => {
    const metaStr = l.meta ? (typeof l.meta === 'string' ? l.meta : JSON.stringify(l.meta)) : '';
    return `
    <div class="console-line level-${esc(l.level)}">
      <span class="ctime">${formatLogTime(l.timestamp)}</span>
      <span class="cmsg">${esc(l.message)}${metaStr ? `<span class="cmeta">${esc(metaStr)}</span>` : ''}</span>
    </div>
  `;
  }).join('');
  if(consoleAutoScroll){
    body.scrollTop = body.scrollHeight;
  }
}

const consoleBodyEl = document.getElementById('console-body');
if(consoleBodyEl){
  consoleBodyEl.addEventListener('scroll', function(){
    consoleAutoScroll = (this.scrollHeight - this.scrollTop - this.clientHeight) < 40;
  });
}

if(window.pcc && window.pcc.onLogEntry){
  window.pcc.onLogEntry((entry) => {
    consoleLogs.push(entry);
    if(consoleLogs.length > 500) consoleLogs.shift();
    if(document.getElementById('console-overlay').classList.contains('open')){
      renderConsole();
    }
  });
}
