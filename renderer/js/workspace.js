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
// Every deadline still to do: your own, and dated evaluation components without marks.
// Ones marked done (the tick button) drop out everywhere: here, Today, the island and Desktop mode.
function openDeadlines(){
  return [...state.agenda.filter(a => !a.done).map(a => ({ ...a, key: 'a:' + a.id })), ...evaluationDeadlines()]
    .sort((a, b) => a.date.localeCompare(b.date));
}

// key: 'a:<agenda id>' or 'e:<course>:<component id>'
function completeDeadline(key){
  const [kind, ...rest] = String(key).split(':');
  if(kind === 'a'){
    const item = state.agenda.find(a => a.id === rest[0]);
    if(!item) return;
    item.done = true; item.doneAt = Date.now();
    Store.set('agenda', state.agenda);
    showToast(`Done: ${item.title}`);
  } else if(kind === 'e'){
    const course = decodeURIComponent(rest[0]);
    const comp = ((evaluations[course] || {}).components || []).find(c => c.id === rest[1]);
    if(!comp) return;
    comp.done = true;
    saveEvaluations();
    showToast(`Done: ${comp.name}. Add the marks on the Academics page when they're out.`);
  }
  renderAgenda();
}

function deadlineDoneButton(a){
  return `<button class="btn btn-icon deadline-done" title="Mark as done" aria-label="Mark as done" data-key="${esc(a.key)}" onclick="completeDeadline(this.dataset.key)"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>`;
}

function renderAgenda(){
  const el = document.getElementById('agenda-list');
  const items = openDeadlines();
  if(!items.length) { el.innerHTML = '<div class="empty">No deadlines yet.</div>'; return; }
  el.innerHTML = items.map(a => `
    <div class="item-row">
      <span class="pill" style="background:var(--accent-soft); color:var(--accent-text);">${parseLocalDate(a.date).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</span>
      <span class="txt">${esc(a.title)}</span>
      ${deadlineDoneButton(a)}
      ${a.fromEvaluation
        ? `<button class="btn" style="padding:4px 10px; font-size:12px;" onclick="navigate('academics')" title="Set on the Academics page">Evaluation</button>`
        : `<button class="btn btn-icon btn-danger" onclick="state.agenda=state.agenda.filter(x=>x.id!=='${a.id}'); Store.set('agenda', state.agenda); renderAgenda();">&times;</button>`}
    </div>
  `).join('');
}

/* ---------- Pomodoro ---------- */
// The timer is driven by a wall-clock end time (endsAt), not by counting
// ticks, so it stays accurate when the window is hidden in the tray and
// its timers get throttled.
// Lengths come from Settings > General (applied by appearance.js).
const POMO_MINUTES = { focus: 25, break: 5 };
function setPomoMinutes(focus, brk){
  POMO_MINUTES.focus = focus; POMO_MINUTES.break = brk;
  if(!pomo.running) pomoReset(); // a running session keeps its current length
}
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
    if(pomo.mode === 'break') showNextQuote(); // a fresh quote to mark the finished session
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
