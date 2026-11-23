// Reads the tables out of a Word (.docx) file, each with the last line of
// text written above it (its heading), in document order. Used to import an
// evaluation pattern exported by PCC (or any schedule kept as a Word table).
// No formatting, no images: just text, row by row.
//
//   readWordTables(buffer) -> [{ heading: 'Law of Torts', rows: [['#', 'Component', ...], ...] }]

const { unzipSync, strFromU8 } = require('fflate');

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16))).replace(/&amp;/g, '&');

// The visible text of a piece of WordprocessingML.
function textOf(xml) {
  return decode(xml
    .replace(/<w:tab\/>/g, '\t').replace(/<w:br\/>/g, ' ')
    .replace(/<\/w:p>/g, ' ')
    .replace(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<[^>]+>/g, (m, t) => (t !== undefined ? t : '')))
    .replace(/\s+/g, ' ').trim();
}

function readWordTables(buffer) {
  const files = unzipSync(new Uint8Array(buffer), { filter: (f) => f.name === 'word/document.xml' });
  if (!files['word/document.xml']) throw new Error("This doesn't look like a Word document");
  const xml = strFromU8(files['word/document.xml']);
  const body = (xml.match(/<w:body>([\s\S]*)<\/w:body>/) || [, xml])[1];

  const out = [];
  let lastText = '';
  // Top-level tables and paragraphs, in order. A table's own paragraphs are
  // taken with the table. (Tables inside tables aren't expected here.)
  const parts = body.match(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g) || [];
  for (const part of parts) {
    if (part.startsWith('<w:tbl>')) {
      const rows = (part.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || [])
        .map((tr) => (tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).map(textOf))
        .filter((cells) => cells.some(Boolean));
      if (rows.length) out.push({ heading: lastText, rows });
    } else {
      const t = textOf(part);
      if (t) lastText = t;
    }
  }
  return out;
}

module.exports = { readWordTables };
