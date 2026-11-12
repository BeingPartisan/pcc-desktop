/* ---------- Workspace (Tasks & Agenda) ---------- */
function addTask(){
  const input = document.getElementById('task-input');
  const text = input.value.trim();
  if(!text) return;
  state.tasks.unshift({id:uid(), text:text, done:false, priority:document.getElementById('task-priority').value});
  input.value = ''; Store.set('tasks', state.tasks); renderTasks();
}
function toggleTask(id){
  const t = state.tasks.find(x => x.id===id);
  if(t){ t.done = !t.done; Store.set('tasks', state.tasks); renderTasks(); }
}
function deleteTask(id){
  state.tasks = state.tasks.filter(x => x.id!==id);
  Store.set('tasks', state.tasks); renderTasks();
}
function cycleTaskPriority(id){
  const t = state.tasks.find(x => x.id===id);
  if(t){
    const cycle = { low: 'med', med: 'high', high: 'low' };
    t.priority = cycle[t.priority] || 'med';
    Store.set('tasks', state.tasks);
    renderTasks();
  }
}
function renderTasks(){
  const el = document.getElementById('tasks-list');
  const list = [...state.tasks].sort((a,b) => a.done - b.done);
  if(!list.length) { el.innerHTML = '<div class="empty">No tasks yet.</div>'; return; }
  
  el.innerHTML = list.map(t => `
    <div class="item-row ${t.done?'done':''}">
      <input class="chk" type="checkbox" ${t.done?'checked':''} onchange="toggleTask('${t.id}')" />
      <span class="txt">${esc(t.text)}</span>
      <span class="pill ${t.priority} interactive" onclick="cycleTaskPriority('${t.id}')" title="Click to change priority">${t.priority}</span>
      <button class="btn btn-icon btn-danger" onclick="deleteTask('${t.id}')">&times;</button>
    </div>
  `).join('');
}

function addAgenda(){
  const title = document.getElementById('agenda-title').value.trim();
  const date = document.getElementById('agenda-date').value;
  if(!title || !date) return showToast('Title and date required');
  state.agenda.push({id:uid(), title:title, date:date});
  document.getElementById('agenda-title').value=''; document.getElementById('agenda-date').value='';
  Store.set('agenda', state.agenda); renderAgenda();
}
function renderAgenda(){
  const el = document.getElementById('agenda-list');
  const items = [...state.agenda].sort((a,b) => a.date.localeCompare(b.date));
  if(!items.length) { el.innerHTML = '<div class="empty">No deadlines yet.</div>'; return; }
  el.innerHTML = items.map(a => `
    <div class="item-row">
      <span class="pill" style="background:var(--accent-soft); color:var(--accent);">${parseLocalDate(a.date).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</span>
      <span class="txt">${esc(a.title)}</span>
      <button class="btn btn-icon btn-danger" onclick="state.agenda=state.agenda.filter(x=>x.id!=='${a.id}'); Store.set('agenda', state.agenda); renderAgenda();">&times;</button>
    </div>
  `).join('');
}

/* ---------- Pomodoro ---------- */
// The timer is driven by a wall-clock end time (endsAt), not by counting
// ticks, so it stays accurate when the window is hidden in the tray and
// its timers get throttled.
const POMO_MINUTES = { focus: 25, break: 5 };
let pomo = {mode:'focus', remaining: 25*60, total: 25*60, running:false, timer:null, endsAt:0};
function pomoToggle(){
  pomo.running = !pomo.running;
  document.getElementById('pomo-toggle').textContent = pomo.running ? 'Pause' : 'Start';
  clearInterval(pomo.timer);
  if(pomo.running){
    pomo.endsAt = Date.now() + pomo.remaining * 1000;
    pomo.timer = setInterval(pomoTick, 1000);
  } else {
    pomo.remaining = Math.max(1, Math.ceil((pomo.endsAt - Date.now()) / 1000));
  }
  renderPomo();
}
function pomoReset(){
  pomo.running = false; clearInterval(pomo.timer);
  pomo.mode = 'focus'; pomo.total = POMO_MINUTES.focus*60; pomo.remaining = pomo.total;
  document.getElementById('pomo-toggle').textContent = 'Start';
  renderPomo();
}
function pomoTick(){
  let switched = false;
  // Loop in case more than one phase elapsed while timers were throttled.
  while(Date.now() >= pomo.endsAt){
    pomo.mode = pomo.mode==='focus' ? 'break' : 'focus';
    pomo.total = POMO_MINUTES[pomo.mode] * 60;
    pomo.endsAt += pomo.total * 1000;
    switched = true;
  }
  pomo.remaining = Math.ceil((pomo.endsAt - Date.now()) / 1000);
  if(switched){
    const msg = pomo.mode === 'break'
      ? `Focus session done. Take a ${POMO_MINUTES.break}-minute break.`
      : `Break over. Back to a ${POMO_MINUTES.focus}-minute focus session.`;
    showToast(`Timer switched to ${pomo.mode}`);
    // Native notification so it's noticed even when PCC is in the tray.
    if(window.pcc && window.pcc.showNotification) window.pcc.showNotification('Deep Work Timer', msg);
  }
  renderPomo();
}
function renderPomo(){
  const m = Math.floor(pomo.remaining/60), s = pomo.remaining%60;
  document.getElementById('pomo-display').textContent = `${m<10?'0':''}${m}:${s<10?'0':''}${s}`;
  document.getElementById('pomo-mode').textContent = pomo.mode;
  document.getElementById('pomo-bar').style.width = Math.round(((pomo.total-pomo.remaining)/pomo.total)*100)+'%';
}
