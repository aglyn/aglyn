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

// Every DECISION the org-lead backfill makes (AGL-3276), with no Firestore in
// sight so the test can drive them directly. `backfill-org-leads.mjs` reads,
// prints and writes; nothing here touches a database.
//
// ## The fold
//
// A lead's id is `personKey(email)`, so the same address under two sites is
// two documents carrying ONE id. Moving them to `orgs/{orgId}/leads/{id}`
// makes that one row, and the rows have to be merged rather than raced:
//
//  - EARLIEST CREATED WINS the record. Later rows fold in, and their `source`
//    survives as a timeline activity so provenance is not lost to the merge.
//  - `visibleTo` is the UNION of the folded rows' scopes — never widened past
//    the group that already held them, and never `['org']` by default. A
//    missing or empty scope is visible to nobody, and hiding is the
//    recoverable direction.
//  - `capturedByHostIds` is the union: every site that met this person.
//  - Counters add (`submissionCount`), the earliest `firstSeenAtMs` and the
//    latest `lastSeenAtMs` bracket the person, and `sources` unions.
//  - A CLOSED or CONVERTED row beats an open one for `status` and
//    `convertedContactId`: a person converted on one brand is converted, and
//    re-opening them because a sibling's row was newer would put somebody
//    already a contact back in the Leads list.
//  - A marketing basis is carried forward and never cleared, keeping the
//    EARLIEST grant — the one that actually happened.

/**
 * The archive id for one site row, and the id of the note a fold leaves.
 *
 * Named key functions rather than templates at the `.doc()` call, because
 * `check:id-minting` (AGL-3079) refuses a document named by an id the
 * platform did not mint unless the meaning lives in a function — and the
 * meaning here is exactly the point: both are keyed by the pair they
 * describe, so a re-run re-archives the same row instead of minting a second
 * copy of it.
 */
export function archiveIdFor(hostId, leadId) {
  return `leads~${hostId}~${leadId}`
}

export function foldNoteIdFor(leadId, hostId) {
  return `backfill~${leadId}~${hostId}`
}

/** The lead fields that merge by taking the first non-empty value. */
const FIRST_WINS = [
  'email',
  'name',
  'company',
  'jobTitle',
  'phone',
  'website',
  'address',
  'leadSource',
  'ownerUid',
  'notes',
  'unqualifiedReason',
]

/** Closed statuses, in the order that wins a disagreement. */
const CLOSED_STATUSES = ['qualified', 'unqualified']

const asArray = (value) => (Array.isArray(value) ? value.filter((v) => v != null) : [])
const asNumber = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const nonEmpty = (value) =>
  value !== undefined && value !== null && value !== '' &&
  !(Array.isArray(value) && value.length === 0)

/**
 * The order rows fold in: earliest created first, then by site id so two rows
 * created in the same millisecond fold the same way on every run.
 *
 * `createdAt` may be a Timestamp, a number, or absent on a row old enough to
 * predate it — absent sorts LAST, so a row that can prove it is older always
 * wins over one that cannot.
 */
export function foldOrder(rows) {
  const at = (row) => {
    const raw = row.data?.createdAt
    if (typeof raw === 'number') return raw
    if (raw && typeof raw.toMillis === 'function') return raw.toMillis()
    if (raw && typeof raw._seconds === 'number') return raw._seconds * 1000
    return asNumber(row.data?.firstSeenAtMs) ?? Number.MAX_SAFE_INTEGER
  }
  return [...rows].sort((a, b) => at(a) - at(b) || String(a.hostId).localeCompare(String(b.hostId)))
}

/**
 * One org row from the site rows that carry the same person key.
 *
 * @returns `{ id, data, from, activities }` — the merged document, the site
 *   rows it came from (in fold order), and the timeline entries that record
 *   each later row's own capture.
 */
export function foldLeads(personKey, rows, options = {}) {
  const ordered = foldOrder(rows)
  const [first, ...rest] = ordered
  const data = { ...(first.data ?? {}) }

  const visibleTo = new Set(asArray(data.visibleTo))
  const captured = new Set(asArray(data.capturedByHostIds))
  const sources = new Set(asArray(data.sources))
  // A row that names no scope is scoped to the site it was found under: that
  // is what the path meant, and it is the narrowest honest reading of it.
  if (!asArray(first.data?.visibleTo).length) visibleTo.add(`host:${first.hostId}`)
  captured.add(first.hostId)

  let submissionCount = asNumber(data.submissionCount) ?? 0
  let firstSeenAtMs = asNumber(data.firstSeenAtMs)
  let lastSeenAtMs = asNumber(data.lastSeenAtMs)

  const activities = []
  for (const row of rest) {
    const other = row.data ?? {}
    for (const token of asArray(other.visibleTo)) visibleTo.add(token)
    if (!asArray(other.visibleTo).length) visibleTo.add(`host:${row.hostId}`)
    for (const id of asArray(other.capturedByHostIds)) captured.add(id)
    captured.add(row.hostId)
    for (const source of asArray(other.sources)) sources.add(source)

    submissionCount += asNumber(other.submissionCount) ?? 0
    const otherFirst = asNumber(other.firstSeenAtMs)
    const otherLast = asNumber(other.lastSeenAtMs)
    if (otherFirst !== null) firstSeenAtMs = firstSeenAtMs === null ? otherFirst : Math.min(firstSeenAtMs, otherFirst)
    if (otherLast !== null) lastSeenAtMs = lastSeenAtMs === null ? otherLast : Math.max(lastSeenAtMs, otherLast)

    for (const field of FIRST_WINS) {
      if (!nonEmpty(data[field]) && nonEmpty(other[field])) data[field] = other[field]
    }
    for (const [key, value] of Object.entries(other)) {
      // The marketing basis is a map keyed by group; merging key by key keeps
      // each group's own grant rather than letting one row's map replace it.
      if (!key.startsWith('marketingConsent')) continue
      data[key] = mergeConsent(data[key], value)
    }
    if (Array.isArray(other.campaignIds) || Array.isArray(data.campaignIds)) {
      data.campaignIds = [...new Set([...asArray(data.campaignIds), ...asArray(other.campaignIds)])].sort()
    }

    /*
     * CONVERSION AND CLOSURE WIN. A person converted on one brand is
     * converted; taking the survivor's open status because it was created
     * first would put somebody who is already a contact back in the Leads
     * list, and the sequence runtime would enroll them again.
     */
    if (other.convertedContactId && !data.convertedContactId) {
      data.convertedContactId = other.convertedContactId
      if (nonEmpty(other.convertedAtMs)) data.convertedAtMs = other.convertedAtMs
      if (nonEmpty(other.convertedBy)) data.convertedBy = other.convertedBy
    }
    if (CLOSED_STATUSES.includes(other.status) && !CLOSED_STATUSES.includes(data.status)) {
      data.status = other.status
      if (nonEmpty(other.unqualifiedReason)) data.unqualifiedReason = other.unqualifiedReason
    }

    activities.push({
      leadId: personKey,
      hostId: row.hostId,
      kind: 'note',
      atMs: asNumber(other.firstSeenAtMs) ?? options.nowMs ?? 0,
      body:
        `Folded from this site's own lead record when leads moved to the ` +
        `organization (AGL-3276). Captured by ${asArray(other.sources).join(', ') || 'an unrecorded surface'}.`,
    })
  }

  data.visibleTo = [...visibleTo].sort()
  data.capturedByHostIds = [...captured].sort()
  if (sources.size) data.sources = [...sources].sort()
  if (submissionCount) data.submissionCount = submissionCount
  if (firstSeenAtMs !== null) data.firstSeenAtMs = firstSeenAtMs
  if (lastSeenAtMs !== null) data.lastSeenAtMs = lastSeenAtMs
  // Recorded so a later read can tell a folded row from one written live.
  data.migratedFromHostIds = ordered.map((row) => row.hostId).sort()

  return { id: personKey, data, from: ordered, activities }
}

/** The earliest grant of each consent group survives the fold. */
function mergeConsent(mine, theirs) {
  if (!theirs || typeof theirs !== 'object') return mine ?? theirs
  if (!mine || typeof mine !== 'object') return theirs
  const merged = { ...mine }
  for (const [group, entry] of Object.entries(theirs)) {
    const held = merged[group]
    if (!held) {
      merged[group] = entry
      continue
    }
    const heldAt = asNumber(held?.atMs)
    const theirsAt = asNumber(entry?.atMs)
    if (heldAt === null || (theirsAt !== null && theirsAt < heldAt)) merged[group] = entry
  }
  return merged
}

/**
 * Which enrollment survives when the folded rows carry more than one.
 *
 * The one FURTHEST ALONG, and the duplicates are refused — the rule the enroll
 * gate already applies to the same address in one sequence (AGL-3234). Step
 * first, then the earliest due time, so two enrollments on the same step
 * resolve the same way on every run rather than by map order.
 */
export function pickEnrollment(enrollments) {
  const step = (row) => asNumber(row.data?.step) ?? 0
  const due = (row) => asNumber(row.data?.nextDueAtMs) ?? Number.MAX_SAFE_INTEGER
  const ordered = [...enrollments].sort(
    (a, b) => step(b) - step(a) || due(a) - due(b) || String(a.id).localeCompare(String(b.id)),
  )
  return { keep: ordered[0] ?? null, refuse: ordered.slice(1) }
}

/**
 * The whole plan for one org: what to write, what to archive, what to delete.
 *
 * `leadsByKey` is `personKey -> [{ hostId, id, data }]`, every site row found
 * under that key. A key held by ONE site still moves — the row has to leave
 * the host path — but it folds nothing and records no activity.
 */
export function planOrgLeads({ leadsByKey, orgLeadIds = new Set(), nowMs = 0 }) {
  const writes = []
  const archives = []
  const deletes = []
  const folded = []

  for (const [personKey, rows] of [...leadsByKey.entries()].sort()) {
    if (!rows.length) continue
    /*
     * A key the org already holds is left ALONE and its site rows are still
     * archived and deleted. The live code carries a row over on the next
     * write that touches it (`leadForWrite`), so the org row may already be
     * newer than anything here — overwriting it with a fold of the rows it
     * was built from would undo a capture that happened after the promotion.
     */
    if (orgLeadIds.has(personKey)) {
      for (const row of rows) {
        archives.push(row)
        deletes.push(row)
      }
      continue
    }
    const fold = foldLeads(personKey, rows, { nowMs })
    writes.push(fold)
    if (rows.length > 1) folded.push({ personKey, sites: fold.data.migratedFromHostIds })
    for (const row of fold.from) {
      archives.push(row)
      deletes.push(row)
    }
  }

  return { writes, archives, deletes, folded }
}
