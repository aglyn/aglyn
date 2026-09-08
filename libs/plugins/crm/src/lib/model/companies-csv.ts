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
 * The companies CSV — one file from the table's Export button and the bulk
 * bar's (AGL-2621).
 *
 * The same rule the contacts file follows: the header is the companies
 * IMPORT's own vocabulary — the first alias of every field
 * `guessCompanyImportMapping` reads — so an export re-imports without a
 * hand mapping, and the template the Import drawer hands out IS this header
 * over no rows. The owner is written by ADDRESS, because the import resolves
 * an owner by email and a uid is nothing a spreadsheet can read. The one
 * column the import has no field for, the contacts count, is written last
 * because it is what a merchant reads the file for, and maps to "Do not
 * import" on the way back.
 */

/* The writer moved to `@aglyn/aglyn` under AGL-2662 — see `deals-csv.ts`. */
export {
  COMPANY_CSV_COLUMNS,
  companiesCsv,
  type CompanyCsvOptions,
  type CompanyCsvRow,
} from '@aglyn/aglyn'

import { companiesCsv } from '@aglyn/aglyn'

/**
 * The file the Import drawer hands out to start from: the export's header
 * and nothing under it.
 */
export function companyImportTemplateCsv(): string {
  return companiesCsv([])
}
