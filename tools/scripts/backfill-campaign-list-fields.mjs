#!/usr/bin/env node
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
 * Stamp the fields the Marketing lists query on onto every email send and
 * campaign written before the lists asked for them (AGL-3321).
 *
 * The Campaigns list, a campaign's emails and the Emails list each serve
 * their filters and search from ONE Firestore query, newest first. A query
 * cannot find a document that lacks the field it filters or orders by, so
 * an older record without these would list nowhere at all:
 *
 *   a SEND (`orgs/{orgId}/campaigns/{id}`)
 *     `createdAtMs`      every list's order;
 *     `subjectTokens`    search and "Subject contains", from `subject`;
 *     `subjectLower`     the Subject header's order (AGL-3680), from `subject`;
 *     `emailCampaignId`  `null` where it names no campaign — a single send,
 *                        which the lists ask for as `== null`;
 *
 *   a CAMPAIGN (`orgs/{orgId}/emailCampaigns/{id}`)
 *     `createdAtMs`      the order;
 *     `nameTokens`       the org hub's search and "Campaign contains";
 *     `nameLower`        a site hub's search, "Campaign starts with".
 *
 * The tokens come from `lib/name-search-tokens.mjs`, the one script-side
 * twin of `libs/aglyn/src/lib/app-utils/name-search.ts`, held to its
 * fixtures by `npm run test:name-search-tokens`. A missing `createdAtMs` is
 * the EARLIEST moment the record itself records — created, drafted,
 * scheduled, sent, canceled — and failing all of those the document's own
 * creation time.
 *
 * It also COUNTS what it cannot fix: sends with no `hostId` (a site hub's
 * lists ask `hostId == {site}`, so these list only on the org hub), sends
 * whose `visibleTo` is not `['host:{hostId}']` (the security rules read a
 * send through either, so the two must agree), and campaigns carrying a
 * legacy `deletedAt` (the list no longer hides them).
 *
 * ## Idempotence and interruption
 *
 * A record whose fields already match is never written, so a re-run is a
 * no-op and an interrupted run is finished by the next. Writes touch only
 * the fields above, in batches of 400. Nothing is deleted. Only
 * `orgs/*` collections are touched; a leftover `hosts/*` one is counted and
 * left alone.
 *
 * ## Running it
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-campaign-list-fields.mjs          # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-campaign-list-fields.mjs --apply  # write
 *     node tools/scripts/backfill-campaign-list-fields.mjs --self-test                             # no project
 *
 * A self-hosted install runs the same commands against its own project.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { BATCH_OPERATIONS, connectFirestore } from './lib/firestore-backfill.mjs'
import {
  nameSearchKey,
  nameSearchTokens,
  sameSearchTokens,
} from './lib/name-search-tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const COMMAND = 'backfill-campaign-list-fields'

/** Documents read per page of the scan. */
const PAGE = 1000

/** A stored moment as epoch milliseconds, or null. */
export function millisOf(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null
  if (value && typeof value === 'object') {
    if (typeof value.toMillis === 'function') return value.toMillis()
    const seconds = value.seconds ?? value._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return null
}

/** The earliest of the moments a record carries, or null. */
function earliest(values) {
  const found = values.map(millisOf).filter((ms) => ms !== null)
  return found.length ? Math.min(...found) : null
}

/** A path is `orgs/{orgId}/{collection}/{id}`. */
const isOrgRecord = (path, collection) => {
  const segments = path.split('/')
  return segments.length === 4 && segments[0] === 'orgs' && segments[2] === collection
}

/**
 * What a SEND should be stamped with, or a skip. Pure, for the self-test.
 *
 * @param {string} path
 * @param {Record<string, unknown>} data
 * @param {number | null} createTimeMs the document's own creation time
 * @returns {{ update: Record<string, unknown> } | { skip: 'current' | 'not-an-org-send' }}
 */
export function planSend(path, data, createTimeMs) {
  if (!isOrgRecord(path, 'campaigns')) return { skip: 'not-an-org-send' }
  const update = {}
  if (millisOf(data.createdAtMs) === null || typeof data.createdAtMs !== 'number') {
    const at =
      earliest([data.createdAt, data.draftedAt, data.scheduledAt, data.sentAt, data.lastSentAt, data.canceledAt]) ??
      millisOf(data.sendAtMs) ??
      millisOf(createTimeMs)
    if (at !== null) update.createdAtMs = at
  }
  const tokens = nameSearchTokens(data.subject)
  if (!sameSearchTokens(data.subjectTokens, tokens)) update.subjectTokens = tokens
  const subjectKey = nameSearchKey(data.subject)
  if (data.subjectLower !== subjectKey) update.subjectLower = subjectKey
  const container = data.emailCampaignId
  if (container === undefined || container === '') update.emailCampaignId = null
  return Object.keys(update).length ? { update } : { skip: 'current' }
}

/**
 * What a CAMPAIGN should be stamped with, or a skip.
 *
 * @param {string} path
 * @param {Record<string, unknown>} data
 * @param {number | null} createTimeMs
 * @returns {{ update: Record<string, unknown> } | { skip: 'current' | 'not-an-org-campaign' }}
 */
export function planContainer(path, data, createTimeMs) {
  if (!isOrgRecord(path, 'emailCampaigns')) return { skip: 'not-an-org-campaign' }
  const update = {}
  if (typeof data.createdAtMs !== 'number' || millisOf(data.createdAtMs) === null) {
    const at = earliest([data.createdAt]) ?? millisOf(createTimeMs)
    if (at !== null) update.createdAtMs = at
  }
  const key = nameSearchKey(data.name)
  if (data.nameLower !== key) update.nameLower = key
  const tokens = nameSearchTokens(data.name)
  if (!sameSearchTokens(data.nameTokens, tokens)) update.nameTokens = tokens
  return Object.keys(update).length ? { update } : { skip: 'current' }
}

function selfTest() {
  let failed = 0
  let total = 0
  const check = (name, ok) => {
    total += 1
    if (!ok) {
      failed += 1
      console.error(`FAIL ${name}`)
    }
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const SEND = 'orgs/o1/campaigns/s1'
  const CAMPAIGN = 'orgs/o1/emailCampaigns/c1'
  const sent = { seconds: 1_700_000_000 }
  const drafted = { seconds: 1_600_000_000 }
  const sendCases = [
    [
      'a sent send from before the fields',
      { subject: 'Spring Sale', status: 'sent', sentAt: sent },
      { update: { createdAtMs: 1_700_000_000_000, subjectTokens: nameSearchTokens('Spring Sale'), subjectLower: 'spring sale', emailCampaignId: null } },
    ],
    [
      'a draft dates from its earliest moment, not its send time',
      { subject: 'Hi', emailCampaignId: 'c1', draftedAt: drafted, sentAt: sent, sendAtMs: 1_800_000_000_000 },
      { update: { createdAtMs: 1_600_000_000_000, subjectTokens: nameSearchTokens('Hi'), subjectLower: 'hi' } },
    ],
    [
      'a scheduled send with nothing but its due time',
      { subject: '', emailCampaignId: null, status: 'scheduled', sendAtMs: 1_800_000_000_000 },
      { update: { createdAtMs: 1_800_000_000_000, subjectTokens: [], subjectLower: '' } },
    ],
    [
      'no moment at all falls back to the document',
      { subject: 'X', emailCampaignId: null, subjectTokens: nameSearchTokens('X') },
      { update: { createdAtMs: 1_234, subjectLower: 'x' } },
    ],
    [
      'a current send',
      { subject: 'Hello there', subjectTokens: nameSearchTokens('Hello there'), subjectLower: 'hello there', emailCampaignId: 'c1', createdAtMs: 5 },
      { skip: 'current' },
    ],
    [
      'an empty-string container is a single send',
      { subject: 'A', subjectTokens: ['a'], subjectLower: 'a', emailCampaignId: '', createdAtMs: 5 },
      { update: { emailCampaignId: null } },
    ],
  ]
  for (const [name, data, expected] of sendCases) {
    const got = planSend(SEND, data, 1_234)
    check(`send, ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`, same(got, expected))
    const stamped = 'update' in got ? { ...data, ...got.update } : data
    check(`send, ${name}: re-run is a no-op`, 'skip' in planSend(SEND, stamped, 1_234))
  }
  check('a site send is left alone', same(planSend('hosts/h1/campaigns/s1', {}, 1), { skip: 'not-an-org-send' }))
  check('a send report is left alone', same(planSend('orgs/o1/campaigns/s1/reports/links', {}, 1), { skip: 'not-an-org-send' }))

  const containerCases = [
    [
      'a campaign from before the fields',
      { name: '  Spring   Launch ', visibleTo: ['org', 'host:h1'], createdAtMs: 9 },
      { update: { nameLower: 'spring launch', nameTokens: nameSearchTokens('Spring Launch') } },
    ],
    [
      'no createdAtMs takes the document time',
      { name: '', visibleTo: ['org'], nameLower: '', nameTokens: [] },
      { update: { createdAtMs: 1_234 } },
    ],
    [
      'renamed since its keys were stamped',
      { name: 'Fall', createdAtMs: 9, nameLower: 'spring', nameTokens: nameSearchTokens('Fall') },
      { update: { nameLower: 'fall' } },
    ],
  ]
  for (const [name, data, expected] of containerCases) {
    const got = planContainer(CAMPAIGN, data, 1_234)
    check(`campaign, ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`, same(got, expected))
    const stamped = 'update' in got ? { ...data, ...got.update } : data
    check(`campaign, ${name}: re-run is a no-op`, 'skip' in planContainer(CAMPAIGN, stamped, 1_234))
  }
  check('a site campaign is left alone', same(planContainer('hosts/h1/emailCampaigns/c1', {}, 1), { skip: 'not-an-org-campaign' }))

  console.log(failed ? `self-test: ${failed} of ${total} failed` : `self-test: ${total}/${total} passed`)
  process.exit(failed ? 1 : 0)
}

/** Walk one collection group, planning and (with --apply) writing each record. */
async function sweep(firestore, group, plan, counts, notice, apply) {
  let cursor = null
  let batch = firestore.batch()
  let pending = 0
  for (;;) {
    let page = firestore.collectionGroup(group).orderBy('__name__').limit(PAGE)
    if (cursor) page = page.startAfter(cursor)
    const snapshot = await page.get()
    if (snapshot.empty) break
    for (const doc of snapshot.docs) {
      const data = doc.data()
      const result = plan(doc.ref.path, data, doc.createTime ? doc.createTime.toMillis() : null)
      if (result.skip && result.skip !== 'current') {
        counts.other += 1
        continue
      }
      counts.scanned += 1
      notice(data, counts)
      if (result.skip) {
        counts.current += 1
        continue
      }
      counts.stamp += 1
      for (const field of Object.keys(result.update)) counts.fields[field] = (counts.fields[field] ?? 0) + 1
      if (!apply) continue
      batch.update(doc.ref, result.update)
      pending += 1
      if (pending >= BATCH_OPERATIONS) {
        await batch.commit()
        counts.written += pending
        batch = firestore.batch()
        pending = 0
      }
    }
    cursor = snapshot.docs[snapshot.docs.length - 1]
    if (snapshot.size < PAGE) break
  }
  if (apply && pending) {
    await batch.commit()
    counts.written += pending
  }
}

const emptyCounts = () => ({
  scanned: 0,
  current: 0,
  stamp: 0,
  other: 0,
  written: 0,
  fields: {},
  flagged: 0,
  disagree: 0,
})

function report(label, counts, flagged, apply) {
  console.log(`${label}`)
  console.log(`  scanned                 ${counts.scanned}`)
  console.log(`  already current         ${counts.current}`)
  console.log(`  to stamp                ${counts.stamp}`)
  for (const [field, count] of Object.entries(counts.fields)) {
    console.log(`    ${field.padEnd(22)}${count}`)
  }
  console.log(`  ${flagged.padEnd(26)}${counts.flagged}`)
  console.log(`  outside orgs/* (left alone) ${counts.other}`)
  if (apply) console.log(`  written                 ${counts.written}`)
}

async function main() {
  const args = parseDeployArgs({
    command: COMMAND,
    summary:
      'Stamp createdAtMs, subjectTokens, subjectLower and a null emailCampaignId onto email sends, and ' +
      'createdAtMs, nameLower and nameTokens onto campaigns, written before the ' +
      'Marketing lists queried them. Writes to the live project with --apply.',
    effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
    flags: [
      { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
      { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
    ],
  })
  if (args.selfTest) return selfTest()
  const apply = Boolean(args.apply)
  const firestore = connectFirestore({ repoRoot: join(here, '..', '..'), apply })
  const sends = emptyCounts()
  await sweep(firestore, 'campaigns', planSend, sends, (data, counts) => {
    if (typeof data.hostId !== 'string' || !data.hostId) {
      counts.flagged += 1
      return
    }
    const scope = Array.isArray(data.visibleTo) ? data.visibleTo : []
    if (scope.length !== 1 || scope[0] !== `host:${data.hostId}`) counts.disagree += 1
  }, apply)
  const campaigns = emptyCounts()
  await sweep(firestore, 'emailCampaigns', planContainer, campaigns, (data, counts) => {
    if (data.deletedAt != null) counts.flagged += 1
  }, apply)
  console.log(apply ? `${COMMAND}: APPLIED` : `${COMMAND}: DRY RUN (nothing written)`)
  report('email sends (orgs/*/campaigns)', sends, 'no hostId (org hub only)', apply)
  console.log(`  ${'visibleTo is not its host'.padEnd(26)}${sends.disagree}`)
  report('campaigns (orgs/*/emailCampaigns)', campaigns, 'legacy deletedAt', apply)
}

await main()
