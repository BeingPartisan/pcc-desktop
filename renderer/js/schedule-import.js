/* ---------- Import a schedule into the evaluation tracker ---------- */
// Students keep their own calendars of what's due, usually as a table like
//
//   Date                      | Time                 | Component          | Course
//   19th November, Thursday   | 4 pm - 5 pm (NAB 106)| Office Hour        | Corporate Law
//   9th December, Wednesday   |                      | Mid-Term           | Jurisprudence
//                             |                      | Term Paper Abstract| CUDAV
//
// "Paste pattern" can't read that: it has no marks, it spans every course,
// and courses are written short ("Corporate Law", "LPD"). This reads such a
// table pasted from Word, Google Docs or a spreadsheet (they all paste as
// tab-separated rows), works out which course each row belongs to, and
// shows a preview where anything it got wrong can be changed before import.
//
// Importing a row:
//   - matches an existing component of that course ("Mid-Term" finds
//     "Mid-term examination") and gives it the date and time, or
//   - adds a new component with its marks left blank to fill in later, or
//   - for things that aren't a course (a moot, a club deadline), adds a
//     plain deadline.

const IMPORT_DEADLINE = '__deadline';   // "Deadlines only" in the course picker
const IMPORT_SKIP = '__skip';
let importRows = [];                   // the preview: [{ date, time, name, courseText, course, action, matchId }]

/* ----- Reading the table ----- */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// "19th November, Thursday", "Nov 19", "19/11", "2026-11-19" -> "YYYY-MM-DD" (or '').
// Without a year, the date is placed in the coming months rather than the past.
function parseLooseDate(cell){
  const s = String(cell || '').toLowerCase().replace(/,/g, ' ');
  let y = null, m = null, d = null, match;
  if((match = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/))){ [y, m, d] = [+match[1], +match[2], +match[3]]; }
  else if((match = s.match(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/))){ [d, m] = [+match[1], +match[2]]; if(match[3]) y = +match[3] < 100 ? 2000 + +match[3] : +match[3]; }
  else {
    const month = MONTHS.findIndex(mo => new RegExp(`\\b${mo}[a-z]*\\b`).test(s));
    const day = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b(?!\s*(?:am|pm|:))/);
    if(month < 0 || !day) return '';
    [m, d] = [month + 1, +day[1]];
    const year = s.match(/\b(20\d{2})\b/);
    if(year) y = +year[1];
  }
  if(!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
  if(!y){
    const today = parseLocalDate(todayStr());
    y = today.getFullYear();
    // More than two months in the past means next year ("8th January" written in November).
    if(new Date(y, m - 1, d) < new Date(today.getTime() - 60 * 86400000)) y++;
  }
  const date = new Date(y, m - 1, d);
  if(date.getMonth() !== m - 1) return ''; // 31st February and the like
  return todayStr(date);
}

const looksLikeTime = (cell) => /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b\d{1,2}:\d{2}\b|\bnoon\b|\bmidnight\b/i.test(cell);

// Lower case, "&" as "and", no punctuation, no roman numeral or number at the end.
function normCourse(s){
  return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+(i{1,3}|iv|v|vi|\d)\s*$/, '').trim();
}

// Which of the user's courses a short or partial name refers to, or '' if unsure.
function matchCourseName(text, courses){
  const t = normCourse(text);
  if(!t) return '';
  const STOP = new Set(['and', 'of', 'the', 'in', 'for', 'to', 'a', 'an', 'on', 'with']);
  const scored = courses.map(course => {
    const c = normCourse(course);
    const words = c.split(' ');
    const initialsAll = words.map(w => w[0]).join('');
    const initialsMain = words.filter(w => !STOP.has(w)).map(w => w[0]).join('');
    const compact = t.replace(/\s/g, '');
    let score = 0;
    if(c === t) score = 100;
    else if((c.startsWith(t + ' ') && t.length >= 6) || t.startsWith(c + ' ')) score = 80; // "Law" alone is too vague
    else if(compact.length >= 2 && !t.includes(' ') && (compact === initialsMain || compact === initialsAll)) score = 70;
    else {
      // Every word of the text starts a word of the course: "corp law" -> "corporate law"
      const tw = t.split(' ').filter(w => !STOP.has(w));
      if(tw.length && tw.every(w => w.length >= 3 && words.some(cw => cw.startsWith(w)))) score = 50 + tw.length;
    }
    return { course, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  if(!scored.length) return '';
  if(scored[1] && scored[1].score === scored[0].score) return ''; // two courses fit equally well
  return scored[0].course;
}

// The pasted text -> rows of cells. Word, Docs and spreadsheets paste tables
// with a tab between cells; a table typed with "|" works too.
function splitTable(text){
  const lines = String(text).split(/\r?\n/).filter(l => l.trim());
  const sep = lines.some(l => l.includes('\t')) ? '\t' : lines.some(l => l.includes('|')) ? '|' : null;
  if(!sep) return lines.map(l => [l.trim()]);
  return lines.map(l => l.split(sep).map(c => c.replace(/\s+/g, ' ').trim()));
}

// Column roles from a header row, if there is one.
function headerRoles(cells){
  const roles = cells.map(c => {
    const s = c.toLowerCase();
    if(/^(date|day|when|deadline|due)/.test(s)) return 'date';
    if(/^(time|timing|slot)/.test(s)) return 'time';
    if(/^(course|subject|paper|class)/.test(s)) return 'course';
    if(/^(component|item|assessment|evaluation|task|what|activity|event|type)/.test(s)) return 'name';
    return null;
  });
  return roles.filter(Boolean).length >= 2 && roles.includes('name') ? roles : null;
}

function parseSchedule(text, courses){
  const table = splitTable(text);
  let roles = null;
  const rows = [];
  for(const cells of table){
    const header = headerRoles(cells);
    if(header){ roles = header; continue; }
    let date = '', time = '', name = '', courseText = '';
    if(roles){
      cells.forEach((cell, i) => {
        if(roles[i] === 'date') date = parseLooseDate(cell);
        else if(roles[i] === 'time') time = cell;
        else if(roles[i] === 'course') courseText = cell;
        else if(roles[i] === 'name') name = cell;
      });
    } else {
      // No header: tell the cells apart by what they look like.
      const rest = [];
      for(const cell of cells){
        if(!cell) continue;
        if(!date && parseLooseDate(cell) && !looksLikeTime(cell)) date = parseLooseDate(cell);
        else if(!time && looksLikeTime(cell)) time = cell;
        else if(!courseText && matchCourseName(cell, courses)) courseText = cell;
        else rest.push(cell);
      }
      name = rest.sort((a, b) => b.length - a.length)[0] || '';
      if(!courseText && rest.length > 1) courseText = rest[1];
    }
    if(!name || cells.length < 2) continue; // a title line such as "CALENDAR:"
    rows.push({ date, time, name: name.slice(0, 80), courseText });
  }
  return rows;
}

/* ----- Matching rows to components ----- */

const normComponent = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, '');

// An existing component of the course that this row is about, if any.
function findComponent(course, name){
  const n = normComponent(name);
  if(n.length < 3) return null;
  const comps = (evaluations[course] || { components: [] }).components;
  return comps.find(c => normComponent(c.name) === n)
    || comps.find(c => { const cn = normComponent(c.name); return cn.length >= 4 && (cn.includes(n) || n.includes(cn)); })
    || null;
}

// What a row will do, given the course chosen for it.
function planRow(row){
  if(row.course === IMPORT_SKIP) return { ...row, action: 'skip', matchId: null };
  if(row.course === IMPORT_DEADLINE) return { ...row, action: row.date ? 'deadline' : 'skip', matchId: null };
  const match = findComponent(row.course, row.name);
  if(match) return { ...row, action: 'update', matchId: match.id, matchName: match.name };
  return { ...row, action: 'add', matchId: null };
}

/* ----- The dialog ----- */

function openScheduleImport(){
  if(!evalCourses().length){ showToast('Connect Digiicampus first, so PCC knows your courses'); return; }
  importRows = [];
  document.getElementById('import-text').value = '';
  showImportStep('paste');
  document.getElementById('import-overlay').classList.add('open');
  document.getElementById('import-text').focus();
}

function closeScheduleImport(){ document.getElementById('import-overlay').classList.remove('open'); }

function showImportStep(step){
  document.getElementById('import-step-paste').style.display = step === 'paste' ? '' : 'none';
  document.getElementById('import-step-preview').style.display = step === 'preview' ? '' : 'none';
}

function readSchedule(){
  const courses = evalCourses();
  const rows = parseSchedule(document.getElementById('import-text').value, courses);
  if(!rows.length){ showToast('Couldn\'t find any rows. Copy the whole table, including its header, and paste it here.'); return; }
  importRows = rows.map(r => {
    const course = matchCourseName(r.courseText, courses);
    return planRow({ ...r, course: course || (r.date ? IMPORT_DEADLINE : IMPORT_SKIP) });
  });
  renderImportPreview();
  showImportStep('preview');
}

function setImportCourse(i, course){ importRows[i] = planRow({ ...importRows[i], course }); renderImportPreview(); }
function setImportField(i, field, value){ importRows[i] = planRow({ ...importRows[i], [field]: value }); renderImportPreview(); }

function renderImportPreview(){
  const courses = evalCourses();
  const label = {
    update: (r) => `Adds the date to “${esc(r.matchName)}”`,
    add: () => 'New component, marks to fill in',
    deadline: () => 'Added to Deadlines',
    skip: () => 'Skipped',
  };
  document.getElementById('import-rows').innerHTML = importRows.map((r, i) => `
    <tr class="${r.action === 'skip' ? 'skipped' : ''}">
      <td><input type="text" value="${esc(r.name)}" aria-label="Component" onchange="setImportField(${i}, 'name', this.value)" /></td>
      <td>
        <select aria-label="Course" onchange="setImportCourse(${i}, this.value)">
          ${courses.map(c => `<option value="${esc(c)}" ${c === r.course ? 'selected' : ''}>${esc(c)}</option>`).join('')}
          <option value="${IMPORT_DEADLINE}" ${r.course === IMPORT_DEADLINE ? 'selected' : ''}>Not a course: Deadlines only</option>
          <option value="${IMPORT_SKIP}" ${r.course === IMPORT_SKIP ? 'selected' : ''}>Skip this row</option>
        </select>
        ${r.courseText ? `<div class="import-was">written as “${esc(r.courseText)}”</div>` : ''}
      </td>
      <td><input type="date" value="${esc(r.date)}" aria-label="Date" onchange="setImportField(${i}, 'date', this.value)" />${r.time ? `<div class="import-was">${esc(r.time)}</div>` : ''}</td>
      <td class="import-action ${r.action}">${label[r.action](r)}</td>
    </tr>`).join('');
  const counts = importRows.reduce((n, r) => (n[r.action] = (n[r.action] || 0) + 1, n), {});
  const unmatched = importRows.filter(r => r.courseText && (r.course === IMPORT_DEADLINE || r.course === IMPORT_SKIP)).length;
  document.getElementById('import-summary').textContent = [
    counts.update && `${counts.update} dated`, counts.add && `${counts.add} new`, counts.deadline && `${counts.deadline} to Deadlines`, counts.skip && `${counts.skip} skipped`,
  ].filter(Boolean).join(' · ') + (unmatched ? ` · ${unmatched} row${unmatched === 1 ? '' : 's'} didn't match a course; pick one if it should` : '');
}

function applyScheduleImport(){
  let changed = 0;
  for(const r of importRows){
    const name = String(r.name || '').trim();
    if(!name) continue;
    if(r.action === 'update'){
      const comp = evalFor(r.course).components.find(c => c.id === r.matchId);
      if(comp){ if(r.date) comp.date = r.date; if(r.time) comp.time = r.time; changed++; }
    } else if(r.action === 'add'){
      evalFor(r.course).components.push({ id: uid(), name, max: null, got: null, date: r.date || '', time: r.time || '' });
      changed++;
    } else if(r.action === 'deadline'){
      const title = `${r.courseText ? r.courseText + ': ' : ''}${name}${r.time ? ' · ' + r.time : ''}`;
      if(!state.agenda.some(a => a.title === title && a.date === r.date)){ state.agenda.push({ id: uid(), title, date: r.date }); changed++; }
    }
  }
  Store.set('agenda', state.agenda);
  closeScheduleImport();
  evalChanged();
  showToast(changed ? `Imported ${changed} item${changed === 1 ? '' : 's'}. New components need their marks filled in.` : 'Nothing to import');
}

document.addEventListener('keydown', e => {
  if(e.key === 'Escape' && document.getElementById('import-overlay').classList.contains('open')) closeScheduleImport();
});
