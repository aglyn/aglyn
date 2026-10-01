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
 * The line the staff site page prints about the leaving notice (AGL-3452):
 * whether a new free workspace's sites are sending links to other domains
 * through the "You're leaving" page, and until when.
 *
 * Stated either way, so "off" reads as an answer rather than as a fact the
 * page forgot. `until` is the window's end as `/api/admin/sites` read it
 * (`leavingNoticeEndsAt`), or null/undefined when the notice does not apply.
 */
export function staffLeavingNoticeLabel(
  until: number | null | undefined,
  format: (ms: number) => string = (ms) =>
    new Date(ms).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }),
): string {
  return typeof until === 'number' && Number.isFinite(until)
    ? `Leaving notice: on until ${format(until)} — links to other domains open a “You’re leaving” page first`
    : 'Leaving notice: off — links to other domains open directly'
}
