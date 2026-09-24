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
 * Org automations against a real Firestore (AGL-3302).
 *
 * The mocked suite beside this one (`run-event-actions-org.spec.ts`) decides
 * placement with a fake that honours the engine's three filters. This one
 * sends the engine's REAL query — an equality on `trigger.event` and on
 * `enabled`, and `array-contains-any` on `visibleTo` — to the emulator, so a
 * shape Firestore refuses to run fails here rather than in production; and it
 * holds that query to the composite index `cloud/firebase-firestore.indexes.json`
 * declares for it, because the emulator plans any valid query without one
 * (see the note in `run-event-actions-update-dataset.emulator.spec.ts`).
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. Start the emulator
 * (`npm run firebase:emulate`), then:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c libs/plugins/workflows/jest.config.ts \
 *       --testPathPatterns run-org-automations.emulator
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getApps, initializeApp } from 'firebase-admin/app'
import { Query, getFirestore, type Firestore } from 'firebase-admin/firestore'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

const ORG = 'e2e-org-automations-org'
const SITE = 'e2e-org-automations-site-a'
const SIBLING = 'e2e-org-automations-site-b'
const EVENT = 'formSubmission'

if (EMULATED && !getApps().length) {
  initializeApp({ projectId: 'aglyn-main' })
}

const describeEmulated = EMULATED ? describe : describe.skip

interface CompositeIndex {
  collectionGroup: string
  queryScope: string
  fields: Array<{ fieldPath: string; order?: string; arrayConfig?: string }>
}

const INDEXES: CompositeIndex[] = JSON.parse(
  readFileSync(
    join(__dirname, '../../../../../../cloud/firebase-firestore.indexes.json'),
    'utf8',
  ),
).indexes

/** One filter of a query as the SDK sent it. */
interface SentFilter {
  fieldPath: string
  op: string
}

interface SentQuery {
  collectionId: string
  filters: SentFilter[]
}

interface ProtoFilter {
  fieldFilter?: { field: { fieldPath: string }; op: string }
  compositeFilter?: { op: string; filters: ProtoFilter[] }
}

function readProto(proto: {
  from?: Array<{ collectionId?: string }>
  where?: ProtoFilter
}): SentQuery {
  const filters: SentFilter[] = []
  const visit = (filter: ProtoFilter | undefined): void => {
    if (!filter) return
    if (filter.compositeFilter) {
      filter.compositeFilter.filters.forEach(visit)
      return
    }
    if (filter.fieldFilter) {
      filters.push({
        fieldPath: filter.fieldFilter.field.fieldPath,
        op: filter.fieldFilter.op,
      })
    }
  }
  visit(proto.where)
  return { collectionId: proto.from?.[0]?.collectionId ?? '', filters }
}

/**
 * Whether the index file declares a COLLECTION composite serving a query of
 * equality and array-membership filters only: the same fields, each with the
 * index kind its filter needs. For such a query field order does not matter —
 * every field is fixed by an equality.
 */
function compositeServes(query: SentQuery): boolean {
  const wanted = new Map(
    query.filters.map((filter) => [
      filter.fieldPath,
      filter.op.startsWith('ARRAY_CONTAINS') ? 'CONTAINS' : 'ASCENDING',
    ]),
  )
  return INDEXES.some(
    (index) =>
      index.collectionGroup === query.collectionId &&
      index.queryScope === 'COLLECTION' &&
      index.fields.length === wanted.size &&
      index.fields.every(
        (field) =>
          wanted.get(field.fieldPath) ===
          (field.arrayConfig === 'CONTAINS' ? 'CONTAINS' : field.order),
      ),
  )
}

const sentQueries: SentQuery[] = []

async function seed(db: Firestore): Promise<void> {
  const org = db.collection('orgs').doc(ORG)
  await db.recursiveDelete(org)
  for (const hostId of [SITE, SIBLING]) {
    await db.recursiveDelete(db.collection('hosts').doc(hostId))
    await db.collection('hostIndex').doc(hostId).set({ orgId: ORG })
    await db.collection('hosts').doc(hostId).set({ orgId: ORG })
  }
  // Pro carries the actions builder.
  await org.set({ name: 'Org automations', plan: 'pro' })
  const automation = (visibleTo: string[], overrides: object = {}) => ({
    name: 'Hand over to the site',
    trigger: { event: EVENT, conditions: null, combinator: null },
    // A custom event: a run with no side effect outside the engine, so the
    // run-history row is the whole observable.
    steps: [{ type: 'customEvent', eventName: 'orgWelcomed' }],
    enabled: true,
    visibleTo,
    pausedHostIds: [],
    deletedAt: null,
    ...overrides,
  })
  await org.collection('automations').doc('every-site').set(automation(['org']))
  await org
    .collection('automations')
    .doc('sibling-only')
    .set(automation([`host:${SIBLING}`]))
  await org
    .collection('automations')
    .doc('paused-here')
    .set(automation(['org'], { pausedHostIds: [SITE] }))
  await org
    .collection('automations')
    .doc('switched-off')
    .set(automation(['org'], { enabled: false }))
}

describeEmulated('org automations against a real Firestore (AGL-3302)', () => {
  let db: Firestore
  let runEventActions: typeof import('./run-event-actions').runEventActions
  let realGet: () => Promise<unknown>

  const runsOn = async (hostId: string) =>
    (await db.collection('hosts').doc(hostId).collection('activity').get()).docs
      .filter((doc) => doc.get('target.type') === 'orgAutomation')
      .map((doc) => doc.get('target.id'))
      .sort()

  beforeAll(async () => {
    db = getFirestore()
    await seed(db)
    runEventActions = (await import('./run-event-actions')).runEventActions
    const prototype = Query.prototype as unknown as {
      get: () => Promise<unknown>
    }
    realGet = prototype.get
    prototype.get = function (this: { toProto(): { structuredQuery: any } }) {
      try {
        sentQueries.push(readProto(this.toProto().structuredQuery))
      } catch {
        // A query the recorder cannot read is still sent.
      }
      return realGet.call(this)
    }
  }, 60_000)

  afterAll(() => {
    ;(Query.prototype as unknown as { get: unknown }).get = realGet
  })

  it('runs on the site it is placed on, and not where it is paused or off', async () => {
    await runEventActions(SITE, EVENT, { email: 'ada@example.com' })

    expect(await runsOn(SITE)).toEqual(['every-site'])
  }, 60_000)

  it('runs the sibling’s own placement on the sibling', async () => {
    await runEventActions(SIBLING, EVENT, { email: 'ada@example.com' })

    expect(await runsOn(SIBLING)).toEqual(['every-site', 'paused-here', 'sibling-only'])
  }, 60_000)

  it('asks with a query the index file lets production plan', async () => {
    sentQueries.length = 0
    await runEventActions(SITE, EVENT, { email: 'grace@example.com' })

    const asked = sentQueries.filter((query) => query.collectionId === 'automations')
    // The recorder has to have seen the engine's query; an empty list would
    // pass the assertion below judging nothing.
    expect(asked.map((query) => query.filters.map((filter) => filter.fieldPath).sort()))
      .toEqual([['enabled', 'trigger.event', 'visibleTo']])
    expect(asked.filter((query) => !compositeServes(query))).toEqual([])
  }, 60_000)
})
