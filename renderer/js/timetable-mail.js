/* ---------- Timetable (manual weekly grid) ---------- */
function todayDayName(){
  return new Date().toLocaleDateString(undefined, {weekday:'long'});
}

function renderTimetable(){
  // A timetable synced from Digiicampus (campus.js) takes over from the
  // manual weekly grid; the grid and its Edit button come back when
  // Digiicampus is disconnected.
  const synced = campusActive();
  const show = (id, on) => { document.getElementById(id).style.display = on ? '' : 'none'; };
  show('campus-week', synced);
  show('campus-week-nav', synced);
  show('campus-sync-btn', synced);
  show('tt-grid-wrap', !synced);
  show('tt-connect-btn', !synced);
  show('tt-edit-btn', !synced);
  if(synced){ renderCampusWeek(); return; }
  document.getElementById('tt-source').textContent = '';

  const tt = state.timetable;
  const today = todayDayName();
  const dayNames = Object.keys(tt.days);

  // In edit mode the period times become text fields and every cell is clickable.
  let head = '<tr><th>Day</th>' + tt.slots.map((s, i) => ttEditing
    ? `<th><input class="tt-time-input" value="${esc(s)}" aria-label="Time of period ${i + 1}" onchange="updateSlotLabel(${i}, this.value)" /></th>`
    : `<th>${esc(s)}</th>`).join('') + '</tr>';

  let rows = dayNames.map(day => {
    const slots = tt.slots.map((_, i) => tt.days[day][i] || null);
    const cells = slots.map((slot, i) => {
      const edit = ttEditing ? ` onclick="editSlot('${day}', ${i})" role="button" tabindex="0" onkeydown="if(event.key==='Enter')editSlot('${day}', ${i})"` : '';
      if(!slot) return ttEditing
        ? `<td><div class="tt-add"${edit}>+ Add</div></td>`
        : '<td><span class="tt-empty">&mdash;</span></td>';
      return `<td>
        <div class="tt-slot" style="border-left-color:${colorForSubject(slot.subject)}"${edit}>
          <div class="tt-subject">${esc(slot.subject)}</div>
          ${slot.prof ? `<div class="tt-meta">${esc(slot.prof)}</div>` : ''}
          ${slot.room ? `<div class="tt-meta">${esc(slot.room)}</div>` : ''}
        </div>
      </td>`;
    }).join('');
    const rowOverrides = state.timetableOverrides.filter(o => o.day === day);
    const overrideRow = rowOverrides.length ? `<tr class="${day===today?'tt-today':''}"><td></td><td colspan="${tt.slots.length}">
      <div class="tt-overrides">${rowOverrides.map(o => `
        <div class="tt-override-chip">
          <span class="txt">${esc(o.text)}</span>
          <button class="btn btn-icon" style="padding:2px 6px;" onclick="clearOverride('${o.id}')">&times;</button>
        </div>`).join('')}
      </div>
    </td></tr>` : '';
    return `<tr class="${day===today?'tt-today':''}"><td class="tt-day-cell">${esc(day)}</td>${cells}</tr>${overrideRow}`;
  }).join('');

  document.getElementById('tt-table').innerHTML = head + rows;
}

// --- Editing the timetable ---
// "Edit" on the Timetable card switches to edit mode: click a class to
// change it, click "+ Add" to fill an empty period, or retype a period's
// time. Every change is saved straight away.

let ttEditing = false;
let slotEditTarget = null; // {day, index} of the cell open in the editor

function toggleTimetableEdit(){
  ttEditing = !ttEditing;
  document.getElementById('tt-edit-btn').textContent = ttEditing ? 'Done' : 'Edit';
  document.getElementById('card-timetable').classList.toggle('editing', ttEditing);
  renderTimetable();
}

function saveTimetable(){
  Store.set('timetable', state.timetable);
  renderTimetable();
}

function updateSlotLabel(index, value){
  const label = value.trim();
  if(label){
    state.timetable.slots[index] = label;
    // The Today page reads these times to show "Now" / "In 25m".
    if(!parseSlotTimes(label)) showToast('Saved. Write times like "9:00-10:50 AM" so Today can track them.');
  }
  saveTimetable();
}

function editSlot(day, index){
  slotEditTarget = { day, index };
  const slot = state.timetable.days[day][index] || {};
  document.getElementById('slot-editor-title').textContent = `${day}, ${state.timetable.slots[index]}`;
  document.getElementById('slot-subject').value = slot.subject || '';
  document.getElementById('slot-prof').value = slot.prof || '';
  document.getElementById('slot-room').value = slot.room || '';
  document.getElementById('slot-clear-btn').style.display = slot.subject ? '' : 'none';
  document.getElementById('slot-overlay').classList.add('open');
  document.getElementById('slot-subject').focus();
}

function closeSlotEditor(){
  slotEditTarget = null;
  document.getElementById('slot-overlay').classList.remove('open');
}

function saveSlot(){
  if(!slotEditTarget) return;
  const subject = document.getElementById('slot-subject').value.trim();
  if(!subject) return showToast('Enter a subject, or use Clear to empty this period');
  state.timetable.days[slotEditTarget.day][slotEditTarget.index] = {
    subject,
    prof: document.getElementById('slot-prof').value.trim(),
    room: document.getElementById('slot-room').value.trim(),
  };
  closeSlotEditor();
  saveTimetable();
}

function clearSlot(){
  if(!slotEditTarget) return;
  state.timetable.days[slotEditTarget.day][slotEditTarget.index] = null;
  closeSlotEditor();
  saveTimetable();
}

document.addEventListener('keydown', e => {
  if(e.key === 'Escape' && slotEditTarget) closeSlotEditor();
});

function clearOverride(id){
  state.timetableOverrides = state.timetableOverrides.filter(o => o.id !== id);
  Store.set('timetableOverrides', state.timetableOverrides);
  renderTimetable();
}

