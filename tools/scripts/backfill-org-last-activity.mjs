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
 * Seed `orgs/{orgId}.lastActivityAt` on every organization written before it
 * was stamped — and, run without `--write`, report how many carry it.
 *
 * The staff Organizations list sorts by Last activity with a Firestore
 * `orderBy`, which DROPS every organization that lacks the field. New
 * organizations get it at creation (`createOrganization`) and from then on
 * from `/api/orgs/last-activity` whenever a member uses the console in them;
 * this fills the rest, so that sorting by the column hides nobody.
 *
 * ## The seed
 *
 * The best evidence the platform already holds, per organization: the latest
 * Firebase Auth `lastSignInTime` / `lastRefreshTime` of any of its members
 * (the same "last seen" the staff Users list shows as Last activity), never
 * earlier than the organization's own `createdAt`. That is an UPPER bound on
 * the truth for a member of several workspaces — Auth does not say which one
 * they were in — and the first real stamp replaces it within 15 minutes of
 * anyone using the workspace. With no member found in Auth (an SSO pool, an
 * erased account) the seed is `createdAt`, then the document's create time.
 *
 * Only a MISSING field is written; a stamped organization is left alone, so a
 * second run writes nothing and an interrupted run is finished by the next.
 *
 * ## Running it
 *
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-org-last-activity.mjs          # report (dry run)
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-org-last-activity.mjs --write  # write
 *     node tools/scripts/backfill-org-last-activity.mjs --self-test
 *
 * Re-run it (it converges to 0) after the promotion that carries the stamp,
 * since an organization created by the old code in between lacks the field.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAuth } from 'firebase-admin/auth'
import { Timestamp } from 'firebase-admin/firestore'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { commitAll, connectFirestore, everyDocument } from './lib/firestore-backfill.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')

const args = parseDeployArgs({
  command: 'backfill-org-last-activity',
  summary:
    'Report, and with --write seed, orgs/{orgId}.lastActivityAt on organizations that lack it.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--write', key: 'write', describe: 'Write. Without it, a read-only report.' },
    { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
  ],
})

/** The stored field. `ORG_LAST_ACTIVITY_PATH` in `apps/console/utils/org-list-query.ts`. */
export const FIELD = 'lastActivityAt'

/** How many uids one `getUsers` call takes. */
const AUTH_LOOKUP_BATCH = 100

/** A Firestore Timestamp, a Date or epoch millis, as millis; null for anything else. */
export function millisOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime()
  if (value && typeof value.toMillis === 'function') return value.toMillis()
  return null
}

/** An Auth record's last-seen: the later of its last sign-in and last refresh, or 0. */
export function authLastSeenMs(metadata) {
  const signIn = Date.parse(metadata?.lastSignInTime ?? '') || 0
  const refresh = Date.parse(metadata?.lastRefreshTime ?? '') || 0
  return Math.max(signIn, refresh)
}

/**
 * The seed for one organization, or null when it already carries the field.
 * `memberSeenMs` is each member's Auth last-seen (0 when unknown).
 */
export function planOrgSeed(data, memberSeenMs, createTimeMs = null) {
  if (data && Object.prototype.hasOwnProperty.call(data, FIELD) && data[FIELD] != null) return null
  const created = millisOf(data?.createdAt) ?? createTimeMs
  const seen = Math.max(0, ...memberSeenMs.filter((ms) => Number.isFinite(ms)))
  if (seen > 0) {
    return { at: created !== null ? Math.max(seen, created) : seen, source: 'member sign-in' }
  }
  if (created !== null) return { at: created, source: 'created' }
  return null
}

function selfTest() {
  const failures = []
  const check = (name, got, expected) => {
    if (JSON.stringify(got) !== JSON.stringify(expected)) {
      failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`)
    }
  }
  const cases = [
    ['stamped: left alone', planOrgSeed({ [FIELD]: new Date(5), createdAt: 1 }, [9]), null],
    ['members seen: the latest', planOrgSeed({ createdAt: 1 }, [5, 9, 0]), { at: 9, source: 'member sign-in' }],
    ['never earlier than created', planOrgSeed({ createdAt: 20 }, [9]), { at: 20, source: 'member sign-in' }],
    ['no member found: created', planOrgSeed({ createdAt: 7 }, [0, 0]), { at: 7, source: 'created' }],
    ['no members, no createdAt: create time', planOrgSeed({}, [], 3), { at: 3, source: 'created' }],
    ['nothing at all', planOrgSeed({}, [], null), null],
    ['a null field is missing', planOrgSeed({ [FIELD]: null, createdAt: 2 }, []), { at: 2, source: 'created' }],
    [
      'auth last-seen: the later of the two',
      authLastSeenMs({
        lastSignInTime: 'Thu, 01 Oct 2026 00:00:00 GMT',
        lastRefreshTime: 'Fri, 02 Oct 2026 00:00:00 GMT',
      }),
      Date.parse('2026-10-02T00:00:00Z'),
    ],
    ['auth last-seen: never signed in', authLastSeenMs({}), 0],
  ]
  for (const [name, got, expected] of cases) check(name, got, expected)
  for (const failure of failures) console.error(`FAIL ${failure}`)
  console.log(
    failures.length
      ? `self-test: ${failures.length} of ${cases.length} failed`
      : `self-test: ${cases.length}/${cases.length} passed`,
  )
  process.exit(failures.length ? 1 : 0)
}

/** Every uid's Auth last-seen, looked up in batches; 0 for a uid Auth does not hold. */
async function authLastSeenByUid(uids) {
  const seen = new Map(uids.map((uid) => [uid, 0]))
  const list = [...seen.keys()]
  for (let start = 0; start < list.length; start += AUTH_LOOKUP_BATCH) {
    const batch = list.slice(start, start + AUTH_LOOKUP_BATCH).map((uid) => ({ uid }))
    const { users } = await getAuth().getUsers(batch)
    for (const user of users) seen.set(user.uid, authLastSeenMs(user.metadata))
  }
  return seen
}

async function main() {
  if (args.selfTest) return selfTest()
  const write = Boolean(args.write)
  const db = connectFirestore({ repoRoot: REPO_ROOT, apply: write })
  const orgs = []
  for await (const snapshot of everyDocument(db.collection('orgs'))) {
    const members = []
    for await (const member of everyDocument(snapshot.ref.collection('members'))) {
      members.push(member.id)
    }
    orgs.push({ snapshot, members })
  }
  const seen = await authLastSeenByUid([...new Set(orgs.flatMap((org) => org.members))])
  const totals = { scanned: orgs.length, stamped: 0, seedMembers: 0, seedCreated: 0, unseedable: 0 }
  const writes = []
  for (const { snapshot, members } of orgs) {
    const data = snapshot.data() ?? {}
    if (data[FIELD] != null) {
      totals.stamped += 1
      continue
    }
    const seed = planOrgSeed(
      data,
      members.map((uid) => seen.get(uid) ?? 0),
      snapshot.createTime ? snapshot.createTime.toMillis() : null,
    )
    if (!seed) {
      totals.unseedable += 1
      continue
    }
    if (seed.source === 'created') totals.seedCreated += 1
    else totals.seedMembers += 1
    writes.push({ kind: 'update', ref: snapshot.ref, value: { [FIELD]: Timestamp.fromMillis(seed.at) } })
  }
  const pct = totals.scanned ? Math.round((totals.stamped / totals.scanned) * 100) : 100
  console.log(`orgs: scanned ${totals.scanned}`)
  console.log(`  ${`carry ${FIELD}`.padEnd(21)}${totals.stamped} (${pct}%)`)
  console.log(`  to seed from members ${totals.seedMembers}`)
  console.log(`  to seed from created ${totals.seedCreated}`)
  console.log(`  cannot seed          ${totals.unseedable}`)
  if (!write) {
    console.log(`DRY RUN — ${writes.length} writes planned, NOTHING WAS WRITTEN.`)
    return
  }
  await commitAll(db, writes)
  console.log(`WRITTEN — ${writes.length} organizations seeded.`)
}

await main()
