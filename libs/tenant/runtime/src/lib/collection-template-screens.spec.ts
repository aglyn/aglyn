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

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: jest.fn() },
}))

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  COLLECTION_TEMPLATE_SCREEN_FIELDS,
  collectTemplateScreenIds,
  getCollectionTemplateScreenIds,
} from './collection-template-screens'

const snapshotOf = (docs: Array<Record<string, unknown>>) => ({
  docs: docs.map((fields) => ({ get: (field: string) => fields[field] })),
})

describe('collectTemplateScreenIds (AGL-1267)', () => {
  it('collects list, entry and legacy template ids', () => {
    const ids = collectTemplateScreenIds(
      snapshotOf([
        { listScreenId: 'list-1', entryScreenId: 'entry-1' },
        // A host predating the AGL-551 list/entry split.
        { templateScreenId: 'legacy-1' },
      ]),
    )

    expect([...ids].sort()).toEqual(['entry-1', 'legacy-1', 'list-1'])
  })

  it('ignores unset, blank and non-string fields', () => {
    const ids = collectTemplateScreenIds(
      snapshotOf([
        { listScreenId: '', entryScreenId: null, templateScreenId: undefined },
        { listScreenId: 42 },
        {},
      ]),
    )

    expect(ids.size).toBe(0)
  })
})

describe('getCollectionTemplateScreenIds (AGL-1267)', () => {
  const query = {
    select: jest.fn(() => query),
    limit: jest.fn(() => query),
    get: jest.fn(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
    ;(firebaseAdmin.app as jest.Mock).mockReturnValue({
      firestore: () => ({
        collection: () => ({ doc: () => ({ collection: () => query }) }),
      }),
    })
  })

  it('projects onto exactly the three template fields', async () => {
    query.get.mockResolvedValue(snapshotOf([{ entryScreenId: 'entry-1' }]))

    const ids = await getCollectionTemplateScreenIds({ hostId: 'host-1' })

    expect(ids.has('entry-1')).toBe(true)
    expect(query.select).toHaveBeenCalledWith(
      ...COLLECTION_TEMPLATE_SCREEN_FIELDS,
    )
  })

  it('fails OPEN with an empty set', async () => {
    // This read sits on the critical path of every tenant page render. A
    // transient Firestore error must degrade to "the template is briefly
    // reachable again", never to a site-wide 404.
    query.get.mockRejectedValue(new Error('deadline exceeded'))
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    await expect(
      getCollectionTemplateScreenIds({ hostId: 'host-1' }),
    ).resolves.toEqual(new Set())

    consoleError.mockRestore()
  })
})
