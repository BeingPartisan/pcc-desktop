/* ---------- Academics page: attendance and results ---------- */
// Both come from the Digiicampus sync (see campus.js in the main process)
// and live on `campus.data`:
//   attendance: { present, absent, total, percentage,
//                 courses: [{ name, present, absent, total, scheduled, percentage, missed: [dates] }] }
//   results:    { cgpa, totalCredits,
//                 terms: [{ examId, name, sgpa, courses: [{ name, code, credits, marks, grade, gradePoint }] }] }
// Nothing here is editable: it mirrors what the university has recorded.

// The university's grading scale: seven passing grades five marks apart,
// from C at 40 up to O at 70 and above. Below 40 is F (fail); AB means the
// exam was missed, so the course is repeated and its result is pending.
// `cls` picks the colour (see .pill.grade-* in the stylesheet).
const GRADE_SCALE = [
  { grade: 'O',  points: 7, min: 70, cls: 'o' },
  { grade: 'A+', points: 6, min: 65, cls: 'ap' },
  { grade: 'A',  points: 5, min: 60, cls: 'a' },
  { grade: 'B+', points: 4, min: 55, cls: 'bp' },
  { grade: 'B',  points: 3, min: 50, cls: 'b' },
  { grade: 'C+', points: 2, min: 45, cls: 'cp' },
  { grade: 'C',  points: 1, min: 40, cls: 'c' },
];
const MAX_GRADE_POINTS = 7;

function gradeClass(grade){
  const g = String(grade || '').toUpperCase();
  if(g === 'F') return 'f';
  if(g === 'AB') return 'ab';
  const row = GRADE_SCALE.find(r => r.grade === g);
  return row ? row.cls : 'none';
}

// A short note under the marks: how far the next grade is, or what a fail
// or an absence means.
function gradeNote(course){
  const g = String(course.grade || '').toUpperCase();
  if(g === 'AB') return 'Absent · repeat, result pending';
  if(g === 'F' || course.failed) return course.marks === null ? 'Fail' : `Fail · ${+(40 - course.marks).toFixed(2)} short of a pass`;
  if(course.marks === null) return '';
  const next = [...GRADE_SCALE].reverse().find(r => r.min > course.marks);
  return next ? `${+(next.min - course.marks).toFixed(2)} more for ${next.grade}` : '';
}

const DEFAULT_ATTENDANCE_TARGET = 75; // percent; adjustable on the Attendance card
let academicsTermExamId = null;       // which term the results table is showing

function attendanceTarget(){
  const t = Number(state.settings.attendanceTarget);
  return t >= 1 && t <= 100 ? t : DEFAULT_ATTENDANCE_TARGET;
}

function setAttendanceTarget(value){
  const t = Math.round(Number(value));
  if(!(t >= 1 && t <= 100)){ showToast('Enter a target between 1 and 100'); renderAcademics(); return; }
  state.settings.attendanceTarget = t;
  Store.set('settings', state.settings);
  renderAcademics();
  renderTodayStatus();
}

// What it takes to stay at, or get back to, the target.
//   held    = classes held so far, present = attended, left = still to come
function attendanceAdvice(present, held, left, targetPct){
  const T = targetPct / 100;
  if(!held) return { text: 'No classes held yet', cls: '' };
  if(present / held >= T){
    const canMiss = Math.floor(present / T - held + 1e-9);
    if(canMiss <= 0) return { text: 'On target, with no room to miss a class', cls: 'warn' };
    return { text: `You can miss ${Math.min(canMiss, left || canMiss)} more`, cls: 'ok' };
  }
  if(T >= 1) return { text: `Below ${targetPct}%`, cls: 'bad' };
  const need = Math.ceil((T * held - present) / (1 - T) - 1e-9);
  if(left && need > left){
    const best = Math.round((present + left) / (held + left) * 100);
    return { text: `Can't reach ${targetPct}% this term (${best}% at best)`, cls: 'bad' };
  }
  return { text: `Attend the next ${need} to reach ${targetPct}%`, cls: 'bad' };
}

function shortDate(dateStr){
  const d = parseLocalDate(dateStr); return d.getDate() + " " + d.toLocaleDateString(undefined, { month: "short" });
}

// "AY 2024-25, 1st Trimester" -> "24-25 T1"
function shortTermName(name){
  const m = String(name).match(/(\d{2})\s*-\s*(\d{2}),\s*(\d)/);
  return m ? `${m[1]}-${m[2]} T${m[3]}` : name;
}

function academicsEmptyState(what){
  if(campusActive()) return `<div class="empty">No ${what} from Digiicampus yet. Try Sync on the Study page.</div>`;
  return `<div class="empty">Connect Digiicampus to see your ${what} here.</div>
    <div><button class="btn btn-primary" onclick="openSettingsAt('timetable')">Connect Digiicampus</button></div>`;
}

function renderAttendance(){
  const el = document.getElementById('attendance-body');
  const summary = document.getElementById('attendance-summary');
  const att = campus.data && campus.data.attendance;
  document.getElementById('attendance-target-wrap').style.display = att ? '' : 'none';
  if(!att){ summary.textContent = ''; el.innerHTML = academicsEmptyState('attendance'); return; }

  const target = attendanceTarget();
  document.getElementById('attendance-target').value = target;
  summary.textContent = `${att.present} of ${att.total} classes`;

  const bar = (pct) => `
    <div class="att-bar"><div class="att-bar-fill ${pct < target ? 'below' : ''}" style="width:${Math.min(100, pct)}%"></div>
      <div class="att-bar-target" style="left:${target}%" title="Target ${target}%"></div></div>`;

  const overall = `
    <div class="att-overall">
      <div class="att-big ${att.percentage < target ? 'below' : ''}">${att.percentage.toFixed(1)}<span>%</span></div>
      <div class="att-overall-side">
        <div class="att-meta">Overall this term · ${att.absent} missed</div>
        ${bar(att.percentage)}
      </div>
    </div>`;

  const rows = att.courses.map(c => {
    const left = Math.max(0, (c.scheduled || 0) - (c.present + c.absent));
    const advice = attendanceAdvice(c.present, c.total, left, target);
    const missed = c.missed && c.missed.length ? `Missed ${c.missed.map(shortDate).join(', ')}` : '';
    return `
      <div class="att-row">
        <div class="att-row-top">
          <div class="att-name" style="border-left-color:${colorForSubject(c.name)}">${esc(c.name)}</div>
          <div class="att-pct ${c.percentage < target ? 'below' : ''}">${Math.round(c.percentage)}%</div>
        </div>
        ${bar(c.percentage)}
        <div class="att-row-foot">
          <span>${c.present} of ${c.total} attended${left ? ` · ${left} left` : ''}</span>
          <span class="att-advice ${advice.cls}">${esc(advice.text)}</span>
        </div>
        ${missed ? `<div class="att-missed">${esc(missed)}</div>` : ''}
      </div>`;
  }).join('');

  el.innerHTML = overall + rows;
}

function showResultsTerm(examId){
  academicsTermExamId = Number(examId);
  renderResults();
}

function renderResults(){
  const el = document.getElementById('results-body');
  const res = campus.data && campus.data.results;
  if(!res || !res.terms || !res.terms.length){ el.innerHTML = academicsEmptyState('results'); return; }

  const terms = res.terms;
  if(!terms.some(t => t.examId === academicsTermExamId)) academicsTermExamId = terms[terms.length - 1].examId;
  const term = terms.find(t => t.examId === academicsTermExamId);

  const sgpas = terms.map(t => t.sgpa).filter(v => typeof v === 'number');
  const scaleMax = MAX_GRADE_POINTS;
  const chart = terms.map(t => {
    const has = typeof t.sgpa === 'number';
    return `
      <button class="gpa-col ${t.examId === academicsTermExamId ? 'active' : ''}" onclick="showResultsTerm(${t.examId})" title="${esc(t.name)}">
        <span class="gpa-value">${has ? t.sgpa.toFixed(2) : '–'}</span>
        <span class="gpa-bar"><span style="height:${has ? Math.max(4, t.sgpa / scaleMax * 100) : 4}%"></span></span>
        <span class="gpa-label">${esc(shortTermName(t.name))}</span>
      </button>`;
  }).join('');

  const credits = term.courses.reduce((sum, c) => sum + (c.credits || 0), 0);
  const table = `
    <table class="results-table">
      <tr><th>Course</th><th class="num">Credits</th><th class="num">Marks</th><th class="num">Grade</th><th class="num">Points</th></tr>
      ${term.courses.map(c => `
        <tr>
          <td><div class="results-course">${esc(c.name)}</div>${c.code ? `<div class="results-code">${esc(c.code)}</div>` : ''}</td>
          <td class="num">${c.credits || '–'}</td>
          <td class="num">${c.marks === null ? '–' : c.marks}${gradeNote(c) ? `<div class="grade-note">${esc(gradeNote(c))}</div>` : ''}</td>
          <td class="num"><span class="pill grade grade-${gradeClass(c.grade)}">${esc(c.grade || '–')}</span></td>
          <td class="num">${c.gradePoint === null ? '–' : c.gradePoint}</td>
        </tr>`).join('')}
    </table>
    <div class="grade-legend">
      ${GRADE_SCALE.map(r => `<span><span class="pill grade grade-${r.cls}">${r.grade}</span>${r.min}${r.points === MAX_GRADE_POINTS ? '+' : ''}</span>`).join('')}
      <span><span class="pill grade grade-f">F</span>below 40</span>
      <span><span class="pill grade grade-ab">AB</span>absent</span>
    </div>`;

  el.innerHTML = `
    <div class="gpa-head">
      <div>
        <div class="att-meta">CGPA</div>
        <div class="att-big">${typeof res.cgpa === 'number' ? res.cgpa.toFixed(2) : '–'}</div>
      </div>
      <div class="gpa-head-side">
        <div class="att-meta">${terms.length} terms${res.totalCredits ? ` · ${res.totalCredits} credits` : ''}</div>
        <div class="att-meta">SGPA by term. Click a bar to see its courses.</div>
      </div>
    </div>
    <div class="gpa-chart">${chart}</div>
    <div class="results-term-head">
      <div class="results-term-name">${esc(term.name)}</div>
      <div class="att-meta">${typeof term.sgpa === 'number' ? `SGPA ${term.sgpa.toFixed(2)} · ` : ''}${credits} credits</div>
    </div>
    ${table}`;
}

function renderAcademics(){
  renderAttendance();
  renderResults();
  renderEvaluation();
}
