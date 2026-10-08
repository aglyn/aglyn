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

/** Shared shaping for the vendor adapters (AGL-3694). */

/** Integer cents as a decimal amount. */
export const amount = (cents: number | null): number | undefined =>
  typeof cents === 'number' && Number.isFinite(cents) ? Math.round(cents) / 100 : undefined

/** Epoch ms as the whole seconds every vendor's `event_time` takes. */
export const seconds = (ms: number): number => Math.floor(ms / 1000)

/** Drops `undefined` and `null` members, so an absent field is absent rather than `null` at the vendor. */
export function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || entry === null) continue
    if (Array.isArray(entry) && entry.length === 0) continue
    out[key] = entry
  }
  return out as Partial<T>
}
