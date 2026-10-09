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
 * Stamp the fields the staff tables sort by onto the documents written
 * before every writer stored them (AGL-3680).
 *
 * A staff table's header sort is the Firestore query's `orderBy`, and an
 * `orderBy` DROPS every document that lacks the field — so a row written
 * before its writer stamped the field would vanish from the list the moment
 * someone sorted by that column. Each writer now stores the field on every
 * write (null or 0 when there is nothing to say); this stamps the rest:
 *
 *   adminAudit                   `scope` null (`withAdminAuditIndex`)
 *   apiIdempotency               `createdAtMs` on an untimed claim, from what
 *                                it carries: its `createdAt` timestamp, else
 *                                its `expiresAt` less the 30-day retention,
 *                                else the document's own create time; `kind`
 *                                and `orgId` null; `scopeId` from a commerce
 *                                refund claim's `hostId`, else null
 *   emailSuppressions            `createdAt` from `suppressedAt` (the date the
 *                                Since column already falls back to); `email`
 *                                and `context` null where none was kept
 *   emailDeliveries/{k}/messages `subject` and `context` null, `openCount` and
 *                                `clickCount` 0 (`email-delivery-log.ts`)
 *
 * Only a MISSING field is written. A field that holds any value — null
 * included — is left as it is, so a second run writes nothing and an
 * interrupted run is finished by the next. Nothing is deleted.
 *
 * ## Running it
 *
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-staff-list-sort-fields.mjs          # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-staff-list-sort-fields.mjs --apply  # write
 *     node tools/scripts/backfill-staff-list-sort-fields.mjs --self-test
 *
 * A self-hosted install runs the same commands against its own project.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { commitAll, connectFirestore, everyDocument } from './lib/firestore-backfill.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')

const args = parseDeployArgs({
  command: 'backfill-staff-list-sort-fields',
  summary:
    'Stamp the fields the staff tables sort by onto documents that predate them. ' +
    'Writes to the live project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
  ],
})

/** `API_IDEMPOTENCY_RETENTION_DAYS` in `@aglyn/aglyn/app-utils/api-idempotency`. */
const CLAIM_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

const has = (data, field) => Object.prototype.hasOwnProperty.call(data ?? {}, field)

/** A Firestore Timestamp, a Date or epoch millis, as millis; null for anything else. */
function millisOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime()
  if (value && typeof value.toMillis === 'function') return value.toMillis()
  return null
}

/** The update that fills the missing fields, or null when none is missing. */
function fill(data, defaults) {
  const update = {}
  for (const [field, value] of Object.entries(defaults)) {
    if (!has(data, field)) update[field] = value
  }
  return Object.keys(update).length ? update : null
}

/** `adminAudit/{id}`. */
export function planAuditRow(data) {
  return fill(data, { scope: null })
}

/**
 * `apiIdempotency/{digest}`. `createTimeMs` is the document's own create
 * time, the last resort for a claim that carries no time of its own.
 */
export function planClaim(data, createTimeMs = null) {
  const update = fill(data, {
    kind: null,
    orgId: null,
    scopeId: typeof data?.hostId === 'string' && data.hostId ? data.hostId : null,
  }) ?? {}
  if (!has(data, 'createdAtMs')) {
    const expires = millisOf(data?.expiresAt)
    const at =
      millisOf(data?.createdAt) ?? (expires === null ? null : expires - CLAIM_RETENTION_MS) ?? createTimeMs
    if (at !== null) update.createdAtMs = at
  }
  return Object.keys(update).length ? update : null
}

/** `emailSuppressions/{key}`. */
export function planSuppression(data) {
  const update = fill(data, { email: null, context: null }) ?? {}
  if (!has(data, 'createdAt') && has(data, 'suppressedAt') && data.suppressedAt) {
    update.createdAt = data.suppressedAt
  }
  return Object.keys(update).length ? update : null
}

/** `emailDeliveries/{key}/messages/{id}`. */
export function planMessage(data) {
  return fill(data, { subject: null, context: null, openCount: 0, clickCount: 0 })
}

/** Whether a document path is a delivery-log message: `emailDeliveries/{key}/messages/{id}`. */
export function isDeliveryMessagePath(path) {
  const segments = String(path ?? '').split('/')
  return segments.length === 4 && segments[0] === 'emailDeliveries' && segments[2] === 'messages'
}

function selfTest() {
  const failures = []
  const check = (name, got, expected) => {
    if (JSON.stringify(got) !== JSON.stringify(expected)) {
      failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`)
    }
  }
  const cases = [
    ['audit: no scope', planAuditRow({ action: 'x' }), { scope: null }],
    ['audit: a scope', planAuditRow({ scope: 'org' }), null],
    ['audit: null scope stays', planAuditRow({ scope: null }), null],
    [
      'claim: current',
      planClaim({ kind: 'k', orgId: null, scopeId: 's', createdAtMs: 5 }),
      null,
    ],
    [
      'claim: commerce refund without a scope',
      planClaim({ kind: 'commerce-refund', orgId: 'o', hostId: 'h1', createdAtMs: 5 }),
      { scopeId: 'h1' },
    ],
    [
      'claim: untimed, from createdAt',
      planClaim({ kind: 'k', orgId: 'o', scopeId: 's', createdAt: new Date(1_000) }),
      { createdAtMs: 1_000 },
    ],
    [
      'claim: untimed, from expiresAt',
      planClaim({ kind: 'k', orgId: 'o', scopeId: 's', expiresAt: new Date(CLAIM_RETENTION_MS + 7) }),
      { createdAtMs: 7 },
    ],
    [
      'claim: untimed, from the create time',
      planClaim({ kind: 'k', orgId: 'o', scopeId: 's' }, 42),
      { createdAtMs: 42 },
    ],
    [
      'claim: nothing at all',
      planClaim({}, null),
      { kind: null, orgId: null, scopeId: null },
    ],
    [
      'suppression: legacy',
      planSuppression({ reason: 'bounce', suppressedAt: 9 }),
      { email: null, context: null, createdAt: 9 },
    ],
    [
      'suppression: current',
      planSuppression({ email: 'a@b.c', context: null, createdAt: 1, suppressedAt: 9 }),
      null,
    ],
    [
      'message: legacy',
      planMessage({ to: 'a@b.c', status: 'sent', firstSeenAtMs: 1 }),
      { subject: null, context: null, openCount: 0, clickCount: 0 },
    ],
    [
      'message: opened, counts kept',
      planMessage({ subject: 's', context: 'invite', openCount: 3, clickCount: 1 }),
      null,
    ],
  ]
  for (const [name, got, expected] of cases) check(name, got, expected)
  const paths = [
    ['emailDeliveries/k1/messages/m1', true],
    ['supportTickets/t1/messages/m1', false],
  ]
  for (const [path, expected] of paths) check(`path ${path}`, isDeliveryMessagePath(path), expected)
  const total = cases.length + paths.length
  for (const failure of failures) console.error(`FAIL ${failure}`)
  console.log(
    failures.length ? `self-test: ${failures.length} of ${total} failed` : `self-test: ${total}/${total} passed`,
  )
  process.exit(failures.length ? 1 : 0)
}

async function main() {
  if (args.selfTest) return selfTest()
  const apply = Boolean(args.apply)
  const db = connectFirestore({ repoRoot: REPO_ROOT, apply })
  const targets = [
    { name: 'adminAudit', ref: db.collection('adminAudit'), plan: (doc) => planAuditRow(doc.data()) },
    {
      name: 'apiIdempotency',
      ref: db.collection('apiIdempotency'),
      plan: (doc) => planClaim(doc.data(), doc.createTime ? doc.createTime.toMillis() : null),
    },
    {
      name: 'emailSuppressions',
      ref: db.collection('emailSuppressions'),
      plan: (doc) => planSuppression(doc.data()),
    },
    {
      name: 'emailDeliveries/*/messages',
      ref: db.collectionGroup('messages'),
      accept: (doc) => isDeliveryMessagePath(doc.ref.path),
      plan: (doc) => planMessage(doc.data()),
    },
  ]
  const writes = []
  for (const target of targets) {
    const totals = { scanned: 0, current: 0, stamp: 0, skipped: 0 }
    const fields = new Map()
    for await (const doc of everyDocument(target.ref)) {
      if (target.accept && !target.accept(doc)) {
        totals.skipped += 1
        continue
      }
      totals.scanned += 1
      const update = target.plan(doc)
      if (!update) {
        totals.current += 1
        continue
      }
      totals.stamp += 1
      for (const field of Object.keys(update)) fields.set(field, (fields.get(field) ?? 0) + 1)
      writes.push({ kind: 'update', ref: doc.ref, value: update })
    }
    console.log(
      `${target.name}: scanned ${totals.scanned}` +
        (totals.skipped ? ` (${totals.skipped} other documents skipped)` : ''),
    )
    console.log(`  already current  ${totals.current}`)
    console.log(`  to stamp         ${totals.stamp}`)
    for (const [field, count] of [...fields].sort()) console.log(`    ${field.padEnd(14)}${count}`)
  }
  if (!apply) {
    console.log(`DRY RUN — ${writes.length} writes planned, NOTHING WAS WRITTEN.`)
    return
  }
  await commitAll(db, writes)
  console.log(`APPLIED — ${writes.length} writes committed.`)
}

await main()
