/**
 * Stamp `filterKeys` and `filterValues` onto the dataset records written
 * before those fields.
 *
 *   gcloud auth application-default login
 *   GOOGLE_CLOUD_PROJECT=<project-id> \
 *     node tools/scripts/backfill-dataset-filter-keys.mjs [--apply] [--org=<orgId>]
 *
 *   node tools/scripts/backfill-dataset-filter-keys.mjs --self-test
 *
 * DRY RUN BY DEFAULT. Credentials are Application Default Credentials: the
 * `gcloud` login above, or `GOOGLE_APPLICATION_CREDENTIALS` naming a service
 * account key with Firestore write access. `GOOGLE_CLOUD_PROJECT` names the
 * project; without it the credentials' own project is used, and the run
 * prints which one it is before it reads anything.
 *
 * ## What the fields are
 *
 * The records table's Filters panel and quick search are ONE Firestore query
 * (AGL-3321): its equalities ask `filterValues.<field> ==` (one scalar per
 * field, `datasetFilterValues`), and its one word-level clause — a text
 * `contains`, a list member, or the search word — asks `filterKeys
 * array-contains` (`datasetFilterKeys`), both in
 * `libs/aglyn/src/lib/app-utils/dataset-models.ts`. Every writer stamps them
 * through `datasetIntegrityFields` / `datasetIntegrityUpdate`; a record
 * written before carries neither, or only `filterKeys`, and answers no
 * filter that asks the missing one until it is edited or this script
 * reaches it.
 *
 * It needs no index deploy: Firestore's automatic single-field indexes serve
 * the query by index merging. This script is the only step an existing
 * project needs.
 *
 * ## What it touches
 *
 * Every `records` collection under `orgs/{orgId}/datasets/{id}` and the
 * legacy `hosts/{hostId}/datasets/{id}`. It reads each dataset's `model` (or
 * derives one from a v1 `fields` list, exactly as the writers do), computes
 * each record's filter fields from its `values` with the script-side copy in
 * `lib/record-filter-keys.mjs`, and UPDATES `filterKeys` and `filterValues`
 * alone — whichever of the two moved; nothing else on the record changes,
 * and nothing is ever deleted except those fields on a record that no longer
 * has a filterable value.
 *
 * ## Idempotence and interruption
 *
 * A record whose stored fields already equal the computed ones (the map
 * compared key by key, in any order) is counted as current and not written,
 * so a second run writes nothing. Writes go in batches of
 * {@link BATCH_SIZE}, so an interruption leaves a partially stamped dataset —
 * which is exactly what a re-run finishes. Re-running after a schema change
 * re-stamps the records whose fields the change moved (a text field made an
 * enum, a field removed).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  datasetFilterKeys,
  datasetFilterToken,
  datasetFilterValuePath,
  datasetFilterValues,
  datasetSearchToken,
  effectiveModel,
  modelShimAgrees,
} from './lib/record-filter-keys.mjs'
import { parseDeployArgs } from './lib/deploy-args.mjs'

const here = dirname(fileURLToPath(import.meta.url))

/*
 * ARGUMENTS FAIL CLOSED (AGL-1489): `--aply` would otherwise leave a run the
 * operator believes is writing as a dry run, and `--orgs=abc` would widen a
 * run scoped to one organization to every one on the project.
 */
const args = parseDeployArgs({
  command: 'backfill-dataset-filter-keys',
  summary:
    'Stamp `filterKeys` onto dataset records written before the field, so the ' +
    'records table can filter and search them. Writes to the live project ' +
    'with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    {
      flag: '--apply',
      key: 'apply',
      describe: 'Write. Without it, a dry run.',
    },
    {
      flag: '--self-test',
      key: 'selfTest',
      describe: 'Run the fixtures, touching no project.',
    },
    {
      flag: '--org',
      key: 'org',
      value: 'string',
      describe: 'Limit to one organization.',
    },
  ],
})

/** Records read, and at most written, per batch. Firestore allows 500. */
const BATCH_SIZE = 400

const sameKeys = (left, right) =>
  left.length === right.length && left.every((key, at) => key === right[at])

/**
 * Whether a stored `filterValues` map holds exactly the computed entries.
 * Key ORDER is not compared: a map read back from Firestore need not list
 * its keys in the order they were written.
 */
const sameValues = (stored, computed) => {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return false
  const keys = Object.keys(computed)
  return (
    Object.keys(stored).length === keys.length &&
    keys.every((key) => Object.is(stored[key], computed[key]))
  )
}

/**
 * One record's verdict, so the dry run and the apply run cannot disagree.
 * `write` holds only the fields that moved: an array or map to store, or
 * `null` to remove the field.
 */
export function planRecord(model, data) {
  const values = data?.values
  if (values != null && (typeof values !== 'object' || Array.isArray(values))) {
    return { action: 'skip', reason: '`values` is not a map' }
  }
  const write = {}
  const keys = datasetFilterKeys(model, values ?? undefined)
  const storedKeys = data?.filterKeys
  const keysCurrent =
    storedKeys === undefined
      ? keys.length === 0
      : Array.isArray(storedKeys) && sameKeys(storedKeys, keys)
  if (!keysCurrent) write.filterKeys = keys.length ? keys : null

  const filterValues = datasetFilterValues(model, values ?? undefined)
  const storedValues = data?.filterValues
  const empty = Object.keys(filterValues).length === 0
  const valuesCurrent =
    storedValues === undefined ? empty : sameValues(storedValues, filterValues)
  if (!valuesCurrent) write.filterValues = empty ? null : filterValues

  return Object.keys(write).length ? { action: 'update', write } : { action: 'current' }
}

async function run() {
  const guard = modelShimAgrees()
  if (!guard.ok) {
    console.error(`REFUSED — ${guard.why}`)
    process.exitCode = 1
    return
  }
  const { applicationDefault, initializeApp } =
    await import('firebase-admin/app')
  const { FieldValue, FieldPath, getFirestore } =
    await import('firebase-admin/firestore')
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

  const datasetDocs = args.org
    ? (
        await firestore
          .collection('orgs')
          .doc(args.org)
          .collection('datasets')
          .get()
      ).docs
    : (await firestore.collectionGroup('datasets').get()).docs

  const totals = {
    datasets: 0,
    scanned: 0,
    current: 0,
    updated: 0,
    skipped: 0,
    keys: 0,
    values: 0,
  }
  const skipReasons = new Map()
  const skip = (reason, count = 1) => {
    totals.skipped += count
    skipReasons.set(reason, (skipReasons.get(reason) ?? 0) + count)
  }

  for (const datasetDoc of datasetDocs) {
    // `datasets` under anything but an org or a site is not a dataset store.
    const owner = datasetDoc.ref.parent.parent
    const ownerCollection = owner?.parent?.id
    if (!owner || (ownerCollection !== 'orgs' && ownerCollection !== 'hosts'))
      continue
    totals.datasets += 1
    const model = effectiveModel({
      model: datasetDoc.get('model'),
      fields: datasetDoc.get('fields'),
    })
    const recordsRef = datasetDoc.ref.collection('records')
    const counts = { scanned: 0, current: 0, updated: 0, skipped: 0, keys: 0, values: 0 }
    let cursor = null
    for (;;) {
      // Paged by document name: every record has one, so the walk is total.
      let pageQuery = recordsRef
        .orderBy(FieldPath.documentId())
        .select('values', 'filterKeys', 'filterValues')
        .limit(BATCH_SIZE)
      if (cursor) pageQuery = pageQuery.startAfter(cursor)
      const page = await pageQuery.get()
      if (page.empty) break
      const batch = firestore.batch()
      let writes = 0
      for (const recordDoc of page.docs) {
        counts.scanned += 1
        const verdict = planRecord(model, recordDoc.data())
        if (verdict.action === 'current') counts.current += 1
        else if (verdict.action === 'skip') {
          counts.skipped += 1
          skip(verdict.reason)
        } else {
          counts.updated += 1
          writes += 1
          if ('filterKeys' in verdict.write) counts.keys += 1
          if ('filterValues' in verdict.write) counts.values += 1
          // `update` replaces each field whole — `filterValues` included,
          // so an entry the record no longer holds leaves with the rest.
          batch.update(
            recordDoc.ref,
            Object.fromEntries(
              Object.entries(verdict.write).map(([field, value]) => [
                field,
                value ?? FieldValue.delete(),
              ]),
            ),
          )
        }
      }
      if (args.apply && writes) await batch.commit()
      cursor = page.docs[page.docs.length - 1]
      if (page.size < BATCH_SIZE) break
    }
    totals.scanned += counts.scanned
    totals.current += counts.current
    totals.updated += counts.updated
    totals.keys += counts.keys
    totals.values += counts.values
    if (counts.updated || counts.skipped) {
      console.log(
        `${datasetDoc.ref.path}: ${counts.scanned} scanned, ${counts.current} current, ` +
          `${counts.updated} ${args.apply ? 'updated' : 'to update'}, ${counts.skipped} skipped`,
      )
    }
  }

  console.log(
    `\n${totals.datasets} dataset(s): ${totals.scanned} record(s) scanned, ` +
      `${totals.current} already current, ${totals.updated} ` +
      `${args.apply ? 'updated' : 'would be updated'}, ${totals.skipped} skipped` +
      ` (filterKeys on ${totals.keys}, filterValues on ${totals.values})`,
  )
  for (const [reason, count] of skipReasons)
    console.log(`  skipped ${count}: ${reason}`)
  if (!args.apply) console.log('\nDRY RUN — re-run with --apply to write.')
}

/** The verdicts that decide whether this is safe to run. No Firestore. */
function runSelfTest() {
  const cases = []
  const check = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected)
    cases.push({ name, ok, actual, expected })
  }
  const model = {
    order: ['name', 'status'],
    fields: {
      name: { name: 'Name', type: 'text' },
      status: {
        name: 'Status',
        type: 'text',
        validation: { options: ['Open'] },
      },
    },
  }
  const keys = datasetFilterKeys(model, { name: 'Red Kettle', status: 'Open' })

  // The copy answers the worked examples the library's spec asserts.
  const fixtures = JSON.parse(
    readFileSync(
      join(here, 'lib', 'dataset-filter-keys.fixtures.json'),
      'utf8',
    ),
  )
  fixtures.keys.forEach((one, at) =>
    check(
      `fixture keys #${at}`,
      datasetFilterKeys(fixtures.model, one.values),
      one.expected,
    ),
  )
  fixtures.tokens.forEach((one, at) =>
    check(
      `fixture token #${at}`,
      datasetFilterToken(fixtures.model, one.clause),
      one.expected,
    ),
  )
  fixtures.search.forEach((one, at) =>
    check(`fixture search #${at}`, datasetSearchToken(one.word), one.expected),
  )
  // A map is compared by its entries, in key order: the fixture file and
  // the builder need not list keys alike.
  const entries = (map) => Object.entries(map ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))
  check('the fixtures carry filterValues cases', (fixtures.values ?? []).length > 0, true)
  ;(fixtures.values ?? []).forEach((one, at) =>
    check(
      `fixture values #${at}`,
      entries(datasetFilterValues(fixtures.model, one.values)),
      entries(one.expected),
    ),
  )
  ;(fixtures.paths ?? []).forEach((one, at) =>
    check(`fixture path #${at}`, datasetFilterValuePath(one.fieldId), one.expected),
  )

  check(
    'reads the token builder beside this script',
    keys.includes('f:status=Open') &&
      keys.includes('f:name^kett') &&
      keys.includes('s:red'),
    true,
  )
  const filterValues = { name: 'red kettle', status: 'Open' }
  check(
    'stamps a record that carries neither field',
    planRecord(model, { values: { name: 'Red Kettle', status: 'Open' } }),
    { action: 'update', write: { filterKeys: keys, filterValues } },
  )
  check(
    'stamps only filterValues on a record the first backfill reached',
    planRecord(model, {
      values: { name: 'Red Kettle', status: 'Open' },
      filterKeys: keys,
    }),
    { action: 'update', write: { filterValues } },
  )
  check(
    'is idempotent: a stamped record is current, whatever its map key order',
    planRecord(model, {
      values: { name: 'Red Kettle', status: 'Open' },
      filterKeys: keys,
      filterValues: { status: 'Open', name: 'red kettle' },
    }),
    { action: 'current' },
  )
  check(
    're-stamps a record whose values moved, dropping a cleared entry',
    planRecord(model, {
      values: { status: 'Open' },
      filterKeys: keys,
      filterValues,
    }).write?.filterValues,
    { status: 'Open' },
  )
  check(
    'a number stored as text is stamped as the number',
    planRecord(
      { order: ['price'], fields: { price: { name: 'Price', type: 'float' } } },
      { values: { price: '19.50' }, filterKeys: ['f:price=19.5'] },
    ),
    { action: 'update', write: { filterValues: { price: 19.5 } } },
  )
  check(
    'removes both fields from a record with nothing filterable',
    planRecord(model, { values: {}, filterKeys: ['s:x'], filterValues: { name: 'x' } }),
    { action: 'update', write: { filterKeys: null, filterValues: null } },
  )
  check(
    'leaves a record with nothing filterable and no fields alone',
    planRecord(model, { values: {} }),
    { action: 'current' },
  )
  check(
    'skips a record whose values are not a map',
    planRecord(model, { values: 'oops' }),
    { action: 'skip', reason: '`values` is not a map' },
  )
  check(
    'derives a v1 model from its `fields` list',
    datasetFilterKeys(effectiveModel({ fields: ['email'] }), {
      email: 'A@B.co',
    }).includes('f:email=a@b.co'),
    true,
  )
  check(
    'a v1 column no query path can name gets no filterValues entry',
    datasetFilterValues(effectiveModel({ fields: ['e.mail', 'Unit price'] }), {
      'e.mail': 'A@B.co',
      'Unit price': 'Four',
    }),
    { 'Unit price': 'four' },
  )
  check(
    'the source guard reads a matching rule',
    modelShimAgrees(
      'export function effectiveDatasetModel(dataset) { if (dataset.model?.fields && dataset.model.order?.length) {} return deriveModelFromFields(dataset.fields ?? []) }',
    ).ok,
    true,
  )
  check(
    'the source guard refuses a changed rule',
    modelShimAgrees(
      'export function effectiveDatasetModel(dataset) { return dataset.model }',
    ).ok,
    false,
  )

  for (const entry of cases) {
    console.log(
      `${entry.ok ? 'ok  ' : 'FAIL'} ${entry.name}` +
        (entry.ok ? '' : ` — got ${JSON.stringify(entry.actual)}`),
    )
  }
  const failed = cases.filter((entry) => !entry.ok).length
  console.log(`\n${cases.length - failed}/${cases.length} passed`)
  const live = modelShimAgrees()
  console.log(
    `\nthis tree: ${live.ok ? 'may be applied against' : 'REFUSED'} — ${live.why}`,
  )
  if (failed || !live.ok) process.exitCode = 1
}

if (args.selfTest) runSelfTest()
else await run()
