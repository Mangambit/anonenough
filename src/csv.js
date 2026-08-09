// A small RFC-4180 CSV reader. Zero dependencies, like everything else here.
//
// Scope is deliberate: quoted fields, escaped quotes, embedded delimiters and
// newlines, CRLF, and a delimiter sniff (comma / semicolon / tab). Anything more
// exotic — multi-character delimiters, comment lines, type coercion — is out, and
// the parser fails loudly rather than guessing.

/**
 * Guess the delimiter from the first non-empty line: whichever of `,` `;` `\t`
 * appears most often *outside quotes*. Ties go to the comma.
 */
export function sniffDelimiter(text) {
  const line = text.split(/\r?\n/).find((l) => l.trim().length > 0) || '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch]++;
  }
  let best = ',';
  for (const d of [';', '\t']) if (counts[d] > counts[best]) best = d;
  return best;
}

/**
 * Parse CSV text into { headers, rows } where each row is an array of strings.
 * Throws with a line number on structural errors (a quote opened and never
 * closed, a ragged row) — a privacy audit run on a misread file is worse than
 * no audit, so this never silently repairs.
 */
export function parseCsv(text, delimiter = sniffDelimiter(text)) {
  const records = [];
  let field = '';
  let record = [];
  let inQuotes = false;
  let wasQuoted = false;
  let line = 1;

  // WHY the quoted flag: trimming every field would make "  A  " and "A"
  // identical, silently merging two equivalence classes and reporting a LARGER
  // k than the file actually has — the tool would call a file safer than it is.
  // Quoting is the author saying the spaces are data, so quoted fields are kept
  // byte-for-byte and only unquoted ones lose surrounding whitespace.
  const pushField = () => {
    record.push(wasQuoted ? field : field.trim());
    field = '';
    wasQuoted = false;
  };
  const pushRecord = () => {
    pushField();
    // A completely blank line between records is noise, not a one-column row.
    if (!(record.length === 1 && record[0] === '')) records.push(record);
    record = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      if (field === '' && !wasQuoted) { inQuotes = true; wasQuoted = true; }
      else field += ch; // a stray quote mid-field is kept literally
    } else if (ch === delimiter) {
      pushField();
    } else if (ch === '\n') {
      pushRecord();
      line++;
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (inQuotes) throw new Error(`Unclosed quote — the file ends inside a quoted field (line ${line}).`);
  if (field !== '' || record.length) pushRecord();

  if (records.length < 2) {
    throw new Error('Need a header row and at least one data row.');
  }

  const headers = records[0].map((header, i) => {
    const name = header.trim();
    return name === '' ? `Column ${i + 1}` : name;
  });

  // Duplicate headers would silently merge two columns into one object key.
  const seen = new Map();
  const unique = headers.map((name) => {
    const n = seen.get(name) || 0;
    seen.set(name, n + 1);
    return n === 0 ? name : `${name} (${n + 1})`;
  });

  const width = unique.length;
  const rows = records.slice(1).map((r, i) => {
    if (r.length !== width) {
      throw new Error(`Row ${i + 2} has ${r.length} fields, expected ${width}. Fix the file rather than let the audit guess.`);
    }
    return r; // already trimmed per-field, and only where trimming is safe
  });

  return { headers: unique, rows, delimiter };
}
