/* ---------- Evaluation tracker ---------- */
// For each current course: how its 100 marks are split, what has been
// scored so far, and what is still needed for each grade.
//
// The university doesn't publish this as data, so the breakdown is entered
// by hand, or pasted from the course page and read by parseEvaluationText().
// Stored under "evaluations":
//   { [courseName]: { components: [{ id, name, max, got, date }] } }
// `got` is null until a mark is entered; `date` is optional and, while the
// component is unmarked, shows up alongside the other deadlines.

let evaluations = Store.get('evaluations', {});
let evalPasteCourse = null; // course whose "paste pattern" dialog is open

function saveEvaluations(){ Store.set('evaluations', evaluations); }
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
  const comps = evalFor(course).components;
  const marked = comps.filter(c => c.got !== null);
  return {
    total: comps.reduce((s, c) => s + c.max, 0),
    got: marked.reduce((s, c) => s + c.got, 0),
    assessed: marked.reduce((s, c) => s + c.max, 0),
    remaining: comps.filter(c => c.got === null).reduce((s, c) => s + c.max, 0),
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
    for(const c of entry.components) if(c.date && c.got === null) items.push({ title: `${course}: ${c.name}`, date: c.date, fromEvaluation: true });
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
  evalFor(evalCourses()[courseIndex]).components.push({ id: uid(), name: 'New component', max: 10, got: null, date: '' });
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
  if(field === 'max'){
    const max = Number(value);
    if(!(max > 0 && max <= 100)){ showToast('Marks must be between 1 and 100'); return renderEvaluation(); }
    comp.max = max;
    if(comp.got !== null && comp.got > max) comp.got = max;
  }
  if(field === 'got'){
    if(value === ''){ comp.got = null; }
    else {
      const got = Number(value);
      if(!(got >= 0 && got <= comp.max)){ showToast(`Enter a mark from 0 to ${comp.max}`); return renderEvaluation(); }
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
  if(!found.length) return showToast("Couldn't find any components. Try one per line, like \"Mid-term: 25\".");
  const entry = evalFor(evalPasteCourse);
  // Components that already carry a mark are kept; the rest are replaced.
  entry.components = [...entry.components.filter(c => c.got !== null), ...found.map(f => ({ id: uid(), name: f.name, max: f.max, got: null, date: '' }))];
  const total = entry.components.reduce((s, c) => s + c.max, 0);
  closeEvalPaste();
  evalChanged();
  showToast(`${found.length} components read, adding up to ${total}`);
}
document.addEventListener('keydown', e => { if(e.key === 'Escape' && evalPasteCourse) closeEvalPaste(); });

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
          <div class="att-meta">No evaluation pattern yet. Paste it from the course page, or add components one by one.</div>
          <div class="eval-actions"><button class="btn btn-primary" onclick="openEvalPaste(${i})">Paste pattern</button><button class="btn" onclick="addEvalComponent(${i})">Add component</button></div>
        </div>`;
    }

    const rows = comps.map(c => `
      <tr>
        <td><input type="text" value="${esc(c.name)}" title="${esc(c.name)}" aria-label="Component name" onchange="updateEvalComponent(${i}, '${c.id}', 'name', this.value)" /></td>
        <td class="num"><input type="number" min="1" max="100" value="${c.max}" aria-label="Marks available" onchange="updateEvalComponent(${i}, '${c.id}', 'max', this.value)" /></td>
        <td class="num"><input type="number" min="0" max="${c.max}" step="0.25" value="${c.got === null ? '' : c.got}" placeholder="–" aria-label="Marks scored" onchange="updateEvalComponent(${i}, '${c.id}', 'got', this.value)" /></td>
        <td><input type="date" value="${esc(c.date || '')}" aria-label="Date" onchange="updateEvalComponent(${i}, '${c.id}', 'date', this.value)" /></td>
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
        ${s.total !== 100 ? `<div class="mail-note" style="color:var(--amber);">These components add up to ${s.total}, not 100.</div>` : ''}
        <table class="eval-table">
          <tr><th>Component</th><th class="num">Out of</th><th class="num">Scored</th><th>Date</th><th></th></tr>
          ${rows}
        </table>
        <div class="eval-actions"><button class="btn" onclick="addEvalComponent(${i})">Add component</button><button class="btn" onclick="openEvalPaste(${i})">Paste pattern</button></div>
        ${s.remaining
          ? `<div class="eval-outlook"><div class="att-meta">Marks needed from the ${s.remaining} still to come${pass.status === 'secured' ? '' : pass.status === 'out' ? ' · a pass is out of reach' : ` · ${pass.need} to pass`}</div><div class="eval-grades">${outlook}</div></div>`
          : `<div class="eval-outlook"><div class="att-meta">All components marked: ${+s.got.toFixed(2)} of ${s.total}</div></div>`}
      </div>`;
  }).join('');
}
