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
 * Stamp the keys the site artifact lists query by onto every screen, layout,
 * reusable component, template and marketplace listing written before them
 * (AGL-3321).
 *
 * The layouts page, the components card, the templates library, the template
 * gallery and the email templates list put their filters and their search on
 * the Firestore query. A query finds a document by a STORED value, so each
 * list reads keys every writer now stamps through `artifactCreateListKeys` /
 * `artifactRenameListKeys` (`libs/aglyn/src/lib/app-utils/artifact-list-keys.ts`)
 * and every marketplace publish through `displayNameSearchFields`:
 *
 *   nameLower, nameTokens, nameReversed   all five collections, from the
 *                                         document's name — a starter page's
 *                                         from its starter's name;
 *   kind          a component (`site` unless `email`) and a template
 *                 (`page` unless `component` or `layout`);
 *   source.type   a template with none, or the legacy `workspace`: `authored`;
 *   libraryRow    a template: whether it is its own library row — a
 *                 multi-page starter is ONE row, led by one live page.
 *
 * A document without them still exists and still opens; it is only the
 * lists' search and filters that cannot see it.
 *
 * A DELETED screen is skipped: an email template's delete clears its name
 * keys so the tombstone leaves the templates list, which orders by
 * `nameLower`, and stamping them back would put it on the list again.
 *
 * ## Held to the writers
 *
 * A script cannot import the library, so the name keys come from
 * `tools/scripts/lib/name-search-tokens.mjs` (the one script-side twin of
 * the library's name keys) and the rest are read here the way
 * `artifactCreateListKeys` reads them. Both sides answer
 * `tools/scripts/lib/artifact-list-keys.fixtures.json`: the library's
 * `artifact-list-keys.spec.ts` and this script's `--self-test`.
 *
 * A starter's lead is the one thing a create cannot decide from one
 * document: the first page leads when a starter is written whole, and a
 * delete hands the lead to the next live page. So here a starter whose live
 * pages hold exactly one lead keeps it, and any other gets its first live
 * page in authored order.
 *
 * ## What it touches
 *
 * `hosts/{hostId}/{screens,layouts,components,templates}/{id}` and
 * `marketplaceListings/{id}`, and on each only the keys above that differ
 * from what it holds — never `displayName`, `updatedAt` or anything a reader
 * shows. No document is deleted. A DELETED screen is the one exception to
 * stamping: it carries no name keys (a delete clears them, so the email
 * templates list, ordered by `nameLower`, drops the tombstone), and one
 * deleted before that rule has its keys removed rather than stamped.
 *
 * It also COUNTS the tombstones (`deletedAt` set) the layouts and components
 * lists drop from the pages they fall in, so the cost of that residual is a
 * measured number.
 *
 * ## Idempotence and interruption
 *
 * A document whose keys already equal what it would be stamped with is never
 * written, so a re-run is a no-op and an interrupted run is finished by the
 * next.
 *
 * ## Running it
 *
 * Application Default Credentials against the project to write, AFTER the
 * promotion that ships the writers — before it, a rename through the old
 * console leaves stale keys, which a re-run would then find:
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-artifacts-list-keys.mjs                 # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-artifacts-list-keys.mjs --host=<hostId> # one site, no listings
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-artifacts-list-keys.mjs --apply         # write
 *
 *     node tools/scripts/backfill-artifacts-list-keys.mjs --self-test
 *
 * A self-hosted install runs the same commands against its own project.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { commitAll, connectFirestore, everyDocument } from './lib/firestore-backfill.mjs'
import { displayNameSearchFields, sameSearchTokens } from './lib/name-search-tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')

/** `LISTED_ARTIFACT_COLLECTIONS`. */
const ARTIFACTS = ['screens', 'layouts', 'components', 'templates']

/** The kinds a template's `kind` holds; any other reads as `page`. */
const TEMPLATE_KINDS = ['page', 'component', 'layout']

/** The legacy provenance word a detached copy carried; it reads as `authored`. */
const LEGACY_AUTHORED_SOURCE = 'workspace'

/** Every field the plan reads — the walk reads nothing else. */
const READ_FIELDS = [
  'displayName',
  'kind',
  'source',
  'deletedAt',
  'libraryRow',
  'nameLower',
  'nameTokens',
  'nameReversed',
]

const args = parseDeployArgs({
  command: 'backfill-artifacts-list-keys',
  summary:
    'Stamp the list keys (name keys, kind, source, library row) onto ' +
    'site artifacts and marketplace listings written before them, so the ' +
    'console lists can filter and search them. Writes to the named project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
    { flag: '--host', key: 'host', value: 'string', describe: 'Limit to one host id (listings are skipped).' },
  ],
})

const record = (value) => (value && typeof value === 'object' ? value : {})

/** `artifactSearchName`: a starter page is found by its starter's name. */
export function searchName(collection, doc) {
  if (collection === 'templates') {
    const starterName = record(doc.source).starterName
    if (typeof starterName === 'string' && starterName.trim()) return starterName
  }
  return doc.displayName
}

/** Whether a template leads its starter's row when the starter is written whole. */
const leadsItsStarter = (doc) => {
  const source = record(doc.source)
  if (typeof source.starterId !== 'string' || !source.starterId) return true
  return Number(source.starterOrder ?? 0) === 0
}

/**
 * The keys `artifactCreateListKeys` stamps on a create of `doc`, with a
 * template's `source` spelled as the one field a backfill writes. Pure, for
 * the self-test.
 */
export function createKeys(collection, doc) {
  if (!ARTIFACTS.includes(collection)) return {}
  if (collection === 'screens' && doc.deletedAt != null) return {}
  const keys = { ...displayNameSearchFields(searchName(collection, doc)) }
  if (collection === 'components' && doc.kind !== 'email') keys.kind = 'site'
  if (collection === 'templates') {
    if (!TEMPLATE_KINDS.includes(String(doc.kind))) keys.kind = 'page'
    const sourceType = record(doc.source).type
    if (typeof sourceType !== 'string' || sourceType === LEGACY_AUTHORED_SOURCE) {
      keys.source = { ...record(doc.source), type: 'authored' }
    }
    keys.libraryRow = doc.deletedAt == null && leadsItsStarter(doc)
  }
  return keys
}

/**
 * Which of a host's templates lead a library row, by id: every live template
 * that is no starter's page, and one live page per starter — the one that
 * already leads when exactly one does, else the first in authored order.
 *
 * @param {Array<{ id: string, data: Record<string, unknown> }>} templates
 * @returns {Set<string>}
 */
export function libraryRowLeads(templates) {
  const leads = new Set()
  const starters = new Map()
  for (const entry of templates) {
    if (entry.data.deletedAt != null) continue
    const starterId = record(entry.data.source).starterId
    if (typeof starterId !== 'string' || !starterId) {
      leads.add(entry.id)
      continue
    }
    starters.set(starterId, [...(starters.get(starterId) ?? []), entry])
  }
  for (const pages of starters.values()) {
    const leading = pages.filter((page) => page.data.libraryRow === true)
    if (leading.length === 1) {
      leads.add(leading[0].id)
      continue
    }
    const first = [...pages].sort(
      (a, b) =>
        Number(record(a.data.source).starterOrder ?? 0) -
          Number(record(b.data.source).starterOrder ?? 0) || a.id.localeCompare(b.id),
    )[0]
    leads.add(first.id)
  }
  return leads
}

/**
 * What one document should be stamped with, or a skip. `libraryRow` is the
 * host-level answer for a template (see {@link libraryRowLeads}). Pure.
 *
 * @returns {{ update: Record<string, unknown> } | { skip: 'current' }}
 */
/** The three name keys a list orders or searches by. */
const NAME_KEYS = ['nameLower', 'nameTokens', 'nameReversed']

/** In a plan, a field to delete; written as `FieldValue.delete()`. */
export const CLEAR = '__clear__'

export function planArtifact(collection, data, libraryRow) {
  // A deleted screen carries NO name keys, the way a delete now leaves it:
  // the email templates list orders by `nameLower`, so a tombstone that kept
  // its key would still be listed. One deleted before that is cleared here.
  if (collection === 'screens' && data.deletedAt != null) {
    const stale = NAME_KEYS.filter((key) => data[key] !== undefined)
    return stale.length
      ? { update: Object.fromEntries(stale.map((key) => [key, CLEAR])) }
      : { skip: 'deleted' }
  }
  const keys = createKeys(collection, data)
  const update = {}
  if (data.nameLower !== keys.nameLower) update.nameLower = keys.nameLower
  if (!sameSearchTokens(data.nameTokens, keys.nameTokens)) update.nameTokens = keys.nameTokens
  if (data.nameReversed !== keys.nameReversed) update.nameReversed = keys.nameReversed
  if ('kind' in keys && data.kind !== keys.kind) update.kind = keys.kind
  if ('source' in keys) update['source.type'] = keys.source.type
  if (collection === 'templates') {
    const leads = libraryRow ?? keys.libraryRow
    if (data.libraryRow !== leads) update.libraryRow = leads
  }
  return Object.keys(update).length ? { update } : { skip: 'current' }
}

/** A marketplace listing's name keys, or a skip. Pure. */
export function planListing(data) {
  const keys = displayNameSearchFields(data.displayName)
  const update = {}
  if (data.nameLower !== keys.nameLower) update.nameLower = keys.nameLower
  if (!sameSearchTokens(data.nameTokens, keys.nameTokens)) update.nameTokens = keys.nameTokens
  if (data.nameReversed !== keys.nameReversed) update.nameReversed = keys.nameReversed
  return Object.keys(update).length ? { update } : { skip: 'current' }
}

function selfTest() {
  const fixtures = JSON.parse(
    readFileSync(join(here, 'lib', 'artifact-list-keys.fixtures.json'), 'utf8'),
  )
  const failures = []
  const check = (name, ok) => {
    if (!ok) failures.push(name)
  }
  // The create cases `artifact-list-keys.spec.ts` runs against the library.
  for (const one of fixtures.create) {
    const got = createKeys(one.collection, one.doc)
    check(
      `create ${one.name}: expected ${JSON.stringify(one.expected)}, got ${JSON.stringify(got)}`,
      JSON.stringify(got) === JSON.stringify(one.expected),
    )
  }
  const leads = libraryRowLeads([
    { id: 'plain', data: {} },
    { id: 'gone', data: { deletedAt: 1 } },
    { id: 's-0', data: { source: { starterId: 's', starterOrder: 0 }, deletedAt: 1 } },
    { id: 's-1', data: { source: { starterId: 's', starterOrder: 1 } } },
    { id: 's-2', data: { source: { starterId: 's', starterOrder: 2 } } },
    { id: 't-0', data: { source: { starterId: 't', starterOrder: 0 } } },
    { id: 't-1', data: { source: { starterId: 't', starterOrder: 1 }, libraryRow: true } },
  ])
  check(
    `leads: expected plain,s-1,t-1, got ${[...leads].sort().join(',')}`,
    [...leads].sort().join(',') === 'plain,s-1,t-1',
  )
  const HOME = displayNameSearchFields('Home')
  const cases = [
    ['a legacy screen', 'screens', { displayName: 'Home' }, undefined, { update: HOME }],
    ['a current screen', 'screens', { displayName: 'Home', ...HOME }, undefined, { skip: 'current' }],
    ['a deleted email template with no keys', 'screens', { displayName: 'Old', kind: 'email', deletedAt: 1 }, undefined, { skip: 'deleted' }],
    ['a deleted screen still keyed, its keys cleared', 'screens', { displayName: 'Old', kind: 'email', deletedAt: 1, nameLower: 'old', nameTokens: ['o'] }, undefined, { update: { nameLower: CLEAR, nameTokens: CLEAR } }],
    ['a renamed layout with stale keys', 'layouts', { displayName: 'Home', ...HOME, nameLower: 'old' }, undefined, { update: { nameLower: 'home' } }],
    ['a legacy component', 'components', { displayName: 'Home' }, undefined, { update: { ...HOME, kind: 'site' } }],
    ['a legacy template', 'templates', { displayName: 'Home' }, true, { update: { ...HOME, kind: 'page', 'source.type': 'authored', libraryRow: true } }],
    ['a starter page that does not lead', 'templates', { displayName: 'Home', kind: 'page', source: { type: 'starter', starterId: 's', starterName: 'Home', starterOrder: 1 }, ...HOME, libraryRow: true }, false, { update: { libraryRow: false } }],
  ]
  for (const [name, collection, data, libraryRow, expected] of cases) {
    const got = planArtifact(collection, data, libraryRow)
    check(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`, JSON.stringify(got) === JSON.stringify(expected))
    // Idempotent: what the plan stamped plans nothing the second time.
    const stamped = 'update' in got ? { ...data } : data
    if ('update' in got) {
      for (const [key, value] of Object.entries(got.update)) {
        if (key === 'source.type') stamped.source = { ...record(stamped.source), type: value }
        else if (value === CLEAR) delete stamped[key]
        else stamped[key] = value
      }
    }
    check(`${name}: re-run is a no-op`, 'skip' in planArtifact(collection, stamped, libraryRow))
  }
  const listing = planListing({ displayName: 'Home' })
  check('a legacy listing is stamped', JSON.stringify(listing) === JSON.stringify({ update: HOME }))
  check('a current listing is skipped', 'skip' in planListing({ displayName: 'Home', ...HOME }))
  const total = fixtures.create.length + 1 + cases.length * 2 + 2
  for (const failure of failures) console.error(`FAIL ${failure}`)
  console.log(failures.length ? `self-test: ${failures.length} of ${total} failed` : `self-test: ${total}/${total} passed`)
  process.exit(failures.length ? 1 : 0)
}

async function main() {
  if (args.selfTest) return selfTest()
  const apply = Boolean(args.apply)
  const db = connectFirestore({ repoRoot: REPO_ROOT, apply })
  const writes = []
  const totals = { hosts: 0 }
  const tally = (name) => (totals[name] ??= { scanned: 0, current: 0, stamp: 0, tombstones: 0 })
  // Deleted screens a delete from before AGL-3321 left carrying a name key;
  // their keys are cleared with the rest of the writes.
  let keyedTombstones = 0
  const hostIds = args.host
    ? [args.host]
    : (await db.collection('hosts').listDocuments()).map((ref) => ref.id).sort()
  for (const hostId of hostIds) {
    totals.hosts += 1
    const hostRef = db.collection('hosts').doc(hostId)
    for (const collection of ARTIFACTS) {
      const count = tally(collection)
      const rows = []
      for await (const snapshot of everyDocument(hostRef.collection(collection).select(...READ_FIELDS))) {
        rows.push({ id: snapshot.id, ref: snapshot.ref, data: snapshot.data() ?? {} })
      }
      const leads = collection === 'templates' ? libraryRowLeads(rows) : null
      for (const row of rows) {
        count.scanned += 1
        if (row.data.deletedAt != null) count.tombstones += 1
        if (collection === 'screens' && row.data.deletedAt != null && row.data.nameLower != null) {
          keyedTombstones += 1
        }
        const plan = planArtifact(collection, row.data, leads ? leads.has(row.id) : undefined)
        if ('skip' in plan) {
          if (plan.skip === 'current') count.current += 1
          continue
        }
        count.stamp += 1
        const value = Object.fromEntries(
          Object.entries(plan.update).map(([key, entry]) => [key, entry === CLEAR ? FieldValue.delete() : entry]),
        )
        writes.push({ kind: 'update', ref: row.ref, value })
      }
    }
  }
  if (!args.host) {
    const count = tally('marketplaceListings')
    const listings = db.collection('marketplaceListings').select('displayName', 'nameLower', 'nameTokens', 'nameReversed', 'deletedAt')
    for await (const snapshot of everyDocument(listings)) {
      count.scanned += 1
      const data = snapshot.data() ?? {}
      if (data.deletedAt != null) count.tombstones += 1
      const plan = planListing(data)
      if ('skip' in plan) {
        count.current += 1
        continue
      }
      count.stamp += 1
      writes.push({ kind: 'update', ref: snapshot.ref, value: plan.update })
    }
  }
  console.log(`scanned ${totals.hosts} hosts`)
  for (const [name, count] of Object.entries(totals)) {
    if (name === 'hosts') continue
    console.log(
      `  ${name.padEnd(20)} ${String(count.scanned).padStart(6)} scanned, ` +
        `${String(count.current).padStart(6)} current, ${String(count.stamp).padStart(6)} to stamp, ` +
        `${String(count.tombstones).padStart(5)} tombstones`,
    )
  }
  console.log(`  deleted screens still carrying a name key (keys to clear): ${keyedTombstones}`)
  if (!apply) {
    console.log(`DRY RUN — ${writes.length} writes planned, NOTHING WAS WRITTEN.`)
    return
  }
  await commitAll(db, writes)
  console.log(`APPLIED — ${writes.length} writes committed.`)
}

await main()
