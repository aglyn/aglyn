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
 * The agency scenario, end to end against a real Firestore (AGL-1047).
 *
 * The rules tests cover the CLIENT's direct access. This covers the half
 * they cannot reach: the Admin-SDK server paths, which never evaluate
 * rules and are where the original leak lived. A page render is the only
 * thing that proves a client site cannot show another client's rows.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set, so a normal run is
 * unaffected and this can never touch production. Start the emulator
 * (docs/E2E_LOCAL.md), then:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c libs/tenant/runtime/jest.config.ts \
 *       --testPathPatterns scoped-sharing
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

const ORG = 'e2e-agency'
const INTERNAL = 'e2e-internal-1'
const CLIENT = 'e2e-client-1'

if (EMULATED && !getApps().length) {
  initializeApp({ projectId: 'aglyn-main' })
}

const describeEmulated = EMULATED ? describe : describe.skip

describeEmulated('scoped sharing, agency scenario (AGL-1047)', () => {
  let db: Firestore
  let getDatasets: typeof import('./get-datasets').getDatasets
  let resolveDatasetDoc: typeof import('./resolve-dataset').resolveDatasetDoc

  beforeAll(async () => {
    db = getFirestore()
    await seed(db)
    getDatasets = (await import('./get-datasets')).getDatasets
    resolveDatasetDoc = (await import('./resolve-dataset')).resolveDatasetDoc
  }, 60_000)

  it('a client site renders only what it may see', async () => {
    const datasets = await getDatasets({ hostId: CLIENT })
    const names = Object.keys(datasets)
    expect(names).toContain('Shared Brand')
    expect(names).toContain('Client Products')
    // The agency's internal rates must not be reachable from a client site.
    expect(names).not.toContain('Internal Rates')
  }, 60_000)

  it('an internal site still sees the internal data', async () => {
    const datasets = await getDatasets({ hostId: INTERNAL })
    expect(Object.keys(datasets)).toContain('Internal Rates')
  }, 60_000)

  it('THE LEAK: a shared display name resolves per site, not globally', async () => {
    // Both sites bind a repeatable to "Products". Each must get its own.
    // This is the shape the original bug took: the map was keyed by
    // displayName across the whole org, so whichever loaded last won.
    const clientSets = await getDatasets({ hostId: CLIENT })
    const internalSets = await getDatasets({ hostId: INTERNAL })
    expect(clientSets['Products']?.records?.[0]?.['name']).toBe('client-row')
    expect(internalSets['Products']?.records?.[0]?.['name']).toBe(
      'internal-row',
    )
  }, 60_000)

  it('a form cannot append to a dataset its site cannot see', async () => {
    const ref = db.collection('orgs').doc(ORG).collection('datasets')
    // By id — the direct attempt.
    expect(
      await resolveDatasetDoc(ref, { datasetId: 'ds-internal' }, CLIENT),
    ).toBeUndefined()
    // By name — the sneaky one, since "Products" exists on both sides.
    const byName = await resolveDatasetDoc(
      ref,
      { datasetName: 'Products' },
      CLIENT,
    )
    expect(byName?.id).toBe('ds-client-products')
  }, 60_000)

  it('the same lookups still work for the site that owns the data', async () => {
    const ref = db.collection('orgs').doc(ORG).collection('datasets')
    expect(
      (await resolveDatasetDoc(ref, { datasetId: 'ds-internal' }, INTERNAL))?.id,
    ).toBe('ds-internal')
  }, 60_000)
})

async function seed(db: Firestore): Promise<void> {
  const org = db.collection('orgs').doc(ORG)
  await org.set({ name: 'Agency', hosts: { [INTERNAL]: true, [CLIENT]: true } })
  for (const hostId of [INTERNAL, CLIENT]) {
    await db.collection('hostIndex').doc(hostId).set({ orgId: ORG })
    await db.collection('hosts').doc(hostId).set({ orgId: ORG })
  }
  const datasets: Array<[string, Record<string, unknown>, string?]> = [
    ['ds-brand', { displayName: 'Shared Brand', visibleTo: ['org'] }],
    [
      'ds-internal',
      { displayName: 'Internal Rates', visibleTo: [`host:${INTERNAL}`] },
    ],
    [
      'ds-client-products',
      { displayName: 'Products', visibleTo: [`host:${CLIENT}`] },
      'client-row',
    ],
    [
      'ds-internal-products',
      { displayName: 'Products', visibleTo: [`host:${INTERNAL}`] },
      'internal-row',
    ],
    [
      'ds-client-only',
      { displayName: 'Client Products', visibleTo: [`host:${CLIENT}`] },
    ],
  ]
  for (const [id, data, row] of datasets) {
    await org.collection('datasets').doc(id).set({ fields: ['name'], ...data })
    if (row) {
      await org
        .collection('datasets')
        .doc(id)
        .collection('records')
        .doc('r1')
        .set({ values: { name: row }, order: 0 })
    }
  }
}
