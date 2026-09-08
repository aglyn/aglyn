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
 * The tasks CSV — one file from the section's Export button and the bulk
 * bar's (AGL-2621).
 *
 * A task hangs off a contact, a company or a deal by id; the file names
 * each by the name the list already resolved for the row, so a spreadsheet
 * reads "Acme" and not a document id. The assignee is written by address
 * for the same reason. A due date is an INSTANT — a task due at nine is due
 * at nine in the assignee's zone — so it is written as an ISO timestamp,
 * and a spreadsheet renders it in whatever zone it is opened in.
 */

/* The writer moved to `@aglyn/aglyn` under AGL-2662 — see `deals-csv.ts`. */
export {
  TASK_CSV_COLUMNS,
  tasksCsv,
  type TaskCsvOptions,
  type TaskCsvRow,
} from '@aglyn/aglyn'
