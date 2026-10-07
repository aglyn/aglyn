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
 * Money helpers for the ledgers (AGL-3614). Integer cents in, integer cents
 * out; the one conversion to a decimal happens at the provider's wire.
 */

/** A whole number of cents, or 0 for anything that is not one. */
export function toCents(value: unknown): number {
  const amount = Math.round(Number(value ?? 0))
  return Number.isFinite(amount) ? amount : 0
}

/**
 * Cents as the decimal both ledgers take: `1234` → `12.34`. A currency with
 * no minor unit is not one commerce sells in today; the order's figures are
 * cents of a two-decimal currency.
 */
export function centsToDecimal(cents: number): number {
  return Math.round(cents) / 100
}

/** A decimal from a ledger back to cents, rounded half away from zero. */
export function decimalToCents(value: unknown): number {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return 0
  return Math.sign(amount) * Math.round(Math.abs(amount) * 100)
}

/**
 * Splits `total` across `weights` in proportion, so the parts always sum to
 * `total` exactly: each part is floored, and the cents left over go to the
 * parts with the largest remainders (ties to the earliest). A weight of 0 or
 * less takes nothing. When every weight is 0 the first part takes it all.
 */
export function allocateCents(total: number, weights: readonly number[]): number[] {
  const parts = weights.map(() => 0)
  if (!weights.length) return parts
  const sign = total < 0 ? -1 : 1
  const amount = Math.abs(Math.round(total))
  const usable = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 0))
  const sum = usable.reduce((acc, weight) => acc + weight, 0)
  if (sum <= 0) {
    parts[0] = sign * amount
    return parts
  }
  const exact = usable.map((weight) => (amount * weight) / sum)
  const floors = exact.map((value) => Math.floor(value))
  let left = amount - floors.reduce((acc, value) => acc + value, 0)
  const order = exact
    .map((value, index) => ({ index, remainder: value - floors[index] }))
    .filter((entry) => usable[entry.index] > 0)
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
  for (const entry of order) {
    if (left <= 0) break
    floors[entry.index] += 1
    left -= 1
  }
  return floors.map((value) => sign * value)
}

/** `usd` → `USD`, and anything that is not three letters → `USD`. */
export function normalizeCurrency(value: unknown): string {
  const code = String(value ?? '').trim().toUpperCase()
  return /^[A-Z]{3}$/.test(code) ? code : 'USD'
}

/** `YYYY-MM-DD` of an instant in a time zone; UTC when the zone is unusable. */
export function dateInZone(ms: number, timeZone: string): string {
  const instant = new Date(Number.isFinite(ms) ? ms : 0)
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(instant)
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
    const date = `${get('year')}-${get('month')}-${get('day')}`
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date
  } catch {
    // An unknown zone: UTC below.
  }
  return instant.toISOString().slice(0, 10)
}

/** Whether a string is a real `YYYY-MM-DD` date. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/** Whether a string names a time zone this runtime knows. */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/** `$1,204.10`, for a log row's label. */
export function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: normalizeCurrency(currency) }).format(
      centsToDecimal(cents),
    )
  } catch {
    return `${centsToDecimal(cents).toFixed(2)} ${normalizeCurrency(currency)}`
  }
}
