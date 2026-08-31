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
 * ITEM 3, TAXABLE PURCHASES — the one figure on the return nobody can derive.
 *
 * Every other line of the return is summed from records this platform keeps.
 * Item 3 is use tax on AGLYN'S OWN purchases, and `platformRevenue` records
 * sales — so the figure is not in the data and no amount of reading it will
 * produce one. `taxReturnWebfileLines` therefore prints `not computed` rather
 * than `0.00`, on the rule that a zero printed where no figure was derived is
 * a claim the data cannot support.
 *
 * ## Storing an entry does not weaken that rule — it is the same rule
 *
 * **An unentered period still reads `not computed`.** Absence of a record and
 * a record of zero are different facts and must never render alike: the first
 * says nobody has looked, the second says somebody looked and the answer was
 * nothing. `parseTaxablePurchases` refuses an empty field for exactly this
 * reason — a blank box may not become `0.00` by being saved — while an
 * operator who types `0.00` has made a claim, and that claim is stored, shown
 * as entered, and audited like any other.
 *
 * A defaulted zero here would be worse than the gap it fills: today the
 * operator knows the figure is theirs to supply, where a zero arriving from a
 * storage layer would be transcribed into Webfile by somebody who never knew
 * it was never computed.
 *
 * ## Per period, and the period is the key
 *
 * A quarter's purchases are not the next quarter's. The period is the storage
 * key rather than a field inside one shared record, so a figure entered for
 * one quarter cannot be read under another — there is no code path that
 * returns a record whose period differs from the one asked for, because the
 * period is how it was found.
 *
 * Pure: no Firestore, no `process.env`, no clock it does not take as an
 * argument. `utils/server/taxable-purchases-store.ts` is the half that reads
 * and writes.
 */

/** The reason typed for a change. Long enough for a sentence, not an essay. */
export const TAXABLE_PURCHASES_NOTE_MAX = 280

/**
 * A quarter or a month, as both the return route and the period menu accept
 * them. Upper-cased so `2026-q4` and `2026-Q4` cannot become two records
 * holding two different answers for one quarter.
 */
const PERIOD_KEY = /^(\d{4})-(Q[1-4]|0[1-9]|1[0-2])$/

/**
 * The storage key for a period, or `null` when it is not a period at all.
 *
 * Refusing rather than coercing: a key this cannot parse would otherwise
 * become a document id nothing ever reads back, and a figure written to an
 * unreachable key looks exactly like a figure that was never entered.
 */
export function taxablePurchasesPeriodKey(period: unknown): string | null {
  const raw = String(period ?? '').trim().toUpperCase()
  return PERIOD_KEY.test(raw) ? raw : null
}

/** The stored document. `amountCents` is always a real, entered figure. */
export interface StoredTaxablePurchases {
  period: string
  amountCents: number
  /** What the operator said the figure is drawn from. Required on write. */
  note: string
  updatedAtMs?: number | null
  updatedByEmail?: string | null
}

/**
 * The entry as every surface reads it — or `null`, which is `not computed`.
 *
 * `null` is a first-class answer here and the surfaces must render it as the
 * absence it is. There is deliberately no "empty entry" shape with a zero in
 * it: a type that can express "entered nothing" as a number is a type that
 * will eventually print it.
 */
export interface TaxablePurchasesEntry {
  period: string
  amountCents: number
  amountDollars: string
  note: string
  /** ISO, or null on a record written before the stamp existed. */
  enteredAt: string | null
  enteredBy: string | null
}

/**
 * Dollars from cents, as the return states money.
 *
 * Local rather than imported from `tx-return-webfile.ts`: that module imports
 * this one for the payload type, and a cycle between the two would resolve to
 * `undefined` at module scope in exactly one of them.
 */
function dollars(cents: number): string {
  return (cents / 100).toFixed(2)
}

/**
 * The stored record as an entry, or `null` when there is nothing stored.
 *
 * A record whose period disagrees with the one asked for returns `null`. That
 * cannot happen through the store, which keys by period — it is here because
 * the cost of being wrong is a figure from one quarter printed on another
 * quarter's return, and a guard that never fires is the cheapest half of that
 * trade.
 */
export function taxablePurchasesEntry(
  stored: StoredTaxablePurchases | null | undefined,
  period: string,
): TaxablePurchasesEntry | null {
  const key = taxablePurchasesPeriodKey(period)
  if (!stored || !key) return null
  if (taxablePurchasesPeriodKey(stored.period) !== key) return null
  /*
   * An unreadable amount is NOT zero. A record whose figure cannot be read
   * reports as unentered, which prints `not computed` — the honest answer, and
   * the one that keeps somebody from filing a corrupted row as a total.
   *
   * Typed, not coerced, and that is the whole of it: `Number(null)` is `0` and
   * so is `Number('')`, so a `Number.isFinite` check alone turns a row with no
   * figure into a confident `0.00` on a filed return. Only a real number is a
   * real entry.
   */
  const cents = stored.amountCents
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return null
  const rounded = Math.round(cents)
  return {
    period: key,
    amountCents: rounded,
    amountDollars: dollars(rounded),
    note: typeof stored.note === 'string' ? stored.note : '',
    enteredAt:
      typeof stored.updatedAtMs === 'number' && Number.isFinite(stored.updatedAtMs)
        ? new Date(stored.updatedAtMs).toISOString()
        : null,
    enteredBy:
      typeof stored.updatedByEmail === 'string' && stored.updatedByEmail
        ? stored.updatedByEmail
        : null,
  }
}

/** A refusal carries the reason; a success carries cents. */
export type TaxablePurchasesProposal =
  | { error: string; value?: undefined }
  | { error?: undefined; value: { period: string; amountCents: number; note: string } }

/**
 * Validate what an operator typed into Item 3.
 *
 * The amount is taken in DOLLARS, because that is what the return asks for and
 * what the expense records state, and converted here so exactly one place
 * decides how `1,234.5` becomes cents.
 *
 * Refusals, and why each is a refusal rather than a default:
 *
 *   - **An empty amount** is the whole point of this module. A blank box that
 *     saved as `0.00` would print a derived-looking zero on a return, which is
 *     the claim `taxReturnWebfileLines` refuses to make.
 *   - **A negative amount** is not a purchase. Webfile has no line for one,
 *     and clamping it to zero would silently file a different figure than the
 *     one typed.
 *   - **A missing reason**, for the same reason the filing configuration
 *     requires one: the figure alone does not say which expense records it
 *     came from, and a year later that is the only question anyone asks.
 */
export function validateTaxablePurchases(input: {
  period: unknown
  amount: unknown
  note: unknown
}): TaxablePurchasesProposal {
  const period = taxablePurchasesPeriodKey(input.period)
  if (!period) {
    return { error: 'period must be YYYY-Q[1-4] or YYYY-MM' }
  }

  const raw = String(input.amount ?? '').trim().replace(/[$,\s]/g, '')
  if (!raw) {
    return {
      error:
        'Enter the amount from the expense records. A blank field is not ' +
        'zero — an unentered period reports “not computed”, which is the ' +
        'honest answer until somebody derives one.',
    }
  }
  if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) {
    return { error: 'Amount must be dollars and cents — 1234.56' }
  }
  const amountCents = Math.round(Number(raw) * 100)
  if (!Number.isFinite(amountCents)) {
    return { error: 'Amount must be dollars and cents — 1234.56' }
  }
  if (amountCents < 0) {
    return { error: 'Taxable purchases cannot be negative' }
  }

  const note = String(input.note ?? '').trim().slice(0, TAXABLE_PURCHASES_NOTE_MAX)
  if (!note) {
    return {
      error:
        'A reason is required — it is written to the audit log and is the ' +
        'record of where the figure came from',
    }
  }

  return { value: { period, amountCents, note } }
}

/**
 * The document to store.
 *
 * Returned rather than written so the route owns the write and the
 * `adminAudit` row beside it, and so a spec can assert the shape without a
 * Firestore — the same split as `taxFilingConfigWrite`.
 */
export function taxablePurchasesWrite(input: {
  period: string
  amountCents: number
  note: string
  actorEmail?: string | null
  now?: number
}): StoredTaxablePurchases {
  return {
    period: input.period,
    amountCents: Math.round(input.amountCents),
    note: input.note,
    updatedAtMs: input.now ?? Date.now(),
    updatedByEmail: input.actorEmail ?? null,
  }
}

/**
 * What an `adminAudit` row may say about an entry.
 *
 * Unlike the filing configuration's audit shape, the VALUE is recorded here.
 * A purchase total is not a credential — it is a figure that goes onto a
 * public filing — and "the Item 3 figure changed" without saying from what to
 * what would record the event and lose the only thing anyone would come back
 * for.
 */
export function taxablePurchasesAuditShape(
  entry: TaxablePurchasesEntry | null,
): { entered: boolean; amountCents: number | null; note: string | null } {
  return {
    entered: Boolean(entry),
    amountCents: entry ? entry.amountCents : null,
    note: entry ? entry.note : null,
  }
}
