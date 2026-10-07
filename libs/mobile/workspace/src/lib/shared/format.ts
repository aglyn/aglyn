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

/** Milliseconds from a Firestore Timestamp, a REST-shaped one, a Date or a number; null otherwise. */
export function millisOf(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value instanceof Date) return value.getTime()
  const stamp = value as { toMillis?: () => number; seconds?: number }
  if (typeof stamp.toMillis === 'function') return stamp.toMillis()
  if (typeof stamp.seconds === 'number') return stamp.seconds * 1000
  return null
}

/** `Oct 6, 2026`, or null for a value that is not a time. */
export function formatDay(value: unknown): string | null {
  const ms = millisOf(value)
  if (ms == null) return null
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** `1.2 MB`, `340 KB`, `812 B`. */
export function formatBytes(bytes: unknown): string | null {
  const value = typeof bytes === 'number' ? bytes : Number(bytes)
  if (!Number.isFinite(value) || value < 0) return null
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/** `Editor`, from `editor`. */
export function titleCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value
}
