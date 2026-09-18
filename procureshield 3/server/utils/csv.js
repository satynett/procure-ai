// csv.js
// Small, dependency-free CSV serializer used by the report/export endpoints.

function escapeCell(value) {
  if (value === null || value === undefined) return "";
  const str = Array.isArray(value) ? value.join("; ") : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Convert an array of flat objects into a CSV string.
 * @param {object[]} rows
 * @param {string[]} [columns] optional explicit column order/subset
 */
export function toCsv(rows, columns) {
  if (!rows || rows.length === 0) return "";
  const cols = columns || Object.keys(rows[0]);
  const header = cols.map(escapeCell).join(",");
  const body = rows.map((row) => cols.map((c) => escapeCell(row[c])).join(",")).join("\n");
  return `${header}\n${body}`;
}
