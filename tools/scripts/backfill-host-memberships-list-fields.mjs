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
 * Re-derive every host-sourced field of each site membership row from its
 * host, writing only the rows that differ: `displayName`, `subdomain`, `cname`
 * and `favicon` (AGL-3972), and `nameLower`, `searchTokens`, `hasCustomDomain`
 * and `createdAt` (AGL-3321).
 *
 * ## The name, address and icon (AGL-3972)
 *
 * Every site list and switcher, the native apps' included, shows a site by the
 * name, address and favicon its row carries. The console wrote the name and
 * favicon from the browser and re-fanned the rows with a ping that waited on
 * the write's acknowledgement, which the multi-tab cache can hold for a
 * minute, so rows were left on an old name for good: production's marketing
 * site listed as "Aglyn Marketing Website" for two months after it became
 * "Aglyn". The server now writes those fields and re-fans in one request;
 * this repairs the rows written before. `cname` is new on the row, so lists
 * can show the custom domain rather than only the platform address.
 *
 * `subdomain` is only ever SET from a host that has one, as the writer does.
 * `favicon` and `cname` are DELETED from a row whose host has none, as the
 * writer deletes them, so a cleared icon or a released domain stops showing.
 *
 * ## The list fields (AGL-3321)
 *
 * The organization's Sites list is a query over `users/{uid}/hostMemberships`
 * — `where(orgId ==)`, the reader's filters, ordered by `nameLower` or
 * `createdAt` — its quick search is an `array-contains` on `searchTokens`,
 * and its Custom domain filter an equality on `hasCustomDomain`.
 * `membershipRow` (libs/tenant/data/admin/.../host-memberships.ts) writes all
 * of them on every re-sync. A row written before that lacks them, and a query
 * cannot find a document that lacks a field: the search and the filter would
 * never find it, and a range on Created would not show it at all.
 *
 * Each is taken from the HOST document, as the writer takes it: the name key
 * and the tokens from its `displayName`, `subdomain` and `cname` (through
 * `lib/host-membership-search-tokens.mjs`, the writer's script-side twin),
 * `hasCustomDomain` from `cname`, and `createdAt` as the host's own (null when
 * it has none, so the row still sorts). A row whose host
 * no longer exists is counted and left alone — the list drops it at the join,
 * and deleting it is not this script's to do.
 *
 * ## Idempotence and interruption
 *
 * A row whose tokens and date already match its host is never written, so a
 * re-run is a no-op and an interrupted run is finished by the next. Writes
 * UPDATE those four fields alone, in batches of 400. Nothing is deleted. Only
 * `users/{uid}/hostMemberships/{hostId}` is touched: the scan is a collection
 * group, and anything else of that name is counted and skipped.
 *
 * ## Running it
 *
 * Application Default Credentials against the project to write:
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-host-memberships-list-fields.mjs          # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-host-memberships-list-fields.mjs --apply  # write
 *     node tools/scripts/backfill-host-memberships-list-fields.mjs --self-test
 *
 * `--org=<orgId>` limits the run to one organization's rows. A self-hosted
 * install runs the same commands against its own project.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import {
  hasCustomDomain,
  hostMembershipSearchTokens,
} from './lib/host-membership-search-tokens.mjs'
import { nameSearchKey, sameSearchTokens } from './lib/name-search-tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))

/*
 * ARGUMENTS FAIL CLOSED (AGL-1489): `--aply` would otherwise leave a run the
 * operator believes is writing as a dry run, and `--orgs=abc` would widen a
 * run scoped to one organization to every one on the project.
 */
const args = parseDeployArgs({
  command: 'backfill-host-memberships-list-fields',
  summary:
    'Re-derive the host-sourced fields of site membership rows (name, address, ' +
    'custom domain, favicon, search keys, created date) from their hosts, so ' +
    'every site list shows and finds a site as it is. Writes to the live ' +
    'project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
    { flag: '--org', key: 'org', value: 'string', describe: 'Limit to one organization.' },
  ],
})

/** Rows per batch; Firestore allows 500 writes, and this leaves room. */
const BATCH = 400
/** Rows read per page of the scan. */
const PAGE = 500

/**
 * A field the plan removes from the row, as the writer's `FieldValue.delete()`
 * does. A plain marker rather than the sentinel itself, so the plan stays pure
 * and printable for the self-test; `run` swaps it for the real one.
 */
export const DELETE = Object.freeze({ $delete: true })

/** A non-blank string, trimmed, or null. */
const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null)

/** A Firestore timestamp, as opposed to a legacy number or string. */
const isTimestamp = (value) => typeof value?.toMillis === 'function'

/** Two stored dates are the same instant, or both are null. */
const sameInstant = (stored, computed) => {
  if (computed === null) return stored === null
  return (
    isTimestamp(stored) &&
    stored.seconds === computed.seconds &&
    stored.nanoseconds === computed.nanoseconds
  )
}

/**
 * What one row should be stamped with, or why it is left alone. Pure, for the
 * self-test, so the dry run and the apply run cannot disagree.
 *
 * @param {string} path the row's document path
 * @param {Record<string, unknown>} row the row
 * @param {Record<string, unknown> | null} host its host document, or null when it no longer exists
 * @returns {{ update: Record<string, unknown> } | { skip: 'current' | 'no-host' | 'not-a-membership-row' }}
 */
export function planRow(path, row, host) {
  const segments = path.split('/')
  if (segments.length !== 4 || segments[0] !== 'users' || segments[2] !== 'hostMemberships') {
    return { skip: 'not-a-membership-row' }
  }
  if (!host) return { skip: 'no-host' }
  const update = {}
  // What every list shows a site by (AGL-3972), as `membershipRow` writes it.
  const displayName = typeof host.displayName === 'string' ? host.displayName : ''
  if (row.displayName !== displayName) update.displayName = displayName
  if (host.subdomain && row.subdomain !== host.subdomain) update.subdomain = host.subdomain
  const cname = hasCustomDomain(host) ? String(host.cname).trim() : null
  if (cname ? row.cname !== cname : 'cname' in row) update.cname = cname ?? DELETE
  const favicon = text(host.seo?.favicon) ? host.seo.favicon : null
  if (favicon ? row.favicon !== favicon : 'favicon' in row) update.favicon = favicon ?? DELETE
  // The Sites list's default order: a row without it is not listed at all.
  const nameLower = nameSearchKey(displayName)
  if (row.nameLower !== nameLower) update.nameLower = nameLower
  const tokens = hostMembershipSearchTokens(host)
  if (!sameSearchTokens(row.searchTokens, tokens)) update.searchTokens = tokens
  const custom = hasCustomDomain(host)
  if (row.hasCustomDomain !== custom) update.hasCustomDomain = custom
  const createdAt = isTimestamp(host.createdAt) ? host.createdAt : null
  if (!sameInstant(row.createdAt, createdAt)) update.createdAt = createdAt
  return Object.keys(update).length ? { update } : { skip: 'current' }
}

function selfTest() {
  const cases = []
  const check = (name, actual, expected) => {
    cases.push({ name, ok: JSON.stringify(actual) === JSON.stringify(expected), actual })
  }

  // The copy answers the worked examples the library's spec asserts.
  const fixtures = JSON.parse(
    readFileSync(join(here, 'lib', 'host-membership-search-tokens.fixtures.json'), 'utf8'),
  )
  check('the fixtures are there to answer', fixtures.tokens.length > 3, true)
  fixtures.tokens.forEach((one, at) =>
    check(`fixture tokens #${at}`, hostMembershipSearchTokens(one.meta), one.expected),
  )

  const at = (seconds) => ({ seconds, nanoseconds: 0, toMillis: () => seconds * 1000 })
  const HOST = { displayName: 'Harbor Bakery', subdomain: 'harbor-bakery', createdAt: at(100) }
  const TOKENS = hostMembershipSearchTokens(HOST)
  const ROW = 'users/u1/hostMemberships/h1'
  // What a current row carries besides its tokens and its date.
  const REST = {
    displayName: 'Harbor Bakery',
    subdomain: 'harbor-bakery',
    nameLower: 'harbor bakery',
    hasCustomDomain: false,
  }
  const planCases = [
    ['a legacy row', ROW, { orgId: 'o1', displayName: 'Harbor Bakery', subdomain: 'harbor-bakery', nameLower: 'harbor bakery' }, HOST, { update: { searchTokens: TOKENS, hasCustomDomain: false, createdAt: HOST.createdAt } }],
    ['a current row', ROW, { ...REST, searchTokens: TOKENS, createdAt: at(100) }, HOST, { skip: 'current' }],
    ['a row with no name key, which the list would not list', ROW, { displayName: 'Harbor Bakery', subdomain: 'harbor-bakery', searchTokens: TOKENS, hasCustomDomain: false, createdAt: at(100) }, HOST, { update: { nameLower: 'harbor bakery' } }],
    ['a row whose tokens predate the name', ROW, { ...REST, searchTokens: ['old'], createdAt: at(100) }, HOST, { update: { searchTokens: TOKENS } }],
    ['a row left on the name before a rename (AGL-3972)', ROW, { ...REST, displayName: 'Harbor Bakery Website', nameLower: 'harbor bakery website', searchTokens: ['old'], createdAt: at(100) }, HOST, { update: { displayName: 'Harbor Bakery', nameLower: 'harbor bakery', searchTokens: TOKENS } }],
    ['a row left on the address before a rename', ROW, { ...REST, subdomain: 'harbor', searchTokens: TOKENS, createdAt: at(100) }, HOST, { update: { subdomain: 'harbor-bakery' } }],
    ['a row whose site connected a domain', ROW, { ...REST, searchTokens: TOKENS, createdAt: at(100) }, { ...HOST, cname: 'shop.harbor.com' }, { update: { cname: 'shop.harbor.com', searchTokens: hostMembershipSearchTokens({ ...HOST, cname: 'shop.harbor.com' }), hasCustomDomain: true } }],
    ['a row whose site released its domain', ROW, { ...REST, cname: 'shop.harbor.com', searchTokens: TOKENS, createdAt: at(100) }, HOST, { update: { cname: DELETE } }],
    ['a row missing the site’s new favicon', ROW, { ...REST, searchTokens: TOKENS, createdAt: at(100) }, { ...HOST, seo: { favicon: 'media:org:icon' } }, { update: { favicon: 'media:org:icon' } }],
    ['a row still showing a cleared favicon', ROW, { ...REST, favicon: 'media:org:icon', searchTokens: TOKENS, createdAt: at(100) }, { ...HOST, seo: { favicon: '' } }, { update: { favicon: DELETE } }],
    ['a seeded row dated by the seed, not the site', ROW, { ...REST, searchTokens: TOKENS, createdAt: at(7) }, HOST, { update: { createdAt: HOST.createdAt } }],
    ['a site that never recorded a date', ROW, { ...REST, searchTokens: TOKENS }, { ...HOST, createdAt: undefined }, { update: { createdAt: null } }],
    ['a legacy numeric date on the site', ROW, { ...REST, searchTokens: TOKENS, createdAt: null }, { ...HOST, createdAt: 1_700_000_000_000 }, { skip: 'current' }],
    ['a row whose site is gone', ROW, {}, null, { skip: 'no-host' }],
    ['another collection of the same name', 'orgs/o1/hostMemberships/h1', {}, HOST, { skip: 'not-a-membership-row' }],
  ]
  for (const [name, path, row, host, expected] of planCases) {
    check(name, planRow(path, row, host), expected)
  }
  // Idempotent: a row the plan stamped plans nothing the second time.
  for (const [name, path, row, host] of planCases) {
    const once = planRow(path, row, host)
    const stamped = { ...row }
    for (const [key, value] of Object.entries('update' in once ? once.update : {})) {
      if (value === DELETE) delete stamped[key]
      else stamped[key] = value
    }
    const again = planRow(path, stamped, host)
    check(`${name}: a re-run writes nothing`, 'skip' in again, true)
  }

  for (const entry of cases) {
    console.log(
      `${entry.ok ? 'ok  ' : 'FAIL'} ${entry.name}` +
        (entry.ok ? '' : ` — got ${JSON.stringify(entry.actual)}`),
    )
  }
  const failed = cases.filter((entry) => !entry.ok).length
  console.log(`\nself-test: ${cases.length - failed}/${cases.length} passed`)
  process.exitCode = failed ? 1 : 0
}

async function run() {
  const { applicationDefault, initializeApp } = await import('firebase-admin/app')
  const { FieldValue, getFirestore } = await import('firebase-admin/firestore')
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || undefined
  initializeApp({
    credential: applicationDefault(),
    ...(projectId ? { projectId } : {}),
  })
  const firestore = getFirestore()
  console.log(
    `project: ${projectId ?? '(from the credentials)'} · ${args.apply ? 'APPLY' : 'dry run'}` +
      (args.org ? ` · org ${args.org}` : ''),
  )

  const counts = {
    scanned: 0,
    current: 0,
    displayName: 0,
    subdomain: 0,
    cname: 0,
    favicon: 0,
    nameLower: 0,
    tokens: 0,
    hasCustomDomain: 0,
    createdAt: 0,
    noHost: 0,
    otherCollections: 0,
    written: 0,
  }
  let cursor = null
  let example = false
  let batch = firestore.batch()
  let pending = 0
  for (;;) {
    let page = firestore.collectionGroup('hostMemberships')
    if (args.org) page = page.where('orgId', '==', args.org)
    page = page.orderBy('__name__').limit(PAGE)
    if (cursor) page = page.startAfter(cursor)
    const snapshot = await page.get()
    if (snapshot.empty) break

    const hostIds = [...new Set(snapshot.docs.map((row) => row.id))]
    const hosts = new Map(
      (await firestore.getAll(...hostIds.map((id) => firestore.collection('hosts').doc(id)))).map(
        (host) => [host.id, host.exists ? host.data() : null],
      ),
    )
    for (const row of snapshot.docs) {
      counts.scanned += 1
      const plan = planRow(row.ref.path, row.data(), hosts.get(row.id) ?? null)
      if ('skip' in plan) {
        if (plan.skip === 'current') counts.current += 1
        else if (plan.skip === 'no-host') counts.noHost += 1
        else counts.otherCollections += 1
        continue
      }
      for (const key of ['displayName', 'subdomain', 'cname', 'favicon']) {
        if (key in plan.update) counts[key] += 1
      }
      if (!example && ('displayName' in plan.update || 'subdomain' in plan.update)) {
        // One redacted example, so an operator can see what kind of drift
        // this is without the run printing anyone's site names.
        example = true
        const mask = (value) =>
          typeof value === 'string' && value ? `${[...value][0]}…(${[...value].length})` : value
        console.log(
          `  e.g. ${mask(row.get('displayName'))} / ${mask(row.get('subdomain'))}` +
            ` -> ${mask(plan.update.displayName ?? row.get('displayName'))}` +
            ` / ${mask(plan.update.subdomain ?? row.get('subdomain'))}`,
        )
      }
      if ('nameLower' in plan.update) counts.nameLower += 1
      if ('searchTokens' in plan.update) counts.tokens += 1
      if ('hasCustomDomain' in plan.update) counts.hasCustomDomain += 1
      if ('createdAt' in plan.update) counts.createdAt += 1
      if (!args.apply) continue
      batch.update(
        row.ref,
        Object.fromEntries(
          Object.entries(plan.update).map(([key, value]) => [
            key,
            value === DELETE ? FieldValue.delete() : value,
          ]),
        ),
      )
      pending += 1
      if (pending >= BATCH) {
        // Swap in the fresh batch BEFORE awaiting the full one, so `batch`
        // never points at an in-flight commit (AGL-1815).
        const full = batch
        batch = firestore.batch()
        pending = 0
        await full.commit()
        counts.written += BATCH
      }
    }
    cursor = snapshot.docs[snapshot.docs.length - 1]
    if (snapshot.size < PAGE) break
  }
  if (args.apply && pending) {
    await batch.commit()
    counts.written += pending
  }
  console.log(
    args.apply
      ? 'backfill-host-memberships-list-fields: APPLIED'
      : 'backfill-host-memberships-list-fields: DRY RUN (nothing written)',
  )
  console.log(`  scanned                         ${counts.scanned}`)
  console.log(`  already current                 ${counts.current}`)
  console.log(`  set displayName                 ${counts.displayName}`)
  console.log(`  set subdomain                   ${counts.subdomain}`)
  console.log(`  set or clear cname              ${counts.cname}`)
  console.log(`  set or clear favicon            ${counts.favicon}`)
  console.log(`  stamp nameLower                 ${counts.nameLower}`)
  console.log(`  stamp searchTokens              ${counts.tokens}`)
  console.log(`  stamp hasCustomDomain           ${counts.hasCustomDomain}`)
  console.log(`  stamp createdAt                 ${counts.createdAt}`)
  console.log(`  site gone (left alone)          ${counts.noHost}`)
  console.log(`  not users/*/hostMemberships     ${counts.otherCollections}`)
  if (args.apply) console.log(`  written                         ${counts.written}`)
}

if (args.selfTest) selfTest()
else await run()
