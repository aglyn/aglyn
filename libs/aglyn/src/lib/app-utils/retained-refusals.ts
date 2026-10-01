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
 * RETAINED REFUSALS — a person's "no" outlives the record it was written on
 * (AGL-3338).
 *
 * ## Where a refusal lives, and why that is not enough
 *
 * A person's refusal of marketing email is stored on the record an operator
 * keeps about them: an entry under {@link MARKETING_CONSENT_BY_HOST_FIELD}
 * for the site they refused, or the top-level field for a refusal that names
 * no site. The list gate reads it there. An operator adding people to a list
 * by hand or by import states that they have permission to email them, and a
 * stored refusal is the one fact that attestation cannot overrule: the
 * person said no, and no operator's word turns that into a yes.
 *
 * The record, though, is the operator's, and the operator may delete it. A
 * deleted record is an address with no record at all, which reads as
 * `unrecorded` — nothing known either way — and the attestation is accepted.
 * Deleting somebody from a CRM would then be the way to mail a person who
 * refused, which is the one outcome the refusal exists to prevent.
 *
 * So a refusal is not the record's to lose. When a holder lets a shared
 * record go, its refusal entries stay on the document for the holders that
 * remain. When the last holder lets go, every refusal the document holds —
 * every site's, not only the deleting holder's, and the unscoped one — is
 * copied into {@link RETAINED_REFUSALS_COLLECTION} in the same transaction
 * that deletes it, and the list gate reads that store beside the records.
 *
 * ## No address
 *
 * One document per person, keyed by `personKey` — the sha256 of the
 * normalized address — and holding no address, as a suppression row keyed
 * the same way holds none. The store answers one question about an address
 * somebody already has in hand, "did this person refuse", and it has no
 * business being a list of the people who did.
 *
 * ## The same field names as the record
 *
 * An entry keeps the record's own names, so a record merged with what was
 * retained ({@link withRetainedRefusals}) is read by `readMarketingBasis`
 * like any other — a second set of names would be a second parser for the
 * two to disagree through. Each entry adds when it was retained and from
 * which record.
 *
 * ## A newer grant wins, and nothing else does
 *
 * The person may come back. Signing up again on a form that asks writes a
 * grant, and a grant given after the refusal is the person changing their
 * mind — the merge lets it stand. A grant that is not strictly newer, a grant
 * with no date, and every entry that is not a grant read as the refusal
 * still: withholding mail is recoverable, and sending it is not.
 *
 * ## Carried like the refusals it came from
 *
 * The list gate reads a refusal across the CURRENT consent group, so two
 * sites separating would stop one seeing the other's retained refusals. A
 * consent group change therefore carries this store as it carries the site
 * suppression lists and a record's own refusals: {@link retainedRefusalCarry}
 * decides one document, and the executor pages the store.
 */

import {
  MARKETING_CONSENT_BY_HOST_FIELD,
  MARKETING_CONSENT_FIELD,
} from './marketing-consent'

/** `orgs/{orgId}/retainedRefusals/{personKey}` — server-only, closed to every client. */
export const RETAINED_REFUSALS_COLLECTION = 'retainedRefusals'

/** When a refusal was retained, epoch ms: on each entry and on the document. */
export const RETAINED_AT_FIELD = 'retainedAtMs'

/** The record an entry was retained from, on each entry. */
export const RETAINED_FROM_RECORD_FIELD = 'retainedFromContactId'

/** When the person gave the answer an entry records, as every writer stamps it. */
const GIVEN_AT_FIELD = 'marketingConsentAtMs'

/** Every refusal one person's record holds. */
export interface RetainedRefusals {
  /** Each site's refusal entry, keyed by the site, as the record stored it. */
  byHost: Record<string, Record<string, unknown>>
  /** The top-level refusal, which names no site and is honored against every one. */
  unscoped: boolean
}

type Doc = Record<string, unknown>

function mapOf(value: unknown): Doc | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Doc) : null
}

/** Epoch millis off a number, a `Date` or either SDK's `Timestamp`, else `null`. */
function millisOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value instanceof Date) return value.getTime()
  const toMillis = (value as { toMillis?: unknown } | null)?.toMillis
  if (typeof toMillis === 'function') {
    const millis = Number(toMillis.call(value))
    return Number.isFinite(millis) ? millis : null
  }
  return null
}

/**
 * Every refusal `record` holds, or `null` when it holds none.
 *
 * Every SITE, not the sites of one group: a record can carry a refusal for a
 * site that let it go earlier, or one a consent group change carried onto
 * it, and each is still somebody's "no". Reads a retained document as well
 * as a person record, since the two share their field names.
 */
export function refusalsOf(record: Doc | null | undefined): RetainedRefusals | null {
  if (!record) return null
  const byHost: Record<string, Doc> = {}
  for (const [hostId, value] of Object.entries(mapOf(record[MARKETING_CONSENT_BY_HOST_FIELD]) ?? {})) {
    const entry = mapOf(value)
    if (hostId && entry?.[MARKETING_CONSENT_FIELD] === false) byHost[hostId] = { ...entry }
  }
  const unscoped = record[MARKETING_CONSENT_FIELD] === false
  return unscoped || Object.keys(byHost).length ? { byHost, unscoped } : null
}

/** When a retained refusal counts as given: the person's own date, else the retention's. */
function refusedAtMs(refusal: Doc): number | null {
  return millisOf(refusal[GIVEN_AT_FIELD]) ?? millisOf(refusal[RETAINED_AT_FIELD])
}

/**
 * `record` with what was retained for the same person laid over it — the
 * record a reader of the stored basis should read.
 *
 * Per retained site, the record's entry stands only when it is a GRANT whose
 * date is strictly after the refusal's (the person's own date, or when it was
 * retained where they gave none). Anything else — no entry, a refusal of its
 * own, an older or undated grant — reads as the retained refusal. The
 * unscoped refusal is laid on only where the record gives no top-level
 * answer of its own.
 *
 * With nothing retained the record comes back as it was, `null` included, so
 * a person with no retained refusal reads exactly as they did before this
 * store existed.
 */
export function withRetainedRefusals(
  record: Doc | null | undefined,
  retained: RetainedRefusals | null | undefined,
): Doc | null {
  const hosts = Object.entries(retained?.byHost ?? {})
  if (!retained || (!hosts.length && !retained.unscoped)) return record ?? null
  const base = record ?? {}
  const byHost: Doc = { ...(mapOf(base[MARKETING_CONSENT_BY_HOST_FIELD]) ?? {}) }
  for (const [hostId, refusal] of hosts) {
    const entry = mapOf(byHost[hostId])
    const grantedAt = entry?.[MARKETING_CONSENT_FIELD] === true ? millisOf(entry[GIVEN_AT_FIELD]) : null
    const refusedAt = refusedAtMs(refusal)
    const newerGrant = grantedAt !== null && refusedAt !== null && grantedAt > refusedAt
    if (!newerGrant) byHost[hostId] = refusal
  }
  const merged: Doc = { ...base, [MARKETING_CONSENT_BY_HOST_FIELD]: byHost }
  if (retained.unscoped && typeof base[MARKETING_CONSENT_FIELD] !== 'boolean') {
    merged[MARKETING_CONSENT_FIELD] = false
  }
  return merged
}

/**
 * The entries one retention writes: each refusal stamped with when it was
 * retained and from which record, keyed by site.
 */
export function retainedEntries(
  retained: RetainedRefusals,
  recordId: string,
  nowMs: number,
): Record<string, Doc> {
  return Object.fromEntries(
    Object.entries(retained.byHost).map(([hostId, refusal]) => [
      hostId,
      { ...refusal, [RETAINED_AT_FIELD]: nowMs, [RETAINED_FROM_RECORD_FIELD]: recordId },
    ]),
  )
}

/**
 * One retained document's share of a consent group change's carry `to ← from`
 * — the dotted-path patch that gives `to` the refusal `from` holds, or `null`
 * when `from` holds none or `to` already has an entry.
 *
 * Never overwrites: every entry in this store is a refusal, so an entry on
 * `to` is already the answer, and a re-run after a crash writes nothing.
 */
export function retainedRefusalCarry(
  retained: Doc | null | undefined,
  carry: { toHostId: string; fromHostId: string },
  changeId: string,
): Doc | null {
  const byHost = mapOf(retained?.[MARKETING_CONSENT_BY_HOST_FIELD]) ?? {}
  const source = mapOf(byHost[carry.fromHostId])
  if (source?.[MARKETING_CONSENT_FIELD] !== false) return null
  if (byHost[carry.toHostId] !== undefined) return null
  return {
    [`${MARKETING_CONSENT_BY_HOST_FIELD}.${carry.toHostId}`]: {
      ...source,
      carriedFromHostId: carry.fromHostId,
      carriedByChangeId: changeId,
    },
  }
}
