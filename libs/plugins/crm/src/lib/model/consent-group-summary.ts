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
 * The CRM's clause of the "Finished a consent group change" activity line
 * (AGL-3320), from the counts its participant reported over the whole change.
 *
 * Its own module, and plain words only, because the declarations register it
 * at boot and answer it synchronously: the participant itself is loaded when
 * a change first runs.
 */
export function summarizeConsentGroupChange(
  counts: Readonly<Record<string, number>>,
): string | null {
  const combined = counts['combined'] ?? 0
  const copied = counts['copied'] ?? 0
  const refusals = counts['refusals'] ?? 0
  const clause = `${combined} CRM ${combined === 1 ? 'record' : 'records'} combined, ${copied} copied`
  return refusals
    ? `${clause}; ${refusals} declined ${refusals === 1 ? 'consent' : 'consents'} copied`
    : clause
}
