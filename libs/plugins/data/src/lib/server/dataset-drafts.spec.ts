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
 * The dataset draft writer (AGL-3616), against the real dataset model and the
 * real plan table: only the Admin SDK and the platform's member, flag and
 * storage reads are doubles.
 *
 *  - THE DOCUMENT is the Data card's: a typed model, the org's Default
 *    sharing, and the seeded records held to the model, each addressed where
 *    a record page wants one.
 *  - THE REFUSAL is the datasets route's: role, `data.manage`, the release
 *    flag, the plan, the dataset allowance — counted inside the create.
 *  - THE WRITE is idempotent under its id.
 */

jest.mock('@aglyn/tenant-data-admin', () => ({ __esModule: true, firebaseAdmin: {} }))
jest.mock('@aglyn/tenant-data-admin/server/data-storage-gate', () => ({ __esModule: true, dataStorageRefusal: jest.fn() }))
jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  memberHasOrgPermission: jest.fn(),
  resolveOrgIdForHost: jest.fn(),
  resolveOrgMembership: jest.fn(),
}))
jest.mock('@aglyn/tenant-data-admin/server/release-flags', () => ({ __esModule: true, isServerReleaseFlagOnForOrg: jest.fn() }))

import { checkDatasetQuota } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { setRegisteringPluginId } from '@aglyn/aglyn/app-utils/registering-plugin'
import { pluginResourceDraftWriter } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { DATASET_IMAGE_FIELD, DATASET_IMAGE_FIELD_TYPE, isDatasetImageValue } from '../model/dataset-image-field'
import { validateDocument, type DatasetModel } from '../model/dataset-models'
import { RECORD_PAGE_ADDRESS_FIELD_TYPE } from '../record-pages/record-pages'
import {
  checkDatasetDraftContent,
  createDatasetDraftWriter,
  datasetDraftLimitRefusal,
  DATASET_DRAFT_PERMISSION_REFUSAL,
  DATASET_DRAFT_PLAN_REFUSAL,
  DATASET_DRAFT_RECORDS_MAX,
  DATASET_DRAFT_RELEASE_REFUSAL,
  DATASET_DRAFT_RESOURCE,
  DATASET_DRAFT_ROLE_REFUSAL,
  DATASET_DRAFT_STORAGE_REFUSAL,
  readDatasetDraftContent,
  registerDatasetDraftWriter,
  type DatasetDraftMember,
} from './dataset-drafts'

const NOW = new Date('2026-10-10T15:00:00.000Z')

// ── Firestore double ─────────────────────────────────────────────────────

const store = new Map<string, Record<string, unknown>>()

function snapshotOf(path: string) {
  const data = store.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => (data ? data[field] : undefined),
  }
}

const childrenOf = (path: string) =>
  [...store.keys()].filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))

function docRef(path: string): Record<string, unknown> {
  return {
    kind: 'doc',
    path,
    id: path.split('/').pop(),
    collection: (name: string) => collectionRef(`${path}/${name}`),
    get: async () => snapshotOf(path),
  }
}

function collectionRef(path: string): Record<string, unknown> {
  const counted = { kind: 'count', get: async () => ({ data: () => ({ count: childrenOf(path).length }) }) }
  return { path, doc: (id: string) => docRef(`${path}/${id}`), count: () => counted }
}

const firestore = {
  collection: (name: string) => collectionRef(name),
  runTransaction: async (body: (tx: unknown) => Promise<unknown>) => {
    const creates: Array<[string, Record<string, unknown>]> = []
    const result = await body({
      get: async (target: { kind: string; path: string; get: () => Promise<unknown> }) =>
        target.kind === 'doc' ? snapshotOf(target.path) : target.get(),
      create: (ref: { path: string }, data: Record<string, unknown>) => {
        creates.push([ref.path, data])
      },
    })
    for (const [path, data] of creates) {
      if (store.has(path)) throw new Error(`6 ALREADY_EXISTS: ${path}`)
      store.set(path, data)
    }
    return result
  },
} as unknown as FirebaseFirestore.Firestore

let member: DatasetDraftMember | null
let released: boolean
let storageFull: boolean

const writer = createDatasetDraftWriter({
  firestore: () => firestore,
  orgIdForHost: async (hostId) => (hostId === 'host-1' ? 'org-1' : 'org-other'),
  member: async () => member,
  released: async () => released,
  storageFull: async () => storageFull,
})

// ── Fixtures ─────────────────────────────────────────────────────────────

/** Free: no data store. */
const FREE = { plan: 'free' as const }
/** Starter: the data store, two datasets. */
const STARTER = { plan: 'starter' as const }

const MENU = {
  fields: [
    { name: 'Dish', type: 'text', required: true },
    { name: 'Description' },
    { name: 'Category', type: 'text' },
    { name: 'Vegetarian', type: 'boolean' },
    { name: 'Allergens', type: 'list' },
  ],
  records: [
    { Dish: 'Wood-fired margherita', Description: 'San Marzano tomato, fior di latte, basil.', Category: 'Pizza', Vegetarian: true, Allergens: ['gluten', 'dairy'] },
    { Dish: 'Burrata', Description: 'With grilled peaches.', Category: 'Starters', Vegetarian: 'yes' },
    { dish: 'Wood-fired margherita', Category: 'Pizza' },
  ],
  pageAddressFrom: 'Dish',
}

const request = (patch: Record<string, unknown> = {}) => ({
  orgId: 'org-1',
  hostId: 'host-1',
  uid: 'uid-1',
  org: STARTER as Record<string, unknown>,
  now: NOW,
  id: 'job-1-d0',
  name: 'Menu',
  content: MENU,
  ...patch,
})

const dataset = () => store.get('orgs/org-1/datasets/job-1-d0') as Record<string, unknown> & { model: DatasetModel }
const records = () =>
  childrenOf('orgs/org-1/datasets/job-1-d0/records').map((path) => store.get(path) as Record<string, unknown> & { values: Record<string, unknown> })

beforeEach(() => {
  store.clear()
  member = { role: 'editor', canManageData: true, member: { role: 'editor' } }
  released = true
  storageFull = false
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
})

describe('reading what a caller sends', () => {
  it('types the fields, mints their ids, and coerces each record to the model', () => {
    const read = readDatasetDraftContent({ name: 'Menu', ...MENU })
    expect(read.ok).toBe(true)
    if (read.ok === false) return
    expect(read.value.model.order).toEqual(['dish', 'description', 'category', 'vegetarian', 'allergens', 'slug'])
    expect(read.value.model.fields['vegetarian']).toEqual({ name: 'Vegetarian', type: 'bool' })
    expect(read.value.model.fields['allergens']).toEqual({ name: 'Allergens', type: 'sorted' })
    expect(read.value.model.fields['dish']).toEqual({ name: 'Dish', type: 'text', required: true })
    expect(read.value.model.fields['slug']).toEqual({
      name: 'Page address',
      type: 'text',
      customType: RECORD_PAGE_ADDRESS_FIELD_TYPE,
      slugFrom: 'dish',
    })
    // "yes" is the checkbox's own true; a field named in another case is the same field.
    expect(read.value.records[1]).toMatchObject({ vegetarian: true })
    // Every record its own address, unique within the dataset.
    expect(read.value.records.map((values) => values['slug'])).toEqual([
      'wood-fired-margherita',
      'burrata',
      'wood-fired-margherita-2',
    ])
    for (const values of read.value.records) expect(validateDocument(read.value.model, values)).toEqual({})
  })

  it('refuses a field it cannot type, a record naming no field, and a value its field cannot hold', () => {
    const read = readDatasetDraftContent({
      name: 'Menu',
      fields: [{ name: 'Dish' }, { name: 'Price', type: 'money' }, { name: 'Spicy', type: 'boolean' }],
      records: [{ Dish: 'Soup', Colour: 'red' }, { Dish: 'Stew', Spicy: 'very' }],
    })
    expect(read).toEqual({
      ok: false,
      problems: ['The field "Price" is one of text, number, integer, boolean, list, image'],
    })
    const values = readDatasetDraftContent({
      name: 'Menu',
      fields: [{ name: 'Dish' }, { name: 'Spicy', type: 'boolean' }],
      records: [{ Dish: 'Soup', Colour: 'red' }, { Dish: 'Stew', Spicy: 'very' }],
    })
    expect(values.ok).toBe(false)
    if (values.ok !== false) return
    expect(values.problems).toContain('Record 1 names "Colour", which is not a field')
    expect(values.problems).toContain('Record 2: Spicy must be true or false')
  })

  it('holds a required field, the record ceiling, and an address made from a text field', () => {
    expect(
      readDatasetDraftContent({ name: 'Menu', fields: [{ name: 'Dish', required: true }, { name: 'Notes' }], records: [{ Notes: 'x' }] }),
    ).toEqual({ ok: false, problems: ['Record 1: Dish is required'] })
    expect(
      readDatasetDraftContent({
        name: 'Menu',
        fields: [{ name: 'Dish' }],
        records: Array.from({ length: DATASET_DRAFT_RECORDS_MAX + 1 }, (_, index) => ({ Dish: `Dish ${index}` })),
      }),
    ).toEqual({ ok: false, problems: [`A dataset is seeded with at most ${DATASET_DRAFT_RECORDS_MAX} records`] })
    expect(
      readDatasetDraftContent({ name: 'Menu', fields: [{ name: 'Seats', type: 'integer' }], pageAddressFrom: 'Seats' }),
    ).toEqual({ ok: false, problems: ['A page address fills from one of the dataset’s text fields'] })
  })

  it('reports the fields by id and name as its facts', () => {
    expect(checkDatasetDraftContent({ name: 'Team', fields: [{ name: 'Name' }, { name: 'Role' }], records: [{ Name: 'Head chef' }] })).toEqual({
      ok: true,
      facts: {
        fields: [
          { id: 'name', name: 'Name', type: 'text' },
          { id: 'role', name: 'Role', type: 'text' },
        ],
        records: 1,
        addressField: null,
        imageField: null,
      },
    })
  })

  it('keeps a record’s photo in an image field, as a photo address only (AGL-3616)', () => {
    const read = readDatasetDraftContent({
      name: 'Portfolio pieces',
      fields: [{ name: 'Title' }, { name: 'Image', type: 'image' }],
      records: [
        { Title: 'Speckled serving bowl', Image: '/api/media/cdn/host-1/m-1' },
        { Title: 'Tall bud vase', Image: 'https://images.example.com/vase.jpg' },
        { Title: 'Nesting bowls' },
      ],
    })
    expect(read.ok).toBe(true)
    if (read.ok !== true) return
    expect(read.value.model.fields['image']).toEqual({ name: 'Image', type: 'text', customType: DATASET_IMAGE_FIELD_TYPE })
    expect(read.value.records.map((values) => values['image'])).toEqual([
      '/api/media/cdn/host-1/m-1',
      'https://images.example.com/vase.jpg',
      undefined,
    ])
    expect(checkDatasetDraftContent({ name: 'Pieces', fields: [{ name: 'Title' }, { name: 'Image', type: 'image' }] })).toMatchObject({
      ok: true,
      facts: { imageField: 'image', fields: [{ id: 'title' }, { id: 'image', name: 'Image', type: 'text' }] },
    })
    for (const bad of ['a bowl on a shelf', 'javascript:alert(1)', 'http://example.com/a.jpg', '//evil.example/a.jpg']) {
      const refused = readDatasetDraftContent({ name: 'Pieces', fields: [{ name: 'Title' }, { name: 'Image', type: 'image' }], records: [{ Title: 'Bowl', Image: bad }] })
      expect(refused).toEqual({ ok: false, problems: ['Record 1: Image is not a photo from the media library or an https link'] })
    }
    // A page address never fills from a photo.
    expect(
      readDatasetDraftContent({ name: 'Pieces', fields: [{ name: 'Image', type: 'image' }], pageAddressFrom: 'Image' }).ok,
    ).toBe(false)
  })
})

describe('the dataset writer', () => {
  it('writes the dataset with its model, the org’s sharing for the site, and its seeded records', async () => {
    const written = await writer.write(request())
    expect(written).toMatchObject({ ok: true, replayed: false, id: 'job-1-d0', name: 'Menu', versionId: null })
    expect(written.ok && (written.facts as { records: number }).records).toBe(3)
    expect(dataset()).toMatchObject({
      displayName: 'Menu',
      fields: ['dish', 'description', 'category', 'vegetarian', 'allergens', 'slug'],
      visibleTo: ['org'],
      createdAt: NOW,
      createdBy: 'uid-1',
    })
    const rows = records()
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({
      values: { dish: 'Wood-fired margherita', vegetarian: true, allergens: ['gluten', 'dairy'], slug: 'wood-fired-margherita' },
      order: 0,
      createdAt: NOW,
    })
    // The filter index every record write carries, so the records table can find it.
    expect(rows[0]).toHaveProperty('filterValues')
  })

  it('shares the dataset with this site alone where the org’s Default sharing says so', async () => {
    await writer.write(request({ org: { ...STARTER, defaultResourceScope: 'host' } }))
    expect(dataset()['visibleTo']).toEqual(['host:host-1'])
  })

  it('answers a second write under the same id with the dataset it already wrote', async () => {
    await writer.write(request())
    const again = await writer.write(request())
    expect(again).toMatchObject({ ok: true, replayed: true, id: 'job-1-d0', name: 'Menu' })
    expect(records()).toHaveLength(3)
  })

  it('refuses as the datasets route does: role, permission, flag, plan', async () => {
    member = { role: 'viewer', canManageData: false, member: { role: 'viewer' } }
    expect(await writer.write(request())).toEqual({ ok: false, status: 403, error: DATASET_DRAFT_ROLE_REFUSAL })
    member = { role: 'editor', canManageData: false, member: { role: 'editor' } }
    expect(await writer.refusal(request())).toEqual({ status: 403, error: DATASET_DRAFT_PERMISSION_REFUSAL })
    member = { role: 'editor', canManageData: true, member: { role: 'editor' } }
    released = false
    expect(await writer.refusal(request())).toEqual({ status: 403, error: DATASET_DRAFT_RELEASE_REFUSAL })
    released = true
    expect(await writer.refusal(request({ org: FREE }))).toEqual({ status: 403, error: DATASET_DRAFT_PLAN_REFUSAL })
    expect(await writer.refusal(request({ hostId: 'host-2' }))).toEqual({ status: 404, error: 'Unknown site' })
    expect(store.size).toBe(0)
  })

  it('meets the dataset allowance inside the create: Starter holds two', async () => {
    store.set('orgs/org-1/datasets/a', { displayName: 'A' })
    expect(await writer.refusal(request())).toBeNull()
    store.set('orgs/org-1/datasets/b', { displayName: 'B' })
    expect(await writer.refusal(request())).toEqual({ status: 403, error: datasetDraftLimitRefusal(checkDatasetQuota(STARTER, 2)) })
    const written = await writer.write(request())
    expect(written).toMatchObject({ ok: false, status: 403 })
    expect(dataset()).toBeUndefined()
  })

  it('writes no records past a full storage band', async () => {
    storageFull = true
    expect(await writer.write(request())).toEqual({ ok: false, status: 403, error: DATASET_DRAFT_STORAGE_REFUSAL })
    expect(dataset()).toBeUndefined()
  })

  it('refuses content its model refuses, writing nothing', async () => {
    const written = await writer.write(request({ content: { fields: [{ name: 'Dish', type: 'money' }] } }))
    expect(written).toMatchObject({ ok: false, status: 400 })
    expect(store.size).toBe(0)
  })

  it('reads the dataset back by the site it was made from', async () => {
    await writer.write(request())
    expect(await writer.read({ hostId: 'host-1', id: 'job-1-d0' })).toMatchObject({ id: 'job-1-d0', name: 'Menu', facts: { addressField: 'slug' } })
    expect(await writer.read({ hostId: 'host-1', id: 'missing' })).toBeNull()
  })

  it('is the data plugin’s writer for the `dataset` resource', () => {
    registerDatasetDraftWriter()
    expect(pluginResourceDraftWriter(DATASET_DRAFT_RESOURCE)?.pluginId).toBe('data')
  })
})

describe('the Image field type (AGL-3616)', () => {
  it('takes a photo the site’s Image shows, and nothing else', () => {
    for (const ok of ['/api/media/cdn/host-1/m-1', 'media:host-1/m-1', 'media:host-1/m-1@abc123', 'https://images.example.com/a.jpg', '/starter/photos/clay.jpg']) {
      expect(isDatasetImageValue(ok)).toBe(true)
      expect(DATASET_IMAGE_FIELD.validate?.(ok)).toBeNull()
    }
    for (const bad of ['', 'a bowl', 'http://example.com/a.jpg', '//example.com/a.jpg', 'media:../x', '/a b.jpg', 'data:image/png;base64,AAAA', 7]) {
      expect(isDatasetImageValue(bad)).toBe(false)
    }
    expect(DATASET_IMAGE_FIELD.baseType).toBe('text')
    expect(DATASET_IMAGE_FIELD.name).toBe(DATASET_IMAGE_FIELD_TYPE)
  })
})
