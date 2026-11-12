/* ---------- Today: Timetable & Mail Sync ---------- */
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
  show('tt-mail-btn', !synced);
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

async function scanMail(manual){
  try{
    const data = await window.pcc.scanEmail();

    if(data.error){
      if(manual) showToast('Mail scan: ' + data.error);
      renderPending(data.error);
      return;
    }

    const existingIds = new Set(state.pendingUpdates.map(p => p.id));
    const dismissed = new Set(state.dismissedUpdateIds);
    let added = 0;

    (data.results || []).forEach(item => {
      if(existingIds.has(item.id) || dismissed.has(item.id)) return;
      state.pendingUpdates.unshift(item);
      added++;
    });

    if(added > 0){
      Store.set('pendingUpdates', state.pendingUpdates);
      if(manual) showToast(`Found ${added} new update(s)`);
    } else if(manual){
      showToast('No new updates found');
    }

    renderPending();
  } catch(e){
    if(manual) showToast('Mail scan failed — check your mail settings');
    renderPending('Mail scan failed: ' + esc(e.message || e));
  }
}

function renderPending(errorMsg){
  const card = document.getElementById('card-pending-updates');
  const list = document.getElementById('pending-list');
  const count = document.getElementById('pending-count');

  if(errorMsg){
    card.style.display = 'flex';
    count.textContent = '';
    list.innerHTML = `<div class="pending-error">${esc(errorMsg)}</div>`;
    return;
  }

  if(!state.pendingUpdates.length){
    card.style.display = 'none';
    return;
  }

  card.style.display = 'flex';
  count.textContent = state.pendingUpdates.length;

  list.innerHTML = state.pendingUpdates.map(p => `
    <div class="pending-row">
      <div class="ptop">
        <div>
          <div class="psubject">${esc(p.subject || '(no subject)')}</div>
          <div class="pmeta">${esc(p.sender || '')}</div>
        </div>
        <span class="pill ${p.category === 'schedule_change' ? 'high' : 'med'}">${p.category === 'schedule_change' ? 'Schedule' : 'Deadline'}</span>
      </div>
      <div class="psnippet">${esc(p.snippet || '')}</div>
      <div class="pactions">
        <button class="btn" onclick="dismissUpdate('${p.id}')">Dismiss</button>
        <button class="btn btn-success" onclick="approveUpdate('${p.id}')">Approve</button>
      </div>
    </div>
  `).join('');
}

function dismissUpdate(id){
  state.pendingUpdates = state.pendingUpdates.filter(p => p.id !== id);
  state.dismissedUpdateIds.push(id);
  Store.set('pendingUpdates', state.pendingUpdates);
  Store.set('dismissedUpdateIds', state.dismissedUpdateIds);
  renderPending();
}

function approveUpdate(id){
  const item = state.pendingUpdates.find(p => p.id === id);
  if(!item) return;

  if(item.category === 'deadline'){
    // Push straight into the existing Agenda / Deadlines card.
    const dateGuess = item.guessed_date ? parseGuessedDate(item.guessed_date) : todayStr();
    state.agenda.push({id:uid(), title:item.subject || 'Untitled deadline', date:dateGuess});
    Store.set('agenda', state.agenda);
    renderAgenda();
    showToast('Added to Deadlines. Check the date.');
  } else {
    // Schedule changes are flagged as an override patch rather than
    // auto-editing a specific grid cell, since regex can't reliably
    // pinpoint which exact slot to overwrite. You confirm which day it hits.
    const day = guessDayFromText(item.subject + ' ' + item.snippet) || todayDayName();
    state.timetableOverrides.push({id:uid(), day:day, text:`${item.subject} — ${item.snippet.slice(0,120)}`});
    Store.set('timetableOverrides', state.timetableOverrides);
    renderTimetable();
    showToast(`Flagged on ${day}`);
  }

  state.pendingUpdates = state.pendingUpdates.filter(p => p.id !== id);
  state.dismissedUpdateIds.push(id);
  Store.set('pendingUpdates', state.pendingUpdates);
  Store.set('dismissedUpdateIds', state.dismissedUpdateIds);
  renderPending();
}

function guessDayFromText(text){
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const lower = text.toLowerCase();
  for(const d of days) if(lower.includes(d.toLowerCase())) return d;
  return null;
}

// Turns a date fragment pulled out of an email ("12/07/2026", "15 Jul",
// "3 August 26") into YYYY-MM-DD. Numeric dates are read day-first (Indian
// convention). Falls back to today if it can't make sense of the text.
function parseGuessedDate(raw){
  const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const now = new Date();
  const text = String(raw || '').trim();
  let day, month, year;

  let m = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if(m){
    day = +m[1]; month = +m[2] - 1; year = +m[3];
  } else if((m = text.match(/^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s*(\d{2,4})?$/))){
    day = +m[1]; month = MONTHS.indexOf(m[2].toLowerCase()); year = m[3] ? +m[3] : null;
  } else {
    return todayStr();
  }

  if(year !== null && year < 100) year += 2000;
  if(year === null){
    // No year in the email: assume the nearest upcoming occurrence, allowing
    // for a deadline that passed within the last month.
    year = now.getFullYear();
    const candidate = new Date(year, month, day);
    if(now - candidate > 30 * 24 * 60 * 60 * 1000) year++;
  }

  const result = new Date(year, month, day);
  // Reject impossible dates (month 13, 31 Feb, ...) instead of rolling over.
  if(month < 0 || result.getMonth() !== month || result.getDate() !== day) return todayStr();
  return todayStr(result);
}
