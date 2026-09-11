/*
 * ============================================================
 * CSV EXPORT CORE
 * Teras Laundry 1st Anniversary
 *
 * 3.9.2
 *
 * Utility ini hanya menangani:
 * - CSV escaping
 * - CSV header
 * - CSV rows
 *
 * Tidak mengakses D1.
 * Tidak menangani authorization.
 * Tidak menghasilkan raw QR secret.
 * ============================================================
 */

export type CsvCell =
  | string
  | number
  | boolean
  | null
  | undefined;

export function csvEscape(
  value: CsvCell,
): string {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  const text =
    String(value);

  /*
   * RFC-style CSV escaping:
   * - quote menjadi ""
   * - field dibungkus quote jika mengandung
   *   comma, quote, CR, atau LF
   */

  const escaped =
    text.replace(
      /"/g,
      '""',
    );

  if (
    escaped.includes(",") ||
    escaped.includes('"') ||
    escaped.includes("\r") ||
    escaped.includes("\n")
  ) {
    return `"${escaped}"`;
  }

  return escaped;
}

export function buildCsv(
  headers: string[],
  rows: CsvCell[][],
): string {
  const headerLine =
    headers
      .map(csvEscape)
      .join(",");

  const rowLines =
    rows.map(
      (row) =>
        row
          .map(csvEscape)
          .join(","),
    );

  /*
   * CRLF dipakai sebagai line ending CSV
   * untuk kompatibilitas spreadsheet.
   */

  return [
    headerLine,
    ...rowLines,
  ].join("\r\n") +
    "\r\n";
}
