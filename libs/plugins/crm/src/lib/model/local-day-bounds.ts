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
 * The local calendar day a moment falls in, `[start, end)`.
 *
 * The same day `taskDueState` decides "today" on, so a count of tasks due
 * today and the list's "today" chip agree about the same task at 11 p.m.
 *
 * A module of its own (AGL-4047): the CRM glance card, drawn on the console
 * home the moment CRM loads, needs only this, and reading it from
 * `crm-reports.ts` put that module's report tables, about 7 KB, into the
 * bytes CRM costs on load. `crm-reports.ts` re-exports it.
 */
export function localDayBounds(nowMs: number): { start: number; end: number } {
  const now = new Date(nowMs)
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return { start: start.getTime(), end: end.getTime() }
}
