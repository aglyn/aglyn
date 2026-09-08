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
 * The leads CSV — one file from the Leads section's Export button and the
 * bulk bar's (AGL-2662).
 *
 * A lead is a capture the CRM has annotated: what the door wrote (the
 * address, the name, every surface that met the person, when, how often)
 * and what the team wrote on top (a status, an owner, a reason, notes).
 * The file carries both. The status is written by its LABEL and an absent
 * one as `New`, the way the list reads it, and the owner by ADDRESS rather
 * than uid, the way every other CRM file writes one. The sources are joined
 * with `|` as the contacts file joins its multi-valued cells.
 *
 * At the organization level the same file gains a `Site` column, because a
 * row there is some site's lead and the file must say which; under a site
 * every row is the site's own and the column is not written.
 *
 * The header is written to READ well rather than to round-trip, and the
 * import (`lead-import-drawer.tsx`) is built to that header rather than the
 * other way round: it maps the columns a file may set — the address, the
 * name, and the team's status, owner, reason and notes — and leaves the
 * capture door's own record (the sources, the two timestamps, the capture
 * count) and the conversion's stamp on "Do not import".
 */

/* The writer moved to `@aglyn/aglyn` under AGL-2662 — see `deals-csv.ts`. */
export {
  LEAD_CSV_COLUMNS,
  leadCsvHeader,
  leadsCsv,
  type LeadCsvOptions,
  type LeadCsvRow,
} from '@aglyn/aglyn'
