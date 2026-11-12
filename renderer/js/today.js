/* ---------- Today page ---------- */
// Today shows compact, live views of data that belongs to other pages
// (tasks, agenda, timetable, timer, budget, habits). Nothing is stored
// here: every view reads the shared `state`, and is re-rendered whenever
// the owning page re-renders (see the hooks at the bottom of this file).

const TODAY_TASK_LIMIT = 7;
const TODAY_DEADLINE_LIMIT = 5;

// "9:00-10:50 AM" / "11:30 AM-1:20 PM" -> {start, end} in minutes since
// midnight. A start time with no AM/PM takes the end time's, unless that
// would put it after the end.
function parseSlotTimes(label){
  const m = String(label).match(/(\d{1,2}):(\d{2})\s*(AM|PM)?\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if(!m) return null;
  const toMin = (h, min, mer) => (Number(h) % 12 + (mer.toUpperCase() === 'PM' ? 12 : 0)) * 60 + Number(min);
  const end = toMin(m[4], m[5], m[6]);
  let start = toMin(m[1], m[2], m[3] || m[6]);
  if(!m[3] && start > end) start -= 12 * 60;
  return { start, end };
}

function renderTodayClasses(){
  const el = document.getElementById('today-classes');
  const day = todayDayName();
  document.getElementById('today-day-label').textContent = day;

  // Real dated sessions from Digiicampus replace the weekly grid when synced.
  if(campusActive()) return renderTodayCampus(el);

  const slots = (state.timetable.days || {})[day];
  const overrides = state.timetableOverrides.filter(o => o.day === day);
  const overrideHtml = overrides.map(o => `
    <div class="tt-override-chip">
      <span class="txt">${esc(o.text)}</span>
      <button class="btn btn-icon" style="padding:2px 6px;" onclick="clearOverride('${o.id}')">&times;</button>
    </div>`).join('');

  const classes = (slots || [])
    .map((slot, i) => slot ? { slot, label: state.timetable.slots[i], times: parseSlotTimes(state.timetable.slots[i]) } : null)
    .filter(Boolean);

  if(!classes.length){
    el.innerHTML = overrideHtml + '<div class="empty">No classes today.</div>';
    return;
  }

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  let nextMarked = false;

  el.innerHTML = overrideHtml + classes.map(c => {
    let status = '';
    let badge = '';
    if(c.times){
      if(nowMin >= c.times.end) status = 'past';
      else if(nowMin >= c.times.start){ status = 'now'; badge = '<span class="pill class-badge now">Now</span>'; }
      else if(!nextMarked){
        status = 'next'; nextMarked = true;
        const mins = c.times.start - nowMin;
        const inText = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
        badge = `<span class="pill class-badge next">In ${inText}</span>`;
      }
    }
    const meta = [c.slot.prof, c.slot.room].filter(Boolean).join(' · ');
    return `
      <div class="class-row ${status}" style="border-left-color:${colorForSubject(c.slot.subject)}">
        <span class="class-time">${esc(c.label)}</span>
        <div class="class-body">
          <div class="class-subject">${esc(c.slot.subject)}</div>
          ${meta ? `<div class="class-meta">${esc(meta)}</div>` : ''}
        </div>
        ${badge}
      </div>`;
  }).join('');
}

function addTodayTask(){
  const input = document.getElementById('today-task-input');
  const text = input.value.trim();
  if(!text) return;
  state.tasks.unshift({ id: uid(), text, done: false, priority: 'med' });
  input.value = '';
  Store.set('tasks', state.tasks);
  renderTasks();
}

function renderTodayTasks(){
  const el = document.getElementById('today-tasks');
  const rank = { high: 0, med: 1, low: 2 };
  const open = state.tasks.filter(t => !t.done).sort((a, b) => (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1));
  document.getElementById('today-task-count').textContent = open.length;

  if(!open.length){
    el.innerHTML = '<div class="empty">All clear. Nothing open.</div>';
    return;
  }
  const more = open.length - TODAY_TASK_LIMIT;
  el.innerHTML = open.slice(0, TODAY_TASK_LIMIT).map(t => `
    <div class="item-row">
      <input class="chk" type="checkbox" onchange="toggleTask('${t.id}')" />
      <span class="txt">${esc(t.text)}</span>
      <span class="pill ${t.priority} interactive" onclick="cycleTaskPriority('${t.id}')" title="Click to change priority">${t.priority}</span>
    </div>`).join('')
    + (more > 0 ? `<a href="#" class="more-link" onclick="navigate('focus'); return false;">+ ${more} more on the Focus page</a>` : '');
}

function describeDaysAway(dateStr){
  const days = Math.round((parseLocalDate(dateStr) - parseLocalDate(todayStr())) / 86400000);
  if(days < 0) return { text: days === -1 ? 'Yesterday' : `${-days} days ago`, cls: 'high' };
  if(days === 0) return { text: 'Today', cls: 'high' };
  if(days === 1) return { text: 'Tomorrow', cls: 'med' };
  return { text: `In ${days} days`, cls: days <= 7 ? 'med' : 'low' };
}

function renderTodayDeadlines(){
  const el = document.getElementById('today-deadlines');
  const items = [...state.agenda].sort((a, b) => a.date.localeCompare(b.date));
  if(!items.length){
    el.innerHTML = '<div class="empty">No deadlines yet.</div>';
    return;
  }
  const more = items.length - TODAY_DEADLINE_LIMIT;
  el.innerHTML = items.slice(0, TODAY_DEADLINE_LIMIT).map(a => {
    const when = describeDaysAway(a.date);
    return `
      <div class="item-row">
        <span class="txt">${esc(a.title)}</span>
        <span class="pill ${when.cls}" title="${esc(a.date)}">${when.text}</span>
      </div>`;
  }).join('')
    + (more > 0 ? `<a href="#" class="more-link" onclick="navigate('focus'); return false;">+ ${more} more</a>` : '');
}

function renderTodayPomo(){
  const m = Math.floor(pomo.remaining / 60), s = pomo.remaining % 60;
  document.getElementById('today-pomo-display').textContent = `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  document.getElementById('today-pomo-mode').textContent = pomo.mode;
  document.getElementById('today-pomo-bar').style.width = Math.round(((pomo.total - pomo.remaining) / pomo.total) * 100) + '%';
  document.getElementById('today-pomo-toggle').textContent = pomo.running ? 'Pause' : 'Start';
}

// Read-only chips for the areas that don't need action right now.
function renderTodayStatus(){
  const spent = state.finances.reduce((sum, f) => sum + f.amount, 0);
  const budget = state.settings.budget || 1;
  const pct = Math.round(spent / budget * 100);
  const budgetCls = pct > 100 ? 'bad' : pct > 85 ? 'warn' : '';

  const habits = state.habits.list;
  const log = state.habits.log[todayStr()] || {};
  const habitsDone = habits.filter(h => log[h.id]).length;

  const chips = [
    { page: 'money', label: 'Budget', value: `${pct}% used`, cls: budgetCls },
    { page: 'life',  label: 'Habits', value: habits.length ? `${habitsDone} / ${habits.length} today` : 'none tracked', cls: '' },
    { page: 'study', label: 'Flashcards', value: `${state.flashcards.length} cards`, cls: '' },
  ];
  document.getElementById('today-status').innerHTML = chips.map(c => `
    <button class="status-chip ${c.cls}" onclick="navigate('${c.page}')">
      <span>${c.label}</span><b>${esc(c.value)}</b>
    </button>`).join('');
}

function renderTodayAll(){
  renderTodayClasses(); renderTodayTasks(); renderTodayDeadlines(); renderTodayPomo(); renderTodayStatus();
}

// Keep Today in step with the pages that own the data: whenever one of
// their render functions runs, the matching Today view runs right after.
function hookRender(name, todayView){
  const original = window[name];
  window[name] = function(...args){
    const result = original.apply(this, args);
    try { todayView(); } catch(e){ console.error(`Today view failed after ${name}`, e); }
    return result;
  };
}
hookRender('renderTasks', renderTodayTasks);
hookRender('renderAgenda', renderTodayDeadlines);
hookRender('renderTimetable', renderTodayClasses);
hookRender('renderPomo', renderTodayPomo);
hookRender('renderFinances', renderTodayStatus);
hookRender('renderHabits', renderTodayStatus);
hookRender('renderFlashcards', renderTodayStatus);

// "Now" / "In 25m" badges on the class list go stale; refresh each minute.
setInterval(renderTodayClasses, 60 * 1000);
