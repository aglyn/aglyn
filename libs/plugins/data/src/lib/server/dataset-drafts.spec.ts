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
 *  - THE REFUSAL is the datasets route's: "Manage data" (`data.manage`) and
 *    nothing about the role, the release flag, the plan, the dataset
 *    allowance — counted inside the create.
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
import { DATASET_PAGE_FIELD_TYPE } from '../model/dataset-page-field'
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
  // A records query by their `order`, as the late photo pass's revision asks (AGL-3988).
  const where = (field: string, op: string, values: unknown[]) => ({
    kind: 'query',
    get: async () => ({
      docs: childrenOf(path)
        .filter((child) => op === 'in' && values.includes(store.get(child)?.[field]))
        .map((child) => ({ ...snapshotOf(child), ref: docRef(child) })),
    }),
  })
  return { path, doc: (id: string) => docRef(`${path}/${id}`), count: () => counted, where }
}

const firestore = {
  collection: (name: string) => collectionRef(name),
  runTransaction: async (body: (tx: unknown) => Promise<unknown>) => {
    const creates: Array<[string, Record<string, unknown>]> = []
    const updates: Array<[string, Record<string, unknown>]> = []
    const result = await body({
      get: async (target: { kind: string; path: string; get: () => Promise<unknown> }) =>
        target.kind === 'doc' ? snapshotOf(target.path) : target.get(),
      create: (ref: { path: string }, data: Record<string, unknown>) => {
        creates.push([ref.path, data])
      },
      update: (ref: { path: string }, data: Record<string, unknown>) => {
        updates.push([ref.path, data])
      },
    })
    for (const [path, data] of creates) {
      if (store.has(path)) throw new Error(`6 ALREADY_EXISTS: ${path}`)
      store.set(path, data)
    }
    for (const [path, data] of updates) {
      const next = { ...(store.get(path) ?? {}) }
      for (const [key, value] of Object.entries(data)) {
        if (value && typeof value === 'object' && value.constructor?.name === 'DeleteTransform') delete next[key]
        else next[key] = value
      }
      store.set(path, next)
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
  member = { canManageData: true, member: { role: 'editor' } }
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
      problems: ['The field "Price" is one of text, number, integer, boolean, list, image, page'],
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

  it('keeps a record’s page in a page field, as a page reference only (AGL-3763)', () => {
    const read = readDatasetDraftContent({
      name: 'Services',
      fields: [{ name: 'Name' }, { name: 'Details page', type: 'page' }],
      records: [{ Name: 'Drywall repair', 'Details page': 'screen:drywall-1' }, { Name: 'Painting' }],
    })
    expect(read.ok).toBe(true)
    if (read.ok !== true) return
    expect(read.value.model.fields['details_page'] ?? Object.values(read.value.model.fields)[1]).toEqual({
      name: 'Details page',
      type: 'text',
      customType: DATASET_PAGE_FIELD_TYPE,
    })
    for (const bad of ['/services/drywall', 'drywall-1', 'https://example.com/drywall', 'collection:blog']) {
      const refused = readDatasetDraftContent({
        name: 'Services',
        fields: [{ name: 'Name' }, { name: 'Page', type: 'page' }],
        records: [{ Name: 'Drywall', Page: bad }],
      })
      expect(refused).toMatchObject({ ok: false })
    }
  })
})

describe('the dataset writer', () => {
  it('writes the dataset with its model, shared with its site alone, and its seeded records', async () => {
    const written = await writer.write(request())
    expect(written).toMatchObject({ ok: true, replayed: false, id: 'job-1-d0', name: 'Menu', versionId: null })
    expect(written.ok && (written.facts as { records: number }).records).toBe(3)
    expect(dataset()).toMatchObject({
      displayName: 'Menu',
      fields: ['dish', 'description', 'category', 'vegetarian', 'allergens', 'slug'],
      visibleTo: ['host:host-1'],
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

  it('marks each record the caller says is a sample, beside its values, and no other (AGL-4065)', async () => {
    const written = await writer.write(request({ content: { ...MENU, samples: [true, false, true] } }))
    expect(written.ok).toBe(true)
    const rows = records()
    expect(rows.map((row) => row['sample'] === true)).toEqual([true, false, true])
    // The flag sits beside the values, so no page that repeats them reads it.
    for (const row of rows) expect(row.values).not.toHaveProperty('sample')
    expect(readDatasetDraftContent({ name: 'Menu', ...MENU, samples: ['yes'] })).toEqual({
      ok: false,
      problems: ['Samples are a list of true or false, one a record'],
    })
    expect(readDatasetDraftContent({ name: 'Menu', ...MENU, samples: [true, true, true, true] }).ok).toBe(false)
  })

  it('shares the dataset with this site alone whatever the org’s Default sharing says (AGL-4003)', async () => {
    // A drafted dataset is the site's own content, so deleting the site erases
    // it; shared with every site, 53 outlived their sites in one workspace.
    await writer.write(request({ org: { ...STARTER, defaultResourceScope: 'org' } }))
    expect(dataset()['visibleTo']).toEqual(['host:host-1'])
  })

  it('answers a second write under the same id with the dataset it already wrote', async () => {
    await writer.write(request())
    const again = await writer.write(request())
    expect(again).toMatchObject({ ok: true, replayed: true, id: 'job-1-d0', name: 'Menu' })
    expect(records()).toHaveLength(3)
  })

  it('refuses as the datasets route does: permission, flag, plan', async () => {
    member = null
    expect(await writer.write(request())).toEqual({ ok: false, status: 403, error: DATASET_DRAFT_PERMISSION_REFUSAL })
    member = { canManageData: false, member: { role: 'viewer' } }
    expect(await writer.write(request())).toEqual({ ok: false, status: 403, error: DATASET_DRAFT_PERMISSION_REFUSAL })
    // An editor whose "Manage data" a custom role or an override took away.
    member = { canManageData: false, member: { role: 'editor' } }
    expect(await writer.refusal(request())).toEqual({ status: 403, error: DATASET_DRAFT_PERMISSION_REFUSAL })
    // The refusal names the permission, never a role (AGL-4047).
    expect(DATASET_DRAFT_PERMISSION_REFUSAL).toBe('Your role does not include "Manage data" — ask an organization admin')
    member = { canManageData: true, member: { role: 'editor' } }
    released = false
    expect(await writer.refusal(request())).toEqual({ status: 403, error: DATASET_DRAFT_RELEASE_REFUSAL })
    released = true
    expect(await writer.refusal(request({ org: FREE }))).toEqual({ status: 403, error: DATASET_DRAFT_PLAN_REFUSAL })
    expect(await writer.refusal(request({ hostId: 'host-2' }))).toEqual({ status: 404, error: 'Unknown site' })
    expect(store.size).toBe(0)
  })

  it('writes for a viewer granted "Manage data": the key decides, not the role (AGL-4047)', async () => {
    member = { canManageData: true, member: { role: 'viewer' } }
    expect(await writer.refusal(request())).toBeNull()
    expect(await writer.write(request())).toMatchObject({ ok: true, id: 'job-1-d0' })
    expect(records()).toHaveLength(3)
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

/*
 * The AI site start's late photo pass (AGL-3988): the beta.271 Laurel Fork
 * "Gallery collections" covers were written on starters before the job had
 * copied any photo, and are given the job's own photos before the site goes
 * live.
 */
describe('the dataset writer changes a seeded record’s photo (AGL-3988)', () => {
  const GALLERY = {
    fields: [{ name: 'Title' }, { name: 'Category' }, { name: 'Image', type: 'image' }, { name: 'Image description' }],
    records: [
      { Title: 'Mountain elopements', Category: 'Weddings and elopements', Image: '/_static/starter/hero-team.jpg', 'Image description': 'A small team at a table' },
      { Title: 'Golden hour families', Category: 'Family portraits', Image: '/_static/starter/gallery-desk.jpg', 'Image description': 'A tidy desk' },
    ],
  }
  const seeded = () => writer.write(request({ name: 'Gallery collections', content: GALLERY }))
  const revise = (records: unknown, patch: Record<string, unknown> = {}) =>
    (writer.reviseRecords as NonNullable<typeof writer.reviseRecords>)({
      orgId: 'org-1',
      hostId: 'host-1',
      uid: 'uid-1',
      org: STARTER as Record<string, unknown>,
      now: NOW,
      id: 'job-1-d0',
      records: records as never,
      ...patch,
    })
  const byOrder = () => [...records()].sort((a, b) => Number(a['order']) - Number(b['order']))

  it('writes the photo and its words where the record still holds the starter, with its filter index, and keeps the rest', async () => {
    await seeded()
    const result = await revise([
      {
        order: 0,
        values: { image: '/api/media/cdn/host-1/couple01', image_description: 'A couple at a wedding' },
        where: { image: '/_static/starter/hero-team.jpg' },
      },
    ])
    expect(result).toEqual({ ok: true, changed: 1 })
    const [first, second] = byOrder()
    expect(first?.values).toEqual({
      title: 'Mountain elopements',
      category: 'Weddings and elopements',
      image: '/api/media/cdn/host-1/couple01',
      image_description: 'A couple at a wedding',
    })
    expect((first?.['filterValues'] as Record<string, unknown>)['image']).toBe('/api/media/cdn/host-1/couple01')
    expect(first?.['updatedAt']).toBe(NOW)
    expect(second?.values['image']).toBe('/_static/starter/gallery-desk.jpg')
  })

  it('leaves a record a member changed since, a value no photo field takes, and a field the list does not have', async () => {
    await seeded()
    const LATER = new Date('2026-10-10T15:05:00.000Z')
    const result = await revise(
      [
        { order: 0, values: { image: '/api/media/cdn/host-1/couple01' }, where: { image: '/_static/starter/gallery-desk.jpg' } },
        { order: 1, values: { image: 'a family on a hill' } },
        { order: 1, values: { nickname: 'x' } },
      ],
      { now: LATER },
    )
    // None of them is written: the first is a member's now, the second's value no photo field takes, the third's field is not the list's.
    expect(result).toEqual({ ok: true, changed: 0 })
    const [first, second] = byOrder()
    expect(first?.['updatedAt']).toBe(NOW)
    expect(second?.['updatedAt']).toBe(NOW)
    expect(first?.values['image']).toBe('/_static/starter/hero-team.jpg')
    expect(second?.values).not.toHaveProperty('nickname')
    expect(second?.values['image']).toBe('/_static/starter/gallery-desk.jpg')
  })

  it('refuses as its write does, and answers a dataset that is gone', async () => {
    await seeded()
    member = { canManageData: false, member: { role: 'viewer' } }
    expect(await revise([{ order: 0, values: { image: '/api/media/cdn/host-1/couple01' } }])).toEqual({
      ok: false,
      status: 403,
      error: DATASET_DRAFT_PERMISSION_REFUSAL,
    })
    member = { canManageData: true, member: { role: 'editor' } }
    expect(await revise([{ order: 0, values: { image: '/api/media/cdn/host-1/couple01' } }], { id: 'job-1-gone' })).toMatchObject({
      ok: false,
      status: 404,
    })
    expect(await revise([])).toEqual({ ok: true, changed: 0 })
  })
})
