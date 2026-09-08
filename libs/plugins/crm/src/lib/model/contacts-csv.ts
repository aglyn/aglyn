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
 * The contacts CSV — every CRM column, the same file from the table's
 * Export button and the bulk bar's (AGL-2603, widened by AGL-2621).
 *
 * The selection's export and the table's export are the same file over a
 * different set of rows: the same columns in the same order, the same `|`
 * between multi-valued cells, the same quoting. A second column list would
 * be a second file format for one feature, and the person opening both in
 * a spreadsheet would be the one to find the difference.
 *
 * ## The header row is the import's own vocabulary
 *
 * Each column is headed by a name `guessContactImportMapping` recognizes —
 * "Job title", "Address line 1", "Lifecycle stage", a custom field's label
 * — so an export re-imports without a hand mapping, and the template the
 * Import drawer offers IS this header over no rows. The owner column
 * carries the member's ADDRESS rather than a uid for the same reason: the
 * import resolves an owner by email, and a uid is nothing a spreadsheet
 * can read anyway. The three columns the import has no field for — sources,
 * the last interaction and the last campaign engagement — are still
 * written, because they are what a merchant reads the file for; they map to
 * "Do not import" on the way back.
 */

/* The writer moved to `@aglyn/aglyn` under AGL-2662 — see `deals-csv.ts`. */
export {
  CONTACT_CSV_COLUMNS,
  contactCsvHeader,
  contactsCsv,
  type ContactCsvOptions,
  type ContactCsvRow,
} from '@aglyn/aglyn'

import { contactsCsv, type ContactCsvOptions } from '@aglyn/aglyn'

/**
 * The file the Import drawer hands out to start from: the export's header
 * and nothing under it, so a sheet filled in against it maps itself.
 */
export function contactImportTemplateCsv(
  customFields: ContactCsvOptions['customFields'] = [],
): string {
  return contactsCsv([], { customFields })
}

/**
 * Hand the browser a file to save.
 *
 * The one writer that stayed: it touches `URL.createObjectURL` and
 * `document`, so it belongs to the browser and not to the library a server
 * route imports.
 */
export function downloadTextFile(name: string, mime: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}
