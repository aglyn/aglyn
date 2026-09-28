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
 * Stamp the fields the Outreach lists' queries read onto the records written
 * before those fields existed (AGL-3321).
 *
 * Each Outreach list asks Firestore for its filters and its search, and a
 * query cannot find a document that lacks the field it asks about — so
 * without this, an older record lists normally and is never found by a
 * filter or a search:
 *
 *   orgs/{orgId}/outreachSequences/{id}
 *       `nameLower`, `nameTokens`, `nameReversed` from `name` — what the save
 *       route stamps through `nameSearchFields`;
 *   orgs/{orgId}/outreachEnrollments/{id}
 *       `searchTokens` from `contactName` and `email` — what the enroll route
 *       stamps through `outreachEnrollmentSearchTokens` — and `target:
 *       'contact'` where it is absent, which is what an enrollment with no
 *       target is (every enrollment was one, before leads could be sequenced);
 *       and the two click filters' fields (AGL-3332): `clicked`, whether
 *       `engagement.clicks` counts a person's click, which the enroll route
 *       stamps `false` and the click route sets; and `engagement.links`
 *       gains the `lastClickUrl` an earlier click is known by, which is a
 *       destination the person did follow — the click route carries it the
 *       same way on their next click;
 *   orgs/{orgId}/outreachDoNotContactDomains/{domain}
 *       `searchTokens` from `domain` and `detail` — what the one writer stamps
 *       through `outreachDomainSearchTokens`. An entry with no `addedAtMs` is
 *       counted and left alone: the date filter cannot find it, and there is
 *       nothing true to stamp.
 *
 * The name keys come from `lib/name-search-tokens.mjs` and the address
 * tokens from `lib/email-search-tokens.mjs`, the script-side twins of the
 * library's. How an enrollment and a domain combine them — the name beside
 * the address, the domain's labels — is Outreach's own, and is restated
 * below; it is held to `lib/outreach-search-tokens.fixtures.json`,
 * which the Outreach library's spec asserts against the TypeScript and
 * `--self-test` asserts against this.
 *
 * ## Idempotence and interruption
 *
 * A record whose fields already match what it would be stamped with is never
 * written, so a re-run is a no-op and an interrupted run is finished by the
 * next. Writes touch only the fields named above, in batches of 400. Nothing
 * is deleted. Only the three `orgs/{orgId}/…` collections are touched; a
 * collection of the same name anywhere else is counted and left alone.
 *
 * ## Running it
 *
 * Application Default Credentials against the project to write:
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-outreach-list-search.mjs          # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-outreach-list-search.mjs --apply  # write
 *     node tools/scripts/backfill-outreach-list-search.mjs --self-test                             # fixtures only
 *
 * A self-hosted install runs the same commands against its own project.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { BATCH_OPERATIONS, connectFirestore } from './lib/firestore-backfill.mjs'
import {
  nameSearchKey,
  nameSearchReversed,
  nameSearchTokens,
  sameSearchTokens,
} from './lib/name-search-tokens.mjs'
import { emailSearchTokens } from './lib/email-search-tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const COMMAND = 'backfill-outreach-list-search'

const args = parseDeployArgs({
  command: COMMAND,
  summary:
    'Stamp the search and filter fields the Outreach lists query onto sequences, ' +
    'enrollments and do-not-contact domains that predate them. Writes to the live ' +
    'project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
  ],
})

/** Documents read per page of the scan. */
const PAGE = 1000

/** `OUTREACH_ENGAGEMENT_LINKS_MAX`: the most destinations an enrollment keeps. */
const ENGAGEMENT_LINKS_MAX = 20

/** A count as `readOutreachEngagement` reads one. */
const count = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}

/*
 * WHAT AN ENROLLMENT AND A DOMAIN ARE SEARCHED BY, restated from
 * `outreachEnrollmentSearchTokens` (libs/plugins/outreach/src/lib/enrollment/
 * enrollment-search.ts) and `outreachDomainSearchTokens`
 * (libs/plugins/outreach/src/lib/model/do-not-contact-domain-list-query.ts),
 * on the shared script-side builders — `emailSearchTokens` from
 * `lib/email-search-tokens.mjs`, the name keys from `lib/name-search-tokens.mjs`.
 * Held to `lib/outreach-search-tokens.fixtures.json` on both sides.
 */

/** `outreachEnrollmentSearchTokens`: the name's prefixes, then the address's. */
export function enrollmentSearchTokens(enrollment) {
  return [
    ...new Set([
      ...nameSearchTokens(enrollment.contactName),
      ...emailSearchTokens(enrollment.email),
    ]),
  ]
}

/** `outreachDomainSearchTokens`: the domain and each domain inside it, each label, the detail's words. */
export function domainSearchTokens(entry) {
  const domain = String(entry.domain ?? '')
  const labels = domain.split('.')
  const within = labels.map((_, at) => labels.slice(at).join('.'))
  return nameSearchTokens([...within, ...domain.split(/[.-]+/), entry.detail ?? ''].join(' '))
}

/*==========================================
 * WHAT EACH RECORD IS STAMPED WITH — pure, for the self-test.
 *=========================================*/

/** Which of the three collections a path is, or null for anything else. */
function kindOf(path) {
  const segments = path.split('/')
  if (segments.length !== 4 || segments[0] !== 'orgs') return null
  return (
    {
      outreachSequences: 'sequence',
      outreachEnrollments: 'enrollment',
      outreachDoNotContactDomains: 'domain',
    }[segments[2]] ?? null
  )
}

/**
 * What one record should be stamped with, or why not.
 *
 * @param {string} path the document path
 * @param {Record<string, unknown>} data the document
 * @returns {{ update: Record<string, unknown>, missingAddedAt?: boolean }
 *   | { skip: 'current' | 'elsewhere', missingAddedAt?: boolean }}
 */
export function planRecord(path, data) {
  const kind = kindOf(path)
  if (!kind) return { skip: 'elsewhere' }
  const update = {}
  let missingAddedAt = false
  if (kind === 'sequence') {
    const name = typeof data.name === 'string' ? data.name : ''
    const key = nameSearchKey(name)
    const reversed = nameSearchReversed(name)
    const tokens = nameSearchTokens(name)
    if (data.nameLower !== key) update.nameLower = key
    if (data.nameReversed !== reversed) update.nameReversed = reversed
    if (!sameSearchTokens(data.nameTokens, tokens)) update.nameTokens = tokens
  } else if (kind === 'enrollment') {
    const tokens = enrollmentSearchTokens(data)
    if (!sameSearchTokens(data.searchTokens, tokens)) update.searchTokens = tokens
    if (data.target !== 'contact' && data.target !== 'lead') update.target = 'contact'
    const engagement = data.engagement && typeof data.engagement === 'object' ? data.engagement : {}
    const clicked = count(engagement.clicks) > 0
    if (data.clicked !== clicked) update.clicked = clicked
    const links = Array.isArray(engagement.links)
      ? engagement.links.filter((entry) => typeof entry === 'string' && entry !== '')
      : []
    const last = typeof engagement.lastClickUrl === 'string' ? engagement.lastClickUrl : ''
    if (clicked && last && !links.includes(last) && links.length < ENGAGEMENT_LINKS_MAX) {
      update['engagement.links'] = [...links, last]
    }
  } else {
    const tokens = domainSearchTokens({ domain: data.domain ?? path.split('/')[3], detail: data.detail })
    if (!sameSearchTokens(data.searchTokens, tokens)) update.searchTokens = tokens
    missingAddedAt = typeof data.addedAtMs !== 'number'
  }
  const extra = missingAddedAt ? { missingAddedAt } : {}
  return Object.keys(update).length ? { update, ...extra } : { skip: 'current', ...extra }
}

/** A document as `update()` leaves it: a dotted key writes the field inside its map. */
function applyUpdate(data, update) {
  const next = { ...data }
  for (const [key, value] of Object.entries(update)) {
    const [head, ...rest] = key.split('.')
    if (!rest.length) next[head] = value
    else next[head] = { ...(next[head] ?? {}), [rest.join('.')]: value }
  }
  return next
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
  const fixtures = JSON.parse(
    readFileSync(join(here, 'lib', 'outreach-search-tokens.fixtures.json'), 'utf8'),
  )
  check('there are enrollment fixtures', fixtures.enrollments.length > 0)
  check('there are domain fixtures', fixtures.domains.length > 0)
  for (const one of fixtures.enrollments) {
    check(
      `enrollment tokens of ${JSON.stringify(one.enrollment)}`,
      sameSearchTokens(enrollmentSearchTokens(one.enrollment), one.tokens),
    )
  }
  for (const one of fixtures.domains) {
    check(
      `domain tokens of ${JSON.stringify(one.entry)}`,
      sameSearchTokens(domainSearchTokens(one.entry), one.tokens),
    )
  }
  const SEQUENCE = 'orgs/o1/outreachSequences/s1'
  const ENROLLMENT = 'orgs/o1/outreachEnrollments/e1'
  const DOMAIN = 'orgs/o1/outreachDoNotContactDomains/acme.com'
  const winBack = {
    nameLower: 'win back',
    nameReversed: 'kcab niw',
    nameTokens: nameSearchTokens('Win back'),
  }
  const casey = { contactName: 'Casey Morgan', email: 'casey@acme.com' }
  const cases = [
    ['a sequence saved before the fields', SEQUENCE, { name: 'Win back' }, { update: winBack }],
    ['a current sequence', SEQUENCE, { name: 'Win back', ...winBack }, { skip: 'current' }],
    [
      'a sequence missing only the reversed key',
      SEQUENCE,
      { name: 'Win back', nameLower: 'win back', nameTokens: winBack.nameTokens },
      { update: { nameReversed: 'kcab niw' } },
    ],
    ['a sequence with no name', SEQUENCE, {}, { update: { nameLower: '', nameReversed: '', nameTokens: [] } }],
    [
      'an enrollment made before leads could be sequenced',
      ENROLLMENT,
      casey,
      { update: { searchTokens: enrollmentSearchTokens(casey), target: 'contact', clicked: false } },
    ],
    [
      'a lead enrollment made before search',
      ENROLLMENT,
      { ...casey, target: 'lead' },
      { update: { searchTokens: enrollmentSearchTokens(casey), clicked: false } },
    ],
    [
      'a current enrollment',
      ENROLLMENT,
      { ...casey, target: 'lead', searchTokens: enrollmentSearchTokens(casey), clicked: false },
      { skip: 'current' },
    ],
    [
      'an enrollment clicked before each click was recorded',
      ENROLLMENT,
      {
        ...casey,
        target: 'lead',
        searchTokens: enrollmentSearchTokens(casey),
        engagement: { clicks: 2, lastClickUrl: 'https://shop.example/pricing' },
      },
      { update: { clicked: true, 'engagement.links': ['https://shop.example/pricing'] } },
    ],
    [
      'an enrollment only a scanner clicked',
      ENROLLMENT,
      {
        ...casey,
        target: 'lead',
        searchTokens: enrollmentSearchTokens(casey),
        engagement: { machineClicks: 3 },
      },
      { update: { clicked: false } },
    ],
    [
      'an enrollment whose clicks are recorded one by one',
      ENROLLMENT,
      {
        ...casey,
        target: 'lead',
        searchTokens: enrollmentSearchTokens(casey),
        clicked: true,
        engagement: { clicks: 1, lastClickUrl: 'https://a.example/x', links: ['https://a.example/x'] },
      },
      { skip: 'current' },
    ],
    [
      'a domain added before search',
      DOMAIN,
      { domain: 'acme.com', reason: 'manual', addedAtMs: 1 },
      { update: { searchTokens: domainSearchTokens({ domain: 'acme.com' }) } },
    ],
    [
      'a domain with no date',
      DOMAIN,
      { domain: 'acme.com', searchTokens: domainSearchTokens({ domain: 'acme.com' }) },
      { skip: 'current', missingAddedAt: true },
    ],
    ['a collection elsewhere', 'hosts/h1/outreachSequences/s1', { name: 'x' }, { skip: 'elsewhere' }],
  ]
  for (const [name, path, data, expected] of cases) {
    const got = planRecord(path, data)
    check(
      `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`,
      JSON.stringify(got) === JSON.stringify(expected),
    )
    const stamped = 'update' in got ? applyUpdate(data, got.update) : data
    check(`${name}: re-run is a no-op`, 'skip' in planRecord(path, stamped))
  }
  console.log(failed ? `self-test: ${failed} of ${total} failed` : `self-test: ${total}/${total} passed`)
  process.exit(failed ? 1 : 0)
}

/** Scan one collection group, planning each record and writing with --apply. */
async function sweep(firestore, group, counts) {
  let cursor = null
  let batch = firestore.batch()
  let pending = 0
  for (;;) {
    let page = firestore.collectionGroup(group).orderBy('__name__').limit(PAGE)
    if (cursor) page = page.startAfter(cursor)
    const snapshot = await page.get()
    if (snapshot.empty) break
    for (const doc of snapshot.docs) {
      counts.scanned += 1
      const plan = planRecord(doc.ref.path, doc.data())
      if (plan.missingAddedAt) counts.missingAddedAt += 1
      if ('skip' in plan) {
        if (plan.skip === 'current') counts.current += 1
        else counts.elsewhere += 1
        continue
      }
      counts.stamp += 1
      if (!args.apply) continue
      batch.update(doc.ref, plan.update)
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
  if (args.apply && pending) {
    await batch.commit()
    counts.written += pending
  }
}

async function main() {
  if (args.selfTest) return selfTest()
  const firestore = connectFirestore({ repoRoot: join(here, '..', '..'), apply: args.apply })
  console.log(args.apply ? `${COMMAND}: APPLIED` : `${COMMAND}: DRY RUN (nothing written)`)
  for (const group of ['outreachSequences', 'outreachEnrollments', 'outreachDoNotContactDomains']) {
    const counts = { scanned: 0, current: 0, stamp: 0, elsewhere: 0, missingAddedAt: 0, written: 0 }
    await sweep(firestore, group, counts)
    console.log(`  ${group}`)
    console.log(`    scanned                 ${counts.scanned}`)
    console.log(`    already current         ${counts.current}`)
    console.log(`    to stamp                ${counts.stamp}`)
    console.log(`    not under orgs/ (left)  ${counts.elsewhere}`)
    if (group === 'outreachDoNotContactDomains') {
      console.log(`    no addedAtMs (left)     ${counts.missingAddedAt}`)
    }
    if (args.apply) console.log(`    written                 ${counts.written}`)
  }
}

await main()
