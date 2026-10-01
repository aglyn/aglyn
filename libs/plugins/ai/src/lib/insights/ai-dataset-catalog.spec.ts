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

import { removeStandInDatasetIndex, standInDatasetIndex } from '../testing/stand-in-dataset-index'
import { aiDatasetCatalog } from './ai-dataset-catalog'

/**
 * The datasets an insight question may name (AGL-2915): what the asking
 * member may see, on the site's own terms, read through the `dataset` index
 * the data plugin publishes (AGL-3080) — stood in here, as this plugin may not
 * load the data plugin.
 */

type Data = Record<string, unknown>

/** A Firestore that answers document and collection reads from a flat map of paths. */
function firestoreOf(docs: Record<string, Data>) {
  const snapshot = (path: string) => {
    const data = docs[path]
    return { id: path.split('/').pop() as string, exists: data !== undefined, data: () => data }
  }
  const collection = (path: string): any => ({
    doc: (id: string) => ({
      get: async () => snapshot(`${path}/${id}`),
      collection: (name: string) => collection(`${path}/${id}/${name}`),
    }),
    get: async () => ({
      docs: Object.keys(docs)
        .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .sort()
        .map(snapshot),
    }),
  })
  return { collection } as unknown as FirebaseFirestore.Firestore
}

const DOCS: Record<string, Data> = {
  'orgs/org-1/members/owner': { role: 'owner' },
  'orgs/org-1/members/collab': {
    role: 'editor',
    allHosts: false,
    hostAccess: { 'host-2': 'editor' },
    scopeTokens: ['org', 'host:host-2'],
  },
  'orgs/org-1/datasets/orders': {
    displayName: 'Wholesale orders',
    visibleTo: ['host:host-1'],
    model: {
      order: ['state', 'total'],
      fields: { state: { name: 'State', type: 'text' }, total: { name: 'Order total', type: 'float' } },
    },
  },
  'orgs/org-1/datasets/team': {
    displayName: 'Team',
    visibleTo: ['org'],
    model: { order: ['name'], fields: { name: { name: 'Name', type: 'text' } } },
  },
  'orgs/org-1/datasets/gone': { displayName: 'Old', visibleTo: ['org'], deletedAt: 1 },
}

const firestore = firestoreOf(DOCS)

beforeEach(() => standInDatasetIndex(firestore))
afterEach(() => removeStandInDatasetIndex())

describe('aiDatasetCatalog', () => {
  it('lists what the member may see, by name, with each field', async () => {
    expect(await aiDatasetCatalog(firestore, { orgId: 'org-1', hostId: null, uid: 'owner' })).toEqual([
      { id: 'team', name: 'Team', fields: [{ id: 'name', name: 'Name', type: 'text' }] },
      {
        id: 'orders',
        name: 'Wholesale orders',
        fields: [
          { id: 'state', name: 'State', type: 'text' },
          { id: 'total', name: 'Order total', type: 'float' },
        ],
      },
    ])
  })

  it('on a site, only what is shared with it and the member may see there', async () => {
    const names = async (hostId: string, uid: string | null) =>
      (await aiDatasetCatalog(firestore, { orgId: 'org-1', hostId, uid })).map((entry) => entry.name)
    expect(await names('host-2', 'collab')).toEqual(['Team'])
    expect(await names('host-1', 'owner')).toEqual(['Team', 'Wholesale orders'])
    // A member with no role on the site sees nothing there.
    expect(await names('host-1', 'collab')).toEqual([])
    // With no member, only what every site shares.
    expect(await names('host-1', null)).toEqual(['Team'])
  })

  it('names nothing for someone who is not a member, or where no plugin keeps datasets', async () => {
    expect(await aiDatasetCatalog(firestore, { orgId: 'org-1', hostId: null, uid: 'stranger' })).toEqual([])
    removeStandInDatasetIndex()
    expect(await aiDatasetCatalog(firestore, { orgId: 'org-1', hostId: null, uid: 'owner' })).toEqual([])
  })
})
