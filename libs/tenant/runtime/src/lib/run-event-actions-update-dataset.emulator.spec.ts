/**
 * @jest-environment node
 */

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
 * `updateDataset` against a real Firestore (AGL-2773).
 *
 * The step is update-or-append: it looks for the record whose `values.email`
 * equals the event's email, merges into it, and appends only when nothing
 * matches. The mocked specs beside this one answer that lookup with whatever
 * the fixture holds, so they cannot see either way it breaks for real:
 *
 * - a `where` that matches nothing appends a duplicate row, and the run still
 *   reads as a success;
 * - a `where` Firestore refuses to plan throws. `records.values` is exempt from
 *   single-field indexing in `cloud/firebase-firestore.indexes.json`, because
 *   dataset fields are user-defined and indexing an unbounded map exceeds the
 *   per-document index-entry limit. Every key under `values` inherits that
 *   exemption, so production refuses the lookup outright:
 *
 *     FAILED_PRECONDITION: The query requires a COLLECTION_ASC index for
 *     collection records and field values.email.
 *
 *   The step records that as a step error, and neither the merge nor the
 *   append runs.
 *
 * ## Why the emulator alone is not the index check
 *
 * The Firestore emulator runs any valid query and never reads the index file.
 * Measured on emulator v1.21.0 (firebase-tools 15.24.0) with `firebase.json`
 * pointing at the index file, these all returned rows: the exempt-field
 * lookup, an equality filter plus an orderBy on another field (a composite in
 * production), and a collection-group filter (a COLLECTION_GROUP index in
 * production). A green emulator run says nothing about whether production can
 * plan the query.
 *
 * So this spec records every query the step sends to a `records` collection
 * and judges each against the index file, using the rules Firestore applies to
 * a query on a single field:
 *
 * - the most specific field override wins;
 * - a map field's override is inherited by every key beneath it;
 * - a field with no override has the automatic indexes, which exist at
 *   COLLECTION scope only.
 *
 * A shape those rules do not decide (more than one filter, an inequality, an
 * orderBy, an OR) fails as undecided rather than passing unjudged.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. Start the emulator
 * (`npm run firebase:emulate`), then:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c libs/tenant/runtime/jest.config.ts \
 *       --testPathPatterns run-event-actions-update-dataset.emulator
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getApps, initializeApp } from 'firebase-admin/app'
import { Query, getFirestore, type Firestore } from 'firebase-admin/firestore'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

const ORG = 'e2e-update-dataset-org'
const HOST = 'e2e-update-dataset-host'
const DATASET = 'e2e-update-dataset-leads'
const EVENT = 'formSubmission'
const KNOWN_EMAIL = 'ada@example.com'

if (EMULATED && !getApps().length) {
  initializeApp({ projectId: 'aglyn-main' })
}

const describeEmulated = EMULATED ? describe : describe.skip

interface SingleFieldIndex {
  queryScope?: string
  order?: string
  arrayConfig?: string
}

interface FieldOverride {
  collectionGroup: string
  fieldPath: string
  indexes?: SingleFieldIndex[]
}

const INDEX_FILE: { fieldOverrides: FieldOverride[] } = JSON.parse(
  readFileSync(
    join(__dirname, '../../../../../cloud/firebase-firestore.indexes.json'),
    'utf8',
  ),
)

/** Firestore's automatic single-field indexes for a field with no override. */
const AUTOMATIC_INDEXES: SingleFieldIndex[] = [
  { queryScope: 'COLLECTION', order: 'ASCENDING' },
  { queryScope: 'COLLECTION', order: 'DESCENDING' },
  { queryScope: 'COLLECTION', arrayConfig: 'CONTAINS' },
]

const EQUALITY_OPS = new Set(['EQUAL', 'IN', 'IS_NULL', 'IS_NAN'])
const CONTAINS_OPS = new Set(['ARRAY_CONTAINS', 'ARRAY_CONTAINS_ANY'])

/** The parts of a `StructuredQuery` proto the rules above read. */
interface ProtoFilter {
  fieldFilter?: { field: { fieldPath: string }; op: string }
  unaryFilter?: { field: { fieldPath: string }; op: string }
  compositeFilter?: { op: string; filters: ProtoFilter[] }
}

interface ProtoQuery {
  from?: Array<{ collectionId?: string; allDescendants?: boolean }>
  where?: ProtoFilter
  orderBy?: Array<{ field: { fieldPath: string } }>
}

/** One query as the SDK sent it. */
interface SentQuery {
  collectionId: string
  scope: 'COLLECTION' | 'COLLECTION_GROUP'
  filters: Array<{ fieldPath: string; op: string }>
  orderBy: string[]
  /** Why the rules cannot judge this query, when they cannot. */
  undecided?: string
}

function readProto(proto: ProtoQuery | undefined): SentQuery {
  const source = proto?.from?.[0]
  const sent: SentQuery = {
    collectionId: source?.collectionId ?? '',
    scope: source?.allDescendants ? 'COLLECTION_GROUP' : 'COLLECTION',
    filters: [],
    orderBy: (proto?.orderBy ?? []).map((order) => order.field.fieldPath),
  }
  const visit = (filter: ProtoFilter | undefined): void => {
    if (!filter) return
    if (filter.compositeFilter) {
      if (filter.compositeFilter.op !== 'AND') {
        sent.undecided = `an ${filter.compositeFilter.op} filter`
        return
      }
      filter.compositeFilter.filters.forEach(visit)
      return
    }
    const leaf = filter.fieldFilter ?? filter.unaryFilter
    if (leaf) sent.filters.push({ fieldPath: leaf.field.fieldPath, op: leaf.op })
  }
  visit(proto?.where)
  return sent
}

/** The single-field indexes the index file gives one field. */
function singleFieldIndexes(
  collectionGroup: string,
  fieldPath: string,
): { indexes: SingleFieldIndex[]; source: string } {
  const override = INDEX_FILE.fieldOverrides
    .filter(
      (entry) =>
        entry.collectionGroup === collectionGroup &&
        (entry.fieldPath === fieldPath ||
          fieldPath.startsWith(`${entry.fieldPath}.`)),
    )
    .sort((a, b) => b.fieldPath.length - a.fieldPath.length)[0]
  return override
    ? {
        indexes: override.indexes ?? [],
        source: `the override on ${collectionGroup}.${override.fieldPath}`,
      }
    : { indexes: AUTOMATIC_INDEXES, source: 'automatic indexing' }
}

/**
 * Why production would refuse to plan this query from the index file, or
 * null when the file serves it.
 */
function planRefusal(query: SentQuery): string | null {
  const label =
    `${query.scope} ${query.collectionId} where ` +
    (query.filters.map((f) => `${f.fieldPath} ${f.op}`).join(' AND ') ||
      '(no filter)')
  if (query.undecided) return `${label}: undecided, ${query.undecided}`
  const ordered = query.orderBy.filter((path) => path !== '__name__')
  if (ordered.length || query.filters.length > 1) {
    return `${label}: undecided, more than one field or an orderBy`
  }
  const [filter] = query.filters
  if (!filter) return null
  if (!EQUALITY_OPS.has(filter.op) && !CONTAINS_OPS.has(filter.op)) {
    return `${label}: undecided, an inequality`
  }
  const contains = CONTAINS_OPS.has(filter.op)
  const { indexes, source } = singleFieldIndexes(
    query.collectionId,
    filter.fieldPath,
  )
  const served = indexes.some(
    (index) =>
      (index.queryScope ?? 'COLLECTION') === query.scope &&
      (contains ? index.arrayConfig === 'CONTAINS' : Boolean(index.order)),
  )
  if (served) return null
  return (
    `${label}: needs a ${query.scope} ${contains ? 'CONTAINS' : 'ASCENDING'} ` +
    `index on ${filter.fieldPath}, and ${source} ` +
    (indexes.length ? 'declares none that serves it' : 'exempts it from indexing')
  )
}

/** Every query sent since the last reset, in order. */
const sentQueries: SentQuery[] = []

type Sendable = { toProto(): { structuredQuery?: ProtoQuery } }
type Gettable = { get(this: unknown): Promise<unknown> }

/**
 * Records each query before the SDK sends it. The real `get` always runs, so
 * the step sees exactly the Firestore it would without the recorder.
 */
function recordQueriesSentThrough(
  prototype: object,
  queryOf: (target: unknown) => Sendable,
): () => void {
  const target = prototype as Gettable
  const realGet = target.get
  target.get = function (this: unknown) {
    try {
      sentQueries.push(readProto(queryOf(this).toProto().structuredQuery))
    } catch (error) {
      sentQueries.push({
        collectionId: '',
        scope: 'COLLECTION',
        filters: [],
        orderBy: [],
        undecided: `the query could not be read: ${(error as Error).message}`,
      })
    }
    return realGet.call(this)
  }
  return () => {
    target.get = realGet
  }
}

async function seed(db: Firestore): Promise<void> {
  const org = db.collection('orgs').doc(ORG)
  const host = db.collection('hosts').doc(HOST)
  await db.recursiveDelete(org)
  await db.recursiveDelete(host)
  // Pro carries `actions` and a finite row band, so the append leg also takes
  // its capacity read.
  await org.set({ name: 'Update dataset', plan: 'pro', hosts: { [HOST]: true } })
  await db.collection('hostIndex').doc(HOST).set({ orgId: ORG })
  await host.set({ orgId: ORG })
  await host
    .collection('actions')
    .doc('upsert-lead')
    .set({
      name: 'Upsert the lead',
      enabled: true,
      trigger: { event: EVENT },
      steps: [{ type: 'updateDataset', datasetId: DATASET }],
    })
  const dataset = org.collection('datasets').doc(DATASET)
  await dataset.set({
    displayName: 'Leads',
    visibleTo: ['org'],
    fields: ['email', 'name', 'company'],
  })
  await dataset
    .collection('records')
    .doc('ada')
    .set({
      values: {
        email: KNOWN_EMAIL,
        name: 'Ada',
        company: 'Analytical Engines',
      },
    })
}

describeEmulated('updateDataset against a real Firestore (AGL-2773)', () => {
  let db: Firestore
  let runEventActions: typeof import('./run-event-actions').runEventActions
  const restores: Array<() => void> = []

  const records = () =>
    db
      .collection('orgs')
      .doc(ORG)
      .collection('datasets')
      .doc(DATASET)
      .collection('records')

  const runResults = async () =>
    (await db.collection('hosts').doc(HOST).collection('activity').get()).docs
      .map((doc) => doc.get('result'))

  beforeAll(async () => {
    db = getFirestore()
    await seed(db)
    runEventActions = (await import('./run-event-actions')).runEventActions
    restores.push(
      recordQueriesSentThrough(Query.prototype, (target) => target as Sendable),
      // `AggregateQuery` is exported as a type only, so its prototype is taken
      // from an instance.
      recordQueriesSentThrough(
        Object.getPrototypeOf(records().count()),
        (target) => (target as { query: unknown }).query as Sendable,
      ),
    )
  }, 60_000)

  afterAll(() => {
    for (const restore of restores) restore()
  })

  beforeEach(() => {
    sentQueries.length = 0
  })

  it('merges into the record whose email matches, and appends nothing', async () => {
    await runEventActions(HOST, EVENT, {
      email: KNOWN_EMAIL,
      name: 'Ada Lovelace',
    })

    const rows = await records().get()
    expect(rows.size).toBe(1)
    expect(rows.docs[0].get('values')).toEqual({
      email: KNOWN_EMAIL,
      name: 'Ada Lovelace',
      company: 'Analytical Engines',
    })
    expect(await runResults()).toEqual(['succeeded'])
  }, 60_000)

  it('appends a row when no record carries the email', async () => {
    await runEventActions(HOST, EVENT, {
      email: 'grace@example.com',
      name: 'Grace',
    })

    const emails = (await records().get()).docs
      .map((doc) => doc.get('values.email'))
      .sort()
    expect(emails).toEqual([KNOWN_EMAIL, 'grace@example.com'])
  }, 60_000)

  it('sends records only queries the index file lets production plan', async () => {
    // Both legs: the merge sends the lookup, and the append sends the lookup
    // plus the row count its capacity check reads.
    await runEventActions(HOST, EVENT, { email: KNOWN_EMAIL, name: 'Ada' })
    await runEventActions(HOST, EVENT, {
      email: 'hopper@example.com',
      name: 'Grace Hopper',
    })

    const recordQueries = sentQueries.filter(
      (query) => query.collectionId === 'records',
    )
    // The recorder has to have seen the lookup. An empty list would pass the
    // assertion below without judging anything.
    expect(
      recordQueries.some((query) =>
        query.filters.some((filter) => filter.fieldPath === 'values.email'),
      ),
    ).toBe(true)
    expect(recordQueries.map(planRefusal).filter(Boolean)).toEqual([])
  }, 60_000)
})
