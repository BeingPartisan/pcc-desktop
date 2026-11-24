/* ---------- Evaluation tracker ---------- */
// For each current course: how its 100 marks are split, what has been
// scored so far, and what is still needed for each grade.
//
// The university doesn't publish this as data, so the breakdown is entered
// by hand, or pasted from the course page and read by parseEvaluationText().
// Stored under "evaluations":
//   { [courseName]: { components: [{ id, name, max, got, date, time }] } }
// `max` is null when the marks aren't known yet (a component imported from
// a schedule); `got` is null until a mark is entered. `date` and `time`
// are optional; while the component is unmarked, a dated one shows up
// alongside the other deadlines.

let evaluations = Store.get('evaluations', {});
let evalPasteCourse = null; // course whose "paste pattern" dialog is open

function saveEvaluations(){ Store.set('evaluations', evaluations); }

// Dated components first, soonest first (then by time), so what's coming next is at the top;
// undated ones after, in the order they were added.
function componentsByDate(components){
  return components.map((c, i) => ({ c, i })).sort((a, b) => {
    if(!a.c.date !== !b.c.date) return a.c.date ? -1 : 1;
    return (a.c.date || '').localeCompare(b.c.date || '') || (a.c.time || '').localeCompare(b.c.time || '') || a.i - b.i;
  }).map(x => x.c);
}
function evalCourses(){ return inboxCourses().map(c => c.name); }
function evalFor(course){ return evaluations[course] || (evaluations[course] = { components: [] }); }

// Reads an evaluation pattern as professors write it, one component per
// line, e.g. "2. In-class assignment: 20 [after 15 sessions]" or
// "(1) Class Participation: 10 marks". Returns [{ name, max }].
// It keeps the first number after the label and ignores the rest of the
// line; lines it can't make sense of are skipped.
function parseEvaluationText(text){
  const lines = String(text)
    .replace(/\s+(?=\(\d{1,2}\)\s)/g, '\n')        // "(1) … (2) …" written on one line
    .replace(/\s+(?=\d{1,2}\.\s+[A-Z])/g, '\n')    // "1. … 2. …" written on one line
    .split(/\r?\n/);
  const found = [];
  for(const raw of lines){
    const line = raw.replace(/^\s*(?:\(?\d{1,2}[.)]\)?|[-•●*])\s*/, '').trim();
    if(!line || line.includes('::')) continue;                 // "Exam : Internals :: 60:40" is a ratio, not a component
    // A number followed by a unit ("15 mins", "8 students") is a detail, not a mark.
    const m = line.match(/^(.{2,110}?)\s*[:\-–]\s*(\d{1,3}(?:\.\d+)?)(?!\d)(?!\s*(?:mins?|minutes?|hours?|hrs?|students?|teams?|sessions?|words?|pages?|weeks?|days?|x|st|nd|rd|th)\b)\s*(?:marks?\b|%)?/i)
           || line.match(/^(.{2,110}?)\s+\(?(\d{1,3}(?:\.\d+)?)\s*marks?\b/i);
    if(!m) continue;
    const name = m[1].replace(/^(exam|internal)s?\s+components?\s*[-:–]\s*/i, '').replace(/[\s:–-]+$/, '').trim();
    const max = Number(m[2]);
    if(!/[a-z]/i.test(name) || !(max > 0 && max <= 100)) continue;
    // A repeat exam replaces other components rather than adding to them,
    // and "a total of 100 marks" is the sum, not a component.
    if(/\b(repeat|total)\b/i.test(name)) continue;
    found.push({ name, max });
  }
  return found;
}

function evalSummary(course){
  const comps = evalFor(course).components.filter(c => c.max != null); // ones without marks yet don't count
  const marked = comps.filter(c => c.got !== null);
  return {
    total: comps.reduce((s, c) => s + c.max, 0),
    got: marked.reduce((s, c) => s + c.got, 0),
    assessed: marked.reduce((s, c) => s + c.max, 0),
    remaining: comps.filter(c => c.got === null).reduce((s, c) => s + c.max, 0),
    unknown: evalFor(course).components.length - comps.length,
  };
}

// For each grade: already secured, still reachable (and how many of the
// remaining marks it needs), or out of reach.
function gradeOutlook(summary){
  return GRADE_SCALE.map(g => {
    const need = +(g.min - summary.got).toFixed(2);
    if(need <= 0) return { ...g, status: 'secured' };
    if(need > summary.remaining) return { ...g, status: 'out' };
    return { ...g, status: 'need', need };
  });
}

// Unmarked components that have a date, for the Deadlines lists.
function evaluationDeadlines(){
  const current = new Set(evalCourses());
  const items = [];
  for(const [course, entry] of Object.entries(evaluations)){
    if(!current.has(course)) continue;
    for(const c of entry.components) if(c.date && c.got === null && !c.done) items.push({ title: `${course}: ${c.name}${c.time ? ' · ' + c.time : ''}`, date: c.date, fromEvaluation: true, key: 'e:' + encodeURIComponent(course) + ':' + c.id });
  }
  return items;
}

/* ----- Editing ----- */

function evalChanged(){
  saveEvaluations();
  renderEvaluation();
  renderAgenda(); // dated components appear with the deadlines (also refreshes Today)
}

function addEvalComponent(courseIndex){
  evalFor(evalCourses()[courseIndex]).components.push({ id: uid(), name: 'New component', max: null, got: null, date: '', time: '' });
  evalChanged();
}

function removeEvalComponent(courseIndex, id){
  const entry = evalFor(evalCourses()[courseIndex]);
  entry.components = entry.components.filter(c => c.id !== id);
  evalChanged();
}

function updateEvalComponent(courseIndex, id, field, value){
  const comp = evalFor(evalCourses()[courseIndex]).components.find(c => c.id === id);
  if(!comp) return;
  if(field === 'name') comp.name = value.trim() || comp.name;
  if(field === 'date') comp.date = value;
  if(field === 'time') comp.time = value.trim();
  if(field === 'max' && value === ''){
    if(comp.got !== null){ showToast(sayAny('Remove the mark scored first', 'Remove the mark scored first. Can’t un-know the total, bro.')); return renderEvaluation(); }
    comp.max = null; // not known yet
  } else if(field === 'max'){
    const max = Number(value);
    if(!(max > 0 && max <= 100)){ showToast(sayAny('Marks must be between 1 and 100', 'Marks must be between 1 and 100. This isn’t a video game score, yaar.')); return renderEvaluation(); }
    comp.max = max;
    if(comp.got !== null && comp.got > max) comp.got = max;
  }
  if(field === 'got'){
    if(value !== '' && comp.max == null){ showToast(sayAny('Fill in what it is out of first', 'Fill in what it is out of first. 18 out of what, bhai?')); return renderEvaluation(); }
    if(value === ''){ comp.got = null; }
    else {
      const got = Number(value);
      if(!(got >= 0 && got <= comp.max)){ showToast(sayAny(`Enter a mark from 0 to ${comp.max}`, `Enter a mark from 0 to ${comp.max}. Bonus marks aren't real, bro.`, `Enter a mark from 0 to ${comp.max}. We love the confidence though.`)); return renderEvaluation(); }
      comp.got = got;
    }
  }
  evalChanged();
}

function openEvalPaste(courseIndex){
  evalPasteCourse = evalCourses()[courseIndex];
  document.getElementById('eval-paste-course').textContent = evalPasteCourse;
  document.getElementById('eval-paste-text').value = '';
  document.getElementById('eval-overlay').classList.add('open');
  document.getElementById('eval-paste-text').focus();
}
function closeEvalPaste(){
  evalPasteCourse = null;
  document.getElementById('eval-overlay').classList.remove('open');
}
function applyEvalPaste(){
  if(!evalPasteCourse) return;
  const found = parseEvaluationText(document.getElementById('eval-paste-text').value);
  if(!found.length) return showToast(sayAny("Couldn't find any components. Try one per line, like \"Mid-term: 25\".", "Couldn't find any components. Professor-speak is hard. Try one per line, like \"Mid-term: 25\"."));
  const entry = evalFor(evalPasteCourse);
  // Components that already carry a mark are kept; the rest are replaced.
  entry.components = [...entry.components.filter(c => c.got !== null), ...found.map(f => ({ id: uid(), name: f.name, max: f.max, got: null, date: '' }))];
  const total = entry.components.reduce((s, c) => s + c.max, 0);
  closeEvalPaste();
  evalChanged();
  showToast(sayAny(`${found.length} components read, adding up to ${total}`, `${found.length} components read, adding up to ${total}. Decoded the professor, easy.`, `${found.length} components read, adding up to ${total}. Now you know what you're up against.`));
}
document.addEventListener('keydown', e => { if(e.key === 'Escape' && evalPasteCourse) closeEvalPaste(); });

/* ----- Export ----- */

// Every current course's pattern as a Word document (built in the main process).
async function exportEvaluationDocx(){
  if(!window.pcc || !window.pcc.exportEvaluationDocx) return;
  const courses = evalCourses().map(name => ({ name, components: componentsByDate(evalFor(name).components).map(c => ({ name: c.name, max: c.max, got: c.got, date: c.date || '', time: c.time || '' })) }))
    .filter(c => c.components.length);
  if(!courses.length) return showToast(sayAny('Add an evaluation pattern to a course first', 'Add an evaluation pattern to a course first. Can’t export thin air, bro.'));
  const result = await window.pcc.exportEvaluationDocx({ name: state.settings.name || '', courses });
  if(result.canceled) return;
  if(!result.ok) return showToast(say("Couldn't save the document: ", "Couldn't save the document (Word said no): ") + (result.error || 'unknown error'));
  showToast(sayAny('Evaluation pattern saved', 'Evaluation pattern saved. Very lawyerly of you.', 'Evaluation pattern saved. Print it, frame it, fear it.'));
  window.pcc.openExportedFile(result.filePath);
}

/* ----- Drawing ----- */

function renderEvaluation(){
  const el = document.getElementById('evaluation-body');
  if(!el) return;
  const courses = evalCourses();
  if(!courses.length){ el.innerHTML = academicsEmptyState('courses'); return; }

  el.innerHTML = courses.map((course, i) => {
    const comps = evalFor(course).components;
    const s = evalSummary(course);
    const head = `<div class="att-name" style="border-left-color:${colorForSubject(course)}">${esc(course)}</div>`;

    if(!comps.length){
      return `
        <div class="eval-course">
          <div class="eval-head">${head}</div>
          <div class="att-meta">${say('No evaluation pattern yet. Paste it from the course page, or add components one by one.', 'No evaluation pattern yet. Paste it from the course page, or add components one by one. Know thy enemy.', 'No evaluation pattern yet. Paste it from the course page, or add components one by one. Going in blind is a choice, bro.')}</div>
          <div class="eval-actions"><button class="btn btn-primary" onclick="openEvalPaste(${i})">Paste pattern</button><button class="btn" onclick="addEvalComponent(${i})">Add component</button></div>
        </div>`;
    }

    const rows = componentsByDate(comps).map(c => `
      <tr>
        <td><input type="text" value="${esc(c.name)}" title="${esc(c.name)}" aria-label="Component name" onchange="updateEvalComponent(${i}, '${c.id}', 'name', this.value)" /></td>
        <td class="num"><input type="number" min="1" max="100" value="${c.max == null ? '' : c.max}" placeholder="?" class="${c.max == null ? 'unknown' : ''}" title="${c.max == null ? 'Marks not known yet' : ''}" aria-label="Marks available" onchange="updateEvalComponent(${i}, '${c.id}', 'max', this.value)" /></td>
        <td class="num"><input type="number" min="0" max="${c.max == null ? 100 : c.max}" step="0.25" value="${c.got === null ? '' : c.got}" placeholder="–" aria-label="Marks scored" ${c.max == null ? 'disabled' : ''} onchange="updateEvalComponent(${i}, '${c.id}', 'got', this.value)" /></td>
        <td><input type="date" value="${esc(c.date || '')}" aria-label="Date" onchange="updateEvalComponent(${i}, '${c.id}', 'date', this.value)" />
          <input type="text" class="eval-time" value="${esc(c.time || '')}" placeholder="Time, place" aria-label="Time and place" onchange="updateEvalComponent(${i}, '${c.id}', 'time', this.value)" /></td>
        <td class="num"><button class="btn btn-icon btn-danger" onclick="removeEvalComponent(${i}, '${c.id}')" aria-label="Remove ${esc(c.name)}">&times;</button></td>
      </tr>`).join('');

    // Bar: scored | lost | still to come, as shares of the course total
    const scale = Math.max(s.total, 1);
    const lost = s.assessed - s.got;
    const outlook = gradeOutlook(s).map(g => `
      <span class="eval-grade ${g.status}">
        <span class="pill grade grade-${g.cls}">${g.grade}</span>
        ${g.status === 'secured' ? 'secured' : g.status === 'out' ? 'out of reach' : `${g.need} of ${s.remaining}`}
      </span>`).join('');
    const pass = gradeOutlook(s).find(g => g.grade === 'C');

    return `
      <div class="eval-course">
        <div class="eval-head">
          ${head}
          <div class="eval-total"><b>${+s.got.toFixed(2)}</b> of ${s.assessed} marked${s.remaining ? ` · ${s.remaining} to come` : ''}</div>
        </div>
        <div class="eval-bar"><span class="got" style="width:${s.got / scale * 100}%"></span><span class="lost" style="width:${lost / scale * 100}%"></span></div>
        ${s.unknown ? `<div class="mail-note" style="color:var(--amber);">${s.unknown} component${s.unknown === 1 ? ' has' : 's have'} no marks yet. Fill in what ${s.unknown === 1 ? 'it is' : 'they are'} out of when you know.</div>` : ''}
        ${s.total !== 100 && !s.unknown ? `<div class="mail-note" style="color:var(--amber);">${say(`These components add up to ${s.total}, not 100.`, `These components add up to ${s.total}, not 100. Maths is hard, we get it.`)}</div>` : ''}
        <table class="eval-table">
          <tr><th>Component</th><th class="num">Out of</th><th class="num">Scored</th><th>Date</th><th></th></tr>
          ${rows}
        </table>
        <div class="eval-actions"><button class="btn" onclick="addEvalComponent(${i})">Add component</button><button class="btn" onclick="openEvalPaste(${i})">Paste pattern</button></div>
        ${s.remaining
          ? `<div class="eval-outlook"><div class="att-meta">Marks needed from the ${s.remaining} still to come${pass.status === 'secured' ? '' : pass.status === 'out' ? ' · a pass is out of reach' : ` · ${pass.need} to pass`}</div><div class="eval-grades">${outlook}</div></div>`
          : s.unknown
            ? `<div class="eval-outlook"><div class="att-meta">${+s.got.toFixed(2)} of ${s.total} so far. Fill in the marks for the rest to see what you need for each grade.</div></div>`
            : `<div class="eval-outlook"><div class="att-meta">${say(`All components marked: ${+s.got.toFixed(2)} of ${s.total}`, `All components marked: ${+s.got.toFixed(2)} of ${s.total}. It's over, you survived.`)}</div></div>`}
      </div>`;
  }).join('');
}
