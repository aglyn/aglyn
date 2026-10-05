/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock.
 *
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

// A factory, not a bare `jest.mock`: an auto-mock still evaluates the real
// module graph, and the restore under test never reads through it.
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => ({}) }) },
  scopedToHost: (ref: unknown) => ref,
}))

import { listDeclaredSiteBundleSections } from '@aglyn/aglyn/plugin-manager/plugin-site-bundle'
import type { SiteBundleImportRequest } from '@aglyn/aglyn/plugin-manager/plugin-site-bundle'
import {
  DATASET_RESTORE_FIELDS,
  importSiteDatasets,
  RECORD_RESTORE_FIELDS,
  siteDatasetsRefusal,
} from './datasets-site-bundle.server'

/**
 * A site's datasets in its whole-site backup (AGL-3080): the restore half,
 * driven through the writer the console's restore hands the section.
 *
 * The round trip end to end — export, JSON, restore, every field back — is
 * the console's `site-export-round-trip.spec.ts`, which runs this section
 * through the answers registered from the plugin's declarations. What only
 * this file can hold is the plugin's own lists: that every key on them is one
 * a live dataset or record carries (AGL-1384), and that nothing else lands.
 */

/** A dataset with every key a live one carries, as the export writes it. */
const DATASET = {
  $id: 'dataset-1',
  displayName: 'Roasts',
  name: 'Roasts',
  fields: ['roast'],
  model: {
    fields: { roast: { name: 'Roast', type: 'text', required: true } },
    order: ['roast'],
  },
  names: { singular: 'Roast', plural: 'Roasts' },
  description: 'Coffee roast levels',
  source: { type: 'marketplace', listingId: 'listing-2', version: '1.0.0' },
  installedFrom: { listingId: 'listing-2', version: '1.0.0', sha256: 'def456' },
  detachedFrom: { listingId: 'listing-3', version: '0.9.0' },
}

/** A record with every key a live one carries. */
const RECORD = { $id: 'record-1', values: { roast: 'Dark' }, order: 4 }

const STAMPS = { createdAt: 'stamp:created', updatedAt: 'stamp:updated' }

function restoreInto(overrides: Partial<SiteBundleImportRequest> = {}) {
  const writes: Array<{ path: string; data: Record<string, unknown> }> = []
  const loadPluginSurfaces = jest.fn(async () => undefined)
  const request: SiteBundleImportRequest = {
    hostId: 'host-1',
    orgId: 'org-1',
    org: { plan: 'pro' },
    limit: 50,
    items: [],
    write: async (path, data) => {
      writes.push({ path, data })
    },
    stamps: () => ({ ...STAMPS }),
    loadPluginSurfaces,
    ...overrides,
  }
  return { request, writes, loadPluginSurfaces }
}

describe('the data plugin declares its section of the backup', () => {
  it('as `datasets`, so a bundle carries them under the key it always has', () => {
    expect(listDeclaredSiteBundleSections()).toContainEqual(
      expect.objectContaining({ pluginId: 'data', key: 'datasets', limit: 50 }),
    )
  })
})

describe('restoring a site’s datasets', () => {
  it('writes every restore field back, with the restore’s stamps and a fresh site scope', async () => {
    const { request, writes } = restoreInto({
      items: [{ ...DATASET, records: [RECORD] }],
    })
    await importSiteDatasets(request)

    const dataset = writes.find((entry) => entry.path === 'orgs/org-1/datasets/dataset-1')
    expect(dataset).toBeDefined()
    for (const field of DATASET_RESTORE_FIELDS) {
      expect({ field, value: dataset?.data[field] }).toEqual({
        field,
        value: (DATASET as Record<string, unknown>)[field],
      })
    }
    expect(dataset?.data).toMatchObject(STAMPS)
    expect(dataset?.data['visibleTo']).toEqual(['host:host-1'])

    const record = writes.find(
      (entry) => entry.path === 'orgs/org-1/datasets/dataset-1/records/record-1',
    )
    expect(record?.data).toMatchObject({ values: { roast: 'Dark' }, order: 4, ...STAMPS })
  })

  it('stores nothing the bundle adds: no tombstone, no foreign scope, no unknown key', async () => {
    const { request, writes } = restoreInto({
      items: [
        {
          ...DATASET,
          visibleTo: ['org'],
          deletedAt: 1,
          injected: true,
          records: [{ ...RECORD, deletedAt: 1, referencedIds: ['forged'] }],
        },
      ],
    })
    await importSiteDatasets(request)

    const [dataset, record] = writes
    expect(dataset.data['visibleTo']).toEqual(['host:host-1'])
    expect(dataset.data).not.toHaveProperty('deletedAt')
    expect(dataset.data).not.toHaveProperty('injected')
    expect(record.data).not.toHaveProperty('deletedAt')
    // The integrity index is derived from the restored values, never carried.
    expect(record.data).not.toHaveProperty('referencedIds')
  })

  it('restores a record that does not conform AND reports it', async () => {
    const { request, writes } = restoreInto({
      items: [{ ...DATASET, records: [{ $id: 'record-2', values: {} }] }],
    })
    const report = await importSiteDatasets(request)

    expect(writes.map((entry) => entry.path)).toContain(
      'orgs/org-1/datasets/dataset-1/records/record-2',
    )
    expect(report).toEqual([
      { datasetId: 'dataset-1', recordId: 'record-2', errors: { roast: 'Roast is required' } },
    ])
  })

  it('asks for the plugins to load only when a model names a custom field type', async () => {
    const plain = restoreInto({ items: [DATASET] })
    await importSiteDatasets(plain.request)
    expect(plain.loadPluginSurfaces).not.toHaveBeenCalled()

    const rated = restoreInto({
      items: [
        {
          ...DATASET,
          model: {
            fields: { stars: { name: 'Stars', type: 'int32', customType: 'rating' } },
            order: ['stars'],
          },
        },
      ],
    })
    await importSiteDatasets(rated.request)
    expect(rated.loadPluginSurfaces).toHaveBeenCalledTimes(1)
  })

  it('writes nothing for a site with no organization, which holds no datasets', async () => {
    const { request, writes } = restoreInto({ orgId: null, items: [DATASET] })
    expect(await importSiteDatasets(request)).toEqual([])
    expect(writes).toEqual([])
    expect(await siteDatasetsRefusal({ ...request, orgId: null })).toBeNull()
  })
})

describe('every restore field is one a live document carries (AGL-1384)', () => {
  it('names no key the fixtures above cannot point at', () => {
    for (const field of DATASET_RESTORE_FIELDS) expect([field, field in DATASET]).toEqual([field, true])
    for (const field of RECORD_RESTORE_FIELDS) expect([field, field in RECORD]).toEqual([field, true])
  })
})
