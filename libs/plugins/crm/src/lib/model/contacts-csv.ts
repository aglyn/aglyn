/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * The contacts CSV, as the table's Export button has always written it
 * (AGL-2603).
 *
 * The selection's export and the table's export are the same file over a
 * different set of rows: the same six columns in the same order, the same
 * `|` between multi-valued cells, the same quoting. A second column list
 * would be a second file format for one feature, and the person opening
 * both in a spreadsheet would be the one to find the difference.
 */

/** As much of a projected table row as the file reads. */
export interface ContactCsvRow {
  email?: string
  name?: string
  sources?: Record<string, unknown>
  tags?: string[]
  notes?: string
  interactions?: Array<{ atMs: number }>
}

/** The header row, in the order the table has always emitted it. */
export const CONTACT_CSV_COLUMNS = [
  'email',
  'name',
  'sources',
  'tags',
  'lastInteraction',
  'notes',
] as const

const csvEscape = (value: unknown): string => {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * The lines of a CSV file — header first, one array per row — as text.
 *
 * One serializer for every CSV the CRM writes: the contacts export, and
 * since AGL-2624 each report table's export. Quoting is decided here and
 * nowhere else — a cell holding a comma, a quote or a newline is wrapped in
 * quotes with its quotes doubled, and no other cell is touched — so that a
 * report's file and the contacts file open the same way in a spreadsheet.
 * A `null` or `undefined` cell is empty, not the word.
 */
export function csvDocument(
  lines: ReadonlyArray<ReadonlyArray<unknown>>,
): string {
  return lines.map((line) => line.map(csvEscape).join(',')).join('\n')
}

/** The whole file, header first. */
export function contactsCsv(rows: readonly ContactCsvRow[]): string {
  const lines: unknown[][] = [
    [...CONTACT_CSV_COLUMNS],
    ...rows.map((contact) => [
      contact.email ?? '',
      contact.name ?? '',
      Object.keys(contact.sources ?? {}).join('|'),
      (contact.tags ?? []).join('|'),
      contact.interactions?.[0]
        ? new Date(contact.interactions[0].atMs).toISOString()
        : '',
      contact.notes ?? '',
    ]),
  ]
  return csvDocument(lines)
}

/** Hand the browser a file to save. */
export function downloadTextFile(name: string, mime: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}
