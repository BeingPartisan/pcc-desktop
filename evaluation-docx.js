// Builds a Word document of the evaluation pattern: an overview of every
// course, one section per course with its components, and every dated
// component in date order. Called from main.js with plain data from the app:
//   { name, term, courses: [{ name, components: [{ name, max, got, date, time, done }] }] }

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType,
  HeadingLevel, AlignmentType, BorderStyle, ShadingType, Footer, PageNumber,
} = require('docx');

const INK = '1F2328', MUTED = '6B7078', LINE = 'D8DBE0', HEAD_FILL = 'F1F3F5', ACCENT = '4F6F1A';
const FONT = 'Calibri';

const fmtDate = (s) => {
  if (!s) return '';
  const d = new Date(s + 'T00:00');
  return isNaN(d) ? s : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};
const num = (n) => (n == null ? '' : String(+Number(n).toFixed(2)));

const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
const borders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };

function cell(text, { bold = false, fill, align = AlignmentType.LEFT, color = INK, width, size = 20 } = {}) {
  return new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: fill ? { type: ShadingType.CLEAR, color: 'auto', fill } : undefined,
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
    children: [new Paragraph({ alignment: align, children: [new TextRun({ text: String(text ?? ''), bold, color, size, font: FONT })] })],
  });
}

function table(header, rows, widths, numeric = []) {
  const align = (i) => (numeric.includes(i) ? AlignmentType.RIGHT : AlignmentType.LEFT);
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders,
    rows: [
      new TableRow({ tableHeader: true, children: header.map((h, i) => cell(h, { bold: true, fill: HEAD_FILL, width: widths[i], align: align(i), size: 19 })) }),
      ...rows.map((r) => new TableRow({ children: r.map((c, i) => (c instanceof TableCell ? c : cell(c, { width: widths[i], align: align(i) }))) })),
    ],
  });
}

const para = (text, opts = {}) => new Paragraph({ spacing: { after: opts.after ?? 120 }, children: [new TextRun({ text, color: opts.color || INK, size: opts.size || 21, italics: !!opts.italics, bold: !!opts.bold, font: FONT })] });

// Dated components first, soonest first (then by time); undated ones after, in their own order.
function byDate(components) {
  return components.map((c, i) => ({ c, i })).sort((a, b) => {
    if (!a.c.date !== !b.c.date) return a.c.date ? -1 : 1;
    return (a.c.date || '').localeCompare(b.c.date || '') || (a.c.time || '').localeCompare(b.c.time || '') || a.i - b.i;
  }).map((x) => x.c);
}

function buildEvaluationDocx(data) {
  const courses = (data.courses || []).filter((c) => c.components && c.components.length)
    .map((c) => ({ ...c, components: byDate(c.components) }));
  const anyScores = courses.some((c) => c.components.some((x) => x.got != null));
  const today = new Date().toISOString().slice(0, 10);
  const children = [];

  // Title
  children.push(new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 80 }, children: [new TextRun({ text: 'Evaluation pattern', font: FONT, size: 48, bold: true, color: INK })] }));
  const sub = [data.name, data.term, `Exported ${fmtDate(today)}`].filter(Boolean).join('  ·  ');
  children.push(para(sub, { color: MUTED, size: 20, after: 320 }));

  // Overview
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 120, after: 140 }, children: [new TextRun({ text: 'Overview', font: FONT, size: 30, bold: true, color: ACCENT })] }));
  children.push(table(
    ['Course', 'Components', 'Total marks', anyScores ? 'Scored so far' : 'Next date'],
    courses.map((c) => {
      const known = c.components.filter((x) => x.max != null);
      const total = known.reduce((s, x) => s + Number(x.max), 0);
      const marked = known.filter((x) => x.got != null);
      const next = c.components.filter((x) => x.date && x.date >= today && x.got == null).sort((a, b) => a.date.localeCompare(b.date))[0];
      return [c.name, String(c.components.length), num(total) + (known.length < c.components.length ? ' + ?' : ''),
        anyScores ? (marked.length ? `${num(marked.reduce((s, x) => s + Number(x.got), 0))} of ${num(marked.reduce((s, x) => s + Number(x.max), 0))}` : '') : (next ? fmtDate(next.date) : '')];
    }),
    [46, 16, 16, 22], [1, 2],
  ));

  // One section per course
  for (const c of courses) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 140 }, keepNext: true, children: [new TextRun({ text: c.name, font: FONT, size: 28, bold: true, color: ACCENT })] }));
    const header = ['#', 'Component', 'Marks', 'Date', 'Time and place'].concat(anyScores ? ['Scored'] : []);
    const widths = anyScores ? [6, 38, 10, 20, 16, 10] : [6, 42, 12, 20, 20];
    const rows = c.components.map((x, i) => [String(i + 1), x.name, x.max == null ? '?' : num(x.max), fmtDate(x.date), x.time || '']
      .concat(anyScores ? [x.got == null ? '' : num(x.got)] : []));
    const known = c.components.filter((x) => x.max != null);
    const total = known.reduce((s, x) => s + Number(x.max), 0);
    const scored = c.components.filter((x) => x.got != null);
    const totalRow = ['', 'Total', num(total), '', ''].concat(anyScores ? [scored.length ? num(scored.reduce((s, x) => s + Number(x.got), 0)) : ''] : []);
    rows.push(totalRow.map((t, i) => cell(t, { bold: true, fill: HEAD_FILL, width: widths[i], align: [0, 2, 5].includes(i) ? AlignmentType.RIGHT : AlignmentType.LEFT })));
    children.push(table(header, rows, widths, [0, 2, 5]));
    const unknown = c.components.length - known.length;
    if (unknown) children.push(para(`${unknown} component${unknown === 1 ? ' has' : 's have'} no marks set yet.`, { color: MUTED, size: 18, italics: true }));
    else if (total !== 100) children.push(para(`These components add up to ${num(total)}, not 100.`, { color: MUTED, size: 18, italics: true }));
  }

  // Every dated component, in order
  const dated = courses.flatMap((c) => c.components.filter((x) => x.date).map((x) => ({ ...x, course: c.name })))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (dated.length) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, spacing: { after: 140 }, children: [new TextRun({ text: 'All dates', font: FONT, size: 30, bold: true, color: ACCENT })] }));
    children.push(table(
      ['Date', 'Course', 'Component', 'Marks', 'Time and place'],
      dated.map((x) => [fmtDate(x.date), x.course, x.name, x.max == null ? '?' : num(x.max), x.time || '']),
      [20, 26, 28, 10, 16], [3],
    ));
  }

  const doc = new Document({
    creator: 'Personal Command Center',
    title: 'Evaluation pattern',
    styles: { default: { document: { run: { font: FONT, size: 21, color: INK } } } },
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [
        new TextRun({ text: 'Evaluation pattern  ·  page ', color: MUTED, size: 16, font: FONT }),
        new TextRun({ children: [PageNumber.CURRENT], color: MUTED, size: 16, font: FONT }),
      ] })] }) },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}

module.exports = { buildEvaluationDocx };
