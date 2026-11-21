/**
 * src/modules/vocab/csv.ts — small CSV codec for vocabulary export and import
 *
 * Description:
 *   RFC 4180 CSV without a dependency (owner, T27): fields with commas,
 *   quotes, or line breaks are quoted, quotes doubled; parsing accepts CRLF or
 *   LF, quoted line breaks, and a leading UTF-8 BOM. Exports start with a BOM
 *   so spreadsheet apps read Korean text as UTF-8.
 *
 * Layer: modules/ (vocab)
 * Dependencies: none. Used by: ./vocabManager.ts.
 * Status: implemented (T40). Tests: csv.test.ts.
 */

const BOM = "\uFEFF";

function quote(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
}

/** Rows to CSV text (CRLF line ends, leading BOM). */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return BOM + rows.map((r) => r.map(quote).join(",")).join("\r\n") + "\r\n";
}

/** CSV text to rows; throws on an unterminated quoted field. */
export function parseCsv(text: string): string[][] {
  const s = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i] as string;
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else field += c;
      i++;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (c === "\r" && s[i + 1] === "\n") i++;
    } else field += c;
    i++;
  }
  if (quoted) throw new SyntaxError("unterminated quoted CSV field");
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}
