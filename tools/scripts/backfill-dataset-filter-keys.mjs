/**
 * Stamp `filterKeys` onto the dataset records written before the field.
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
 * ## What the field is
 *
 * A record's `filterKeys` is the token array the records table's Filters
 * panel and quick search query with `array-contains` (see
 * `libs/aglyn/src/lib/app-utils/dataset-filter-keys.ts`). Every writer stamps
 * it now, through `datasetIntegrityFields` / `datasetIntegrityUpdate`; a
 * record written before that carries none, and so answers no served filter
 * until it is edited or this script reaches it.
 *
 * It needs no index deploy: Firestore's automatic single-field index serves
 * the query. This script is the only step an existing project needs.
 *
 * ## What it touches
 *
 * Every `records` collection under `orgs/{orgId}/datasets/{id}` and the
 * legacy `hosts/{hostId}/datasets/{id}`. It reads each dataset's `model` (or
 * derives one from a v1 `fields` list, exactly as the writers do), computes
 * each record's tokens from its `values`, and UPDATES `filterKeys` alone —
 * nothing else on the record changes, and nothing is ever deleted except the
 * field itself on a record that no longer has a filterable value.
 *
 * ## Idempotence and interruption
 *
 * A record whose stored `filterKeys` already equals the computed array is
 * counted as current and not written, so a second run writes nothing. Writes
 * are one field per document in batches of {@link BATCH_SIZE}, so an
 * interruption leaves a partially stamped dataset — which is exactly what a
 * re-run finishes. Re-running after a schema change re-stamps the records
 * whose tokens the change moved (a text field made an enum, a field
 * removed).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseDeployArgs } from './lib/deploy-args.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')
const APP_UTILS = join(REPO_ROOT, 'libs', 'aglyn', 'src', 'lib', 'app-utils')

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
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
    { flag: '--org', key: 'org', value: 'string', describe: 'Limit to one organization.' },
  ],
})

/** Records read, and at most written, per batch. Firestore allows 500. */
const BATCH_SIZE = 400

/*
 * The token builder, imported from its TypeScript source under Node's type
 * stripping: the file takes type-only imports for exactly this reason, and
 * its spec holds it to that. One implementation, so the backfill cannot
 * stamp a spelling the writers and the query do not use.
 */
const { datasetFilterKeys } = await import(
  pathToFileURL(join(APP_UTILS, 'dataset-filter-keys.ts')).href
)

/**
 * `effectiveDatasetModel`, restated — KEEP IN SYNC with
 * `libs/aglyn/src/lib/app-utils/dataset-models.ts` (checked by
 * {@link modelShimAgrees} in the self-test).
 *
 * `dataset-models.ts` itself cannot be imported here: it imports other
 * modules at run time, which type stripping does not resolve. Only field ids
 * and types reach the tokens, so the v1 shim is reduced to those: every v1
 * column is a text field.
 */
function effectiveModel(dataset) {
  const model = dataset.model
  if (model?.fields && model.order?.length) return model
  const fields = Array.isArray(dataset.fields) ? dataset.fields : []
  return {
    fields: Object.fromEntries(fields.map((name) => [name, { name, type: 'text' }])),
    order: [...fields],
  }
}

/** The source guard: the shim above still restates the library's rule. */
function modelShimAgrees(source) {
  const code = source ?? readFileSync(join(APP_UTILS, 'dataset-models.ts'), 'utf8')
  const at = code.indexOf('export function effectiveDatasetModel(')
  if (at < 0) {
    return { ok: false, why: '`effectiveDatasetModel` not found in dataset-models.ts' }
  }
  const body = code.slice(at, at + 400)
  const ok =
    body.includes('dataset.model?.fields && dataset.model.order?.length') &&
    body.includes('deriveModelFromFields(dataset.fields ?? [])')
  return {
    ok,
    why: ok
      ? '`effectiveDatasetModel` matches the shim'
      : '`effectiveDatasetModel` changed — update `effectiveModel` here',
  }
}

const sameKeys = (left, right) =>
  left.length === right.length && left.every((key, at) => key === right[at])

/**
 * One record's verdict, so the dry run and the apply run cannot disagree.
 * `write` is the array to store, or `null` to remove the field.
 */
export function planRecord(model, data) {
  const values = data?.values
  if (values != null && (typeof values !== 'object' || Array.isArray(values))) {
    return { action: 'skip', reason: '`values` is not a map' }
  }
  const computed = datasetFilterKeys(model, values ?? undefined)
  const stored = data?.filterKeys
  if (stored !== undefined && !Array.isArray(stored)) {
    return { action: 'update', write: computed.length ? computed : null }
  }
  if (sameKeys(stored ?? [], computed)) return { action: 'current' }
  return { action: 'update', write: computed.length ? computed : null }
}

async function run() {
  const guard = modelShimAgrees()
  if (!guard.ok) {
    console.error(`REFUSED — ${guard.why}`)
    process.exitCode = 1
    return
  }
  const { applicationDefault, initializeApp } = await import('firebase-admin/app')
  const { FieldValue, FieldPath, getFirestore } = await import('firebase-admin/firestore')
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || undefined
  initializeApp({ credential: applicationDefault(), ...(projectId ? { projectId } : {}) })
  const firestore = getFirestore()
  console.log(
    `project: ${projectId ?? '(from the credentials)'} · ${args.apply ? 'APPLY' : 'dry run'}` +
      (args.org ? ` · org ${args.org}` : ''),
  )

  const datasetDocs = args.org
    ? (await firestore.collection('orgs').doc(args.org).collection('datasets').get()).docs
    : (await firestore.collectionGroup('datasets').get()).docs

  const totals = { datasets: 0, scanned: 0, current: 0, updated: 0, skipped: 0 }
  const skipReasons = new Map()
  const skip = (reason, count = 1) => {
    totals.skipped += count
    skipReasons.set(reason, (skipReasons.get(reason) ?? 0) + count)
  }

  for (const datasetDoc of datasetDocs) {
    // `datasets` under anything but an org or a site is not a dataset store.
    const owner = datasetDoc.ref.parent.parent
    const ownerCollection = owner?.parent?.id
    if (!owner || (ownerCollection !== 'orgs' && ownerCollection !== 'hosts')) continue
    totals.datasets += 1
    const model = effectiveModel({
      model: datasetDoc.get('model'),
      fields: datasetDoc.get('fields'),
    })
    const recordsRef = datasetDoc.ref.collection('records')
    const counts = { scanned: 0, current: 0, updated: 0, skipped: 0 }
    let cursor = null
    for (;;) {
      // Paged by document name: every record has one, so the walk is total.
      let pageQuery = recordsRef
        .orderBy(FieldPath.documentId())
        .select('values', 'filterKeys')
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
          batch.update(recordDoc.ref, {
            filterKeys: verdict.write ?? FieldValue.delete(),
          })
        }
      }
      if (args.apply && writes) await batch.commit()
      cursor = page.docs[page.docs.length - 1]
      if (page.size < BATCH_SIZE) break
    }
    totals.scanned += counts.scanned
    totals.current += counts.current
    totals.updated += counts.updated
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
      `${args.apply ? 'updated' : 'would be updated'}, ${totals.skipped} skipped`,
  )
  for (const [reason, count] of skipReasons) console.log(`  skipped ${count}: ${reason}`)
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
      status: { name: 'Status', type: 'text', validation: { options: ['Open'] } },
    },
  }
  const keys = datasetFilterKeys(model, { name: 'Red Kettle', status: 'Open' })

  check(
    'imports the token builder from its TypeScript source',
    keys.includes('f:status=Open') && keys.includes('f:name^kett') && keys.includes('s:red'),
    true,
  )
  check(
    'stamps a record that carries no tokens',
    planRecord(model, { values: { name: 'Red Kettle', status: 'Open' } }),
    { action: 'update', write: keys },
  )
  check(
    'is idempotent: a stamped record is current',
    planRecord(model, { values: { name: 'Red Kettle', status: 'Open' }, filterKeys: keys }),
    { action: 'current' },
  )
  check(
    're-stamps a record whose values moved',
    planRecord(model, { values: { status: 'Open' }, filterKeys: keys }).action,
    'update',
  )
  check(
    'removes the field from a record with nothing filterable',
    planRecord(model, { values: {}, filterKeys: ['s:x'] }),
    { action: 'update', write: null },
  )
  check(
    'leaves a record with nothing filterable and no field alone',
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
    datasetFilterKeys(effectiveModel({ fields: ['email'] }), { email: 'A@B.co' }).includes(
      'f:email=a@b.co',
    ),
    true,
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
    modelShimAgrees('export function effectiveDatasetModel(dataset) { return dataset.model }').ok,
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
  console.log(`\nthis tree: ${live.ok ? 'may be applied against' : 'REFUSED'} — ${live.why}`)
  if (failed || !live.ok) process.exitCode = 1
}

if (args.selfTest) runSelfTest()
else await run()
