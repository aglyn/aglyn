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

// Every decision `backfill-org-campaigns.mjs` makes, with no Firestore in it
// (AGL-3273). The script reads, calls `planOrgCampaigns`, prints and writes.
//
// ## Ids never change
//
// A container's id is what every member's `campaignIds` names; a send's id is
// `cid` inside the HMAC of every unsubscribe link it ever sent. Both move
// under the id they had, so nothing that points at them is rewritten and no
// link stops honoring itself.
//
// ## What each document gains on the way up
//
//  - A CONTAINER gains `visibleTo`, the sites it is placed on. By default the
//    site it came from — the campaign was that site's, and an agency's
//    brands must not start seeing each other's campaigns because the storage
//    moved. `orgWide` stamps `['org']` instead, for an org that has asked
//    for its campaigns to span every site. A container that already carries
//    a valid scope keeps it.
//  - A SEND gains `hostId`, the site it is sent as, and `visibleTo` naming
//    that one site. Its `reports/*` documents move with it.
//  - Both record `migratedFromHostId`, so the record of where it lived
//    survives the delete.
//
// ## When the org already holds the id
//
// The live code writes the org path from the moment it deploys, so an id can
// already be there. For a container or a send the ORG copy wins field by
// field and the site copy fills only what it lacks — the org copy is the one
// the product has been writing since. A sequence rollup is a set of
// counters, and the live code only ever increments the org copy, so the two
// are ADDED.
//
// ## What is left alone
//
//  - A send mid-flight under the old code (`status: 'sending'`) with no org
//    copy: a batch is running against the site document right now, and
//    moving it would split its counters across two documents. It is
//    reported and deferred; a re-run after the batch settles moves it.
//  - An id held by two sites of one org: the org path can hold one of them,
//    and choosing would lose the other. Refused, reported, and left where it
//    is for a person to settle. Firestore auto-ids make this a theoretical
//    case for anything a person made, which is exactly why it must not be
//    resolved silently.
//
// ## The one collision that is not a person's
//
// The demo seeder writes the same literal `seed-campaign-1` under every demo
// brand, and a demo org holds several brands. A `seed-` id is a fixture by
// the seeder's own convention (`pruneSeedFixtures` deletes by that prefix),
// and no link carries one: the seeder stamps counters, it never sends. So a
// collision among `seed-` ids is re-keyed `{id}-{hostId}` — the id the seeder
// itself now writes — and tagged `seedHostId`, which is what the seeder's
// org-side prune matches on.

const SCOPE_ORG = 'org'
const HOST_PREFIX = 'host:'
const SEED_PREFIX = 'seed-'

/** Whether a stored `visibleTo` is a usable scope rather than an absent or broken one. */
export function isValidScope(visibleTo) {
  if (!Array.isArray(visibleTo) || visibleTo.length === 0) return false
  return visibleTo.every(
    (token) =>
      token === SCOPE_ORG ||
      (typeof token === 'string' && token.startsWith(HOST_PREFIX) && token.length > HOST_PREFIX.length),
  )
}

/**
 * The org id of a demo brand's seeded send: `{fixtureId}-{hostId}`.
 *
 * Every demo brand seeds the same literal `seed-campaign-1`, and one demo org
 * holds several brands, so on the org the fixture id alone collides. Both the
 * seeder (`seed-demo.mjs`) and the re-key below build the key here, so the id
 * a re-seed writes is the id a migrated fixture already holds.
 */
export function seedSendId(fixtureId, hostId) {
  return `${fixtureId}-${hostId}`
}

/** The archive document id for one moved site document. */
export function archiveIdFor(kind, hostId, id) {
  return `${kind}~${hostId}~${id}`
}

/** `{...site, ...org}`: the org copy wins every field it holds. */
function orgWins(siteData, orgData) {
  return { ...(siteData ?? {}), ...(orgData ?? {}) }
}

/** Two rollups' `byOutcome` counters, summed per outcome. */
export function addOutcomes(a, b) {
  const sum = {}
  for (const source of [a, b]) {
    for (const [key, value] of Object.entries(source ?? {})) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      sum[key] = (sum[key] ?? 0) + value
    }
  }
  return sum
}

/**
 * Rows grouped by the id each will hold on the org, so an id held by two
 * sites is visible as one entry. A colliding `seed-` fixture is re-keyed
 * `{id}-{hostId}` first (see the header); `orgId` on each row is the id it
 * will be written under, `id` stays the one the site copy is deleted by.
 */
function byOrgId(rows) {
  const counts = new Map()
  for (const row of rows) counts.set(row.id, (counts.get(row.id) ?? 0) + 1)
  const grouped = new Map()
  for (const row of rows) {
    const rekey = counts.get(row.id) > 1 && row.id.startsWith(SEED_PREFIX)
    const orgId = rekey ? seedSendId(row.id, row.hostId) : row.id
    const keyed = rekey
      ? { ...row, orgId, data: { ...row.data, seedHostId: row.hostId } }
      : { ...row, orgId }
    if (!grouped.has(orgId)) grouped.set(orgId, [])
    grouped.get(orgId).push(keyed)
  }
  return grouped
}

/** Rows grouped by id, unkeyed: every site's rollup of one container is one rollup. */
function groupById(rows) {
  const grouped = new Map()
  for (const row of rows) {
    if (!grouped.has(row.id)) grouped.set(row.id, [])
    grouped.get(row.id).push(row)
  }
  return grouped
}

/**
 * The plan for one org.
 *
 * @param {object} input
 * @param {{hostId: string, id: string, data: object}[]} input.containers site `emailCampaigns`
 * @param {{hostId: string, id: string, data: object, reports: {id: string, data: object}[]}[]} input.sends site `campaigns`
 * @param {{hostId: string, id: string, data: object}[]} input.sequenceReports site `campaignSequenceReports`
 * @param {Map<string, object>} input.orgContainers org `emailCampaigns` by id
 * @param {Map<string, object>} input.orgSends org `campaigns` by id
 * @param {Map<string, object>} input.orgSequenceReports org `campaignSequenceReports` by id
 * @param {boolean} [input.orgWide] stamp every moved container `['org']`
 * @param {number} input.nowMs
 */
export function planOrgCampaigns(input) {
  const plan = {
    containers: [],
    sends: [],
    sequenceReports: [],
    archives: [],
    deletes: [],
    deferred: [],
    refused: [],
  }
  const {
    containers = [],
    sends = [],
    sequenceReports = [],
    orgContainers = new Map(),
    orgSends = new Map(),
    orgSequenceReports = new Map(),
    orgWide = false,
    nowMs,
  } = input

  for (const [orgDocId, rows] of byOrgId(containers)) {
    if (rows.length > 1) {
      plan.refused.push({ kind: 'container', id: orgDocId, hostIds: rows.map((row) => row.hostId) })
      continue
    }
    const [{ hostId, id, data }] = rows
    const visibleTo = orgWide
      ? [SCOPE_ORG]
      : isValidScope(data.visibleTo)
        ? data.visibleTo
        : [`${HOST_PREFIX}${hostId}`]
    const moved = { ...data, visibleTo, migratedFromHostId: hostId }
    const existing = orgContainers.get(orgDocId)
    plan.containers.push({
      id: orgDocId,
      hostId,
      data: existing ? orgWins(moved, existing) : moved,
      merged: Boolean(existing),
    })
    plan.archives.push({ kind: 'emailCampaigns', hostId, id, data, archivedAtMs: nowMs })
    plan.deletes.push({ kind: 'emailCampaigns', hostId, id })
  }

  for (const [orgDocId, rows] of byOrgId(sends)) {
    if (rows.length > 1) {
      plan.refused.push({ kind: 'send', id: orgDocId, hostIds: rows.map((row) => row.hostId) })
      continue
    }
    const [{ hostId, id, data, reports = [] }] = rows
    const existing = orgSends.get(orgDocId)
    if (data.status === 'sending' && !existing) {
      plan.deferred.push({ kind: 'send', id, hostId, reason: 'sending' })
      continue
    }
    const sentAs = typeof data.hostId === 'string' && data.hostId ? data.hostId : hostId
    const moved = {
      ...data,
      hostId: sentAs,
      visibleTo: [`${HOST_PREFIX}${sentAs}`],
      migratedFromHostId: hostId,
    }
    plan.sends.push({
      id: orgDocId,
      hostId,
      data: existing ? orgWins(moved, existing) : moved,
      merged: Boolean(existing),
      reports,
    })
    plan.archives.push({ kind: 'campaigns', hostId, id, data, archivedAtMs: nowMs })
    for (const report of reports) {
      plan.archives.push({
        kind: 'campaignReports',
        hostId,
        id: `${id}~${report.id}`,
        data: report.data,
        archivedAtMs: nowMs,
      })
      plan.deletes.push({ kind: 'campaignReports', hostId, id, reportId: report.id })
    }
    plan.deletes.push({ kind: 'campaigns', hostId, id })
  }

  for (const [id, rows] of groupById(sequenceReports)) {
    // Two sites crediting one container id is not a collision here: the
    // container is one campaign, and both sites' counters belong to it.
    let byOutcome = orgSequenceReports.get(id)?.byOutcome ?? {}
    for (const row of rows) byOutcome = addOutcomes(byOutcome, row.data?.byOutcome)
    const latest = Math.max(
      0,
      orgSequenceReports.get(id)?.updatedAtMs ?? 0,
      ...rows.map((row) => row.data?.updatedAtMs ?? 0),
    )
    plan.sequenceReports.push({
      id,
      data: { byOutcome, updatedAtMs: latest || nowMs },
      merged: orgSequenceReports.has(id),
    })
    for (const row of rows) {
      plan.archives.push({
        kind: 'campaignSequenceReports',
        hostId: row.hostId,
        id,
        data: row.data,
        archivedAtMs: nowMs,
      })
      plan.deletes.push({ kind: 'campaignSequenceReports', hostId: row.hostId, id })
    }
  }

  return plan
}
