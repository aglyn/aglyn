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

/*
 * Products' server half (AGL-3531) against a fake that answers queries the
 * way Firestore does: an export reads the list's query page by page and
 * counts its rows; a file is looked up, planned, written through the product
 * write path — with the derived keys, the plan's room, the activity entry
 * and the stock history — and undone.
 */

import {
  type QueryFakeFirestore,
  queryFakeFirestore,
} from '@aglyn/tenant-data-admin/server/test-firestore-queries'
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore'
import {
  buildTransferFieldCatalog,
  createTransferPolicy,
  deriveTransferRow,
  isTransferFieldImportable,
  mapTransferRow,
  matchHeaders,
  matchLookupRequests,
  matchRows,
  readTransferSource,
  type TransferPolicy,
  type TransferRowResult,
  type TransferUndoEntry,
} from '@aglyn/aglyn/data-transfer'
import type {
  TransferApplyWriter,
  TransferResourceContext,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'

let fake: QueryFakeFirestore
let mockOrg: Record<string, unknown> = { plan: 'pro' }
const mockActivity: Array<{ action: string; target: Record<string, unknown> }> = []

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({ firestore: () => fake }),
    firestore: { FieldPath, FieldValue, Timestamp },
  },
  getOrgForHost: async () => ({ orgId: 'org-1', org: mockOrg }),
  logHostActivity: async (_hostId: string, _actor: unknown, action: string, target: Record<string, unknown>) => {
    mockActivity.push({ action, target })
  },
}))

import {
  addProductCategories,
  applyProducts,
  countProductRows,
  lookupProducts,
  planProducts,
  productPicklists,
  readProductsPage,
  revertProducts,
} from './products.server'
import {
  PRODUCT_ALIAS_DICTIONARIES,
  PRODUCT_DERIVED_FIELDS,
  PRODUCT_LOCKED_RULES,
  PRODUCT_MATCH_KEYS,
  PRODUCT_STANDARD_FIELDS,
  PRODUCT_SYSTEM_FIELDS,
  PRODUCT_TRANSFER_GROUPS,
  type ProductPlannedRow,
} from './product-transfer'
import { commerceListFilter } from './list-filter'
import { hostScopeToken } from '@aglyn/aglyn/app-utils/scope-tokens'

const HOST = 'hosts/h1'
const ctx: TransferResourceContext = { resource: 'commerce.products', orgId: 'org-1', hostId: 'h1', actorUid: 'uid-1', jobId: 'job-1' }

const catalog = buildTransferFieldCatalog({
  standard: PRODUCT_STANDARD_FIELDS,
  derived: PRODUCT_DERIVED_FIELDS,
  system: PRODUCT_SYSTEM_FIELDS,
  groups: PRODUCT_TRANSFER_GROUPS,
})

function seedProduct(id: string, data: Record<string, unknown>) {
  fake.seed(`${HOST}/products/${id}`, {
    type: 'physical',
    status: 'active',
    deletedAt: null,
    nameLower: String(data['name'] ?? '').toLowerCase(),
    ...data,
  })
}

/** The engine's ledger, in memory. */
function memoryWriter(): TransferApplyWriter & { ledger: Map<number, { result: TransferRowResult; undo?: TransferUndoEntry }> } {
  const ledger = new Map<number, { result: TransferRowResult; undo?: TransferUndoEntry }>()
  return {
    ledger,
    alreadyApplied: async (row) => ledger.get(row)?.result ?? null,
    markApplied: async (result, undo) => void ledger.set(result.row, { result, ...(undo ? { undo } : {}) }),
    timeLeftMs: () => 60_000,
  }
}

/** A file through the engine's read, match and plan, as the job runs them. */
async function planFile(csv: string, policy: Partial<TransferPolicy> = {}) {
  const read = readTransferSource(csv, 'csv')
  if ('problem' in read) throw new Error(read.problem.message)
  const mapping = matchHeaders(read.table.headers, catalog.fields.filter(isTransferFieldImportable), {
    dictionaries: PRODUCT_ALIAS_DICTIONARIES,
  }).mapping
  const rows = read.table.rows.map((cells, index) => {
    const derived = deriveTransferRow(catalog.byId, mapTransferRow(cells, mapping))
    return { index, values: derived.values, derivations: derived.derivations, problems: derived.problems }
  })
  const values = rows.map((row) => row.values)
  const found = await lookupProducts(ctx, matchLookupRequests(values, PRODUCT_MATCH_KEYS))
  const plan = await planProducts(ctx, {
    fields: catalog.fields,
    rows,
    matches: matchRows(values, PRODUCT_MATCH_KEYS, found.lookup),
    existing: found.records,
    policy: createTransferPolicy({ ...policy, locked: PRODUCT_LOCKED_RULES }),
  })
  return plan
}

async function applyPlan(rows: ProductPlannedRow[]) {
  const writer = memoryWriter()
  const writes = rows.filter((row) => row.verdict === 'create' || row.verdict === 'update')
  const applied = await applyProducts(ctx, { jobId: 'job-1', index: 0, start: 0, end: rows.length, rows: writes }, writer)
  return { ...applied, writer }
}

beforeEach(() => {
  fake = queryFakeFirestore()
  mockOrg = { plan: 'pro' }
  mockActivity.length = 0
  seedProduct('lamp', {
    name: 'Desk lamp',
    slug: 'desk-lamp',
    status: 'draft',
    options: [{ name: 'Color', values: ['Black', 'Brass'] }],
    variants: [
      { id: 'a', options: { Color: 'Black' }, priceUsd: 40, inventory: 3, sku: 'LAMP-B' },
      { id: 'b', options: { Color: 'Brass' }, priceUsd: 55, inventory: 1, sku: 'LAMP-R' },
    ],
    skus: ['lamp-b', 'lamp-r'],
    mediaUrls: ['https://cdn.example.com/lamp.jpg'],
    categoryIds: ['cat-light'],
  })
  seedProduct('mug', {
    name: 'Mug',
    slug: 'mug',
    variants: [{ id: 'default', priceUsd: 12, inventory: null }],
  })
  seedProduct('gone', { name: 'Gone', slug: 'gone', deletedAt: 1, variants: [{ id: 'x', priceUsd: 1 }] })
  fake.seed(`${HOST}/productCategories/cat-light`, { name: 'Lighting', slug: 'lighting', parentId: null })
})

describe('exporting products', () => {
  it('reads every live product a page at a time, a row per variant, and counts those rows', async () => {
    const fieldIds = ['id', 'handle', 'title', 'sku', 'price', 'categories']
    const first = await readProductsPage(ctx, null, fieldIds, { pageSize: 1 })
    expect(first.rows.map((row) => [row['id'], row['sku']])).toEqual([
      ['lamp', 'LAMP-B'],
      ['lamp', 'LAMP-R'],
    ])
    expect(first.rows[0]?.['categories']).toEqual(['Lighting'])
    const second = await readProductsPage(ctx, first.next, fieldIds, { pageSize: 1 })
    expect(second.rows.map((row) => row['id'])).toEqual(['mug'])
    const third = await readProductsPage(ctx, second.next, fieldIds, { pageSize: 1 })
    expect(third).toEqual({ rows: [], next: null })
    expect(await countProductRows(ctx, {})).toBe(3)
  })

  it("reads the list's filter, the selection, and nothing for a reader scoped elsewhere", async () => {
    const filter = commerceListFilter({
      filters: [
        { path: 'deletedAt', op: '==', value: null },
        { path: 'status', op: '==', value: 'draft' },
      ],
      orderBy: { path: 'nameLower', direction: 'asc' },
    })
    const filtered = await readProductsPage(ctx, null, ['id'], { filter: filter as never })
    expect([...new Set(filtered.rows.map((row) => row['id']))]).toEqual(['lamp'])
    expect(await countProductRows(ctx, { filter: filter as never })).toBe(2)

    const selected = await readProductsPage(ctx, null, ['id'], { ids: ['mug', 'gone'] })
    expect(selected.rows.map((row) => row['id'])).toEqual(['mug'])

    const elsewhere = { scopeTokens: [hostScopeToken('other-site')] }
    expect(await readProductsPage(ctx, null, ['id'], elsewhere)).toEqual({ rows: [], next: null })
    expect(await countProductRows(ctx, elsewhere)).toBe(0)
    const here = { scopeTokens: [hostScopeToken('h1')] }
    expect((await readProductsPage(ctx, null, ['id'], here)).rows).toHaveLength(3)
  })

  it('refuses a filter that names a field the list does not filter by', async () => {
    await expect(
      readProductsPage(ctx, null, ['id'], {
        filter: { filters: [{ path: 'secretField', op: '==', value: 1 }], orderBy: { path: 'nameLower' } } as never,
      }),
    ).rejects.toThrow(/does not filter by/)
  })
})

describe('finding products', () => {
  it('by handle, by any SKU, and by ID — never a deleted one', async () => {
    const found = await lookupProducts(ctx, [
      { fieldId: 'handle', normalizer: 'slug', values: ['desk-lamp', 'gone'] },
      { fieldId: 'sku', normalizer: 'caseless', values: ['lamp-r'] },
      { fieldId: 'id', normalizer: 'aglynId', values: ['mug', 'gone'] },
    ])
    expect([...found.records.keys()].sort()).toEqual(['lamp', 'mug'])
    expect(found.lookup.get('handle\u0000desk-lamp')).toEqual(['lamp'])
    expect(found.lookup.get('sku\u0000lamp-r')).toEqual(['lamp'])
    expect(found.lookup.get('handle\u0000gone')).toBeUndefined()
  })

  it('offers the fixed lists and the site’s categories, and adds the ones a person chose', async () => {
    const lists = await productPicklists(ctx, ['commerce.productKind', 'commerce.categories'])
    expect(lists['commerce.productKind']?.set.values.map((value) => value.label)).toEqual(['Physical', 'Digital', 'Service'])
    expect(lists['commerce.categories']?.set.values).toEqual([{ id: 'cat-light', label: 'Lighting', active: true }])
    await addProductCategories(ctx, 'commerce.categories', [
      { id: 'outdoor', label: 'Outdoor', active: true },
      { id: 'lighting-2', label: 'lighting', active: true },
    ])
    expect(fake.read(`${HOST}/productCategories/outdoor`)).toEqual({ name: 'Outdoor', slug: 'outdoor', parentId: null })
    // A name the site has, in another case, is not added twice.
    expect(fake.read(`${HOST}/productCategories/lighting-2`)).toBeUndefined()
  })
})

describe('importing products', () => {
  it('updates a matched product through the write path, creates a new one, and undoes both', async () => {
    const plan = await planFile(
      [
        'Handle,Title,Option1 Name,Option1 Value,Variant SKU,Variant Price,Variant Inventory Qty,Tags',
        'desk-lamp,Desk lamp,Color,Black,LAMP-B,42,7,Office',
        'desk-lamp,,,Green,LAMP-G,58,2,',
        'kettle,Kettle,,,,30,4,Kitchen',
      ].join('\n'),
      { fieldDefault: { mode: 'overwrite', blank: 'leave' } },
    )
    const rows = plan.rows as ProductPlannedRow[]
    expect(rows.map((row) => row.verdict)).toEqual(['update', 'update', 'create'])

    const { results, undo, writer } = await applyPlan(rows)
    expect(results.map((result) => result.outcome)).toEqual(['updated', 'updated', 'created'])

    const lamp = fake.read(`${HOST}/products/lamp`) as Record<string, any>
    expect(lamp['variants'].map((variant: any) => [variant.sku, variant.priceUsd, variant.inventory])).toEqual([
      ['LAMP-B', 42, 7],
      ['LAMP-R', 55, 1],
      ['LAMP-G', 58, 2],
    ])
    expect(lamp['options']).toEqual([{ name: 'Color', values: ['Black', 'Brass', 'Green'] }])
    expect(lamp['tags']).toEqual(['Office'])
    // The keys every write derives (AGL-3321).
    expect(lamp['skus']).toEqual(['lamp-b', 'lamp-r', 'lamp-g'])
    expect(lamp['priceFromCents']).toBe(4200)
    expect(lamp['inventory']).toBe(10)
    expect(lamp['soldOut']).toBe(false)
    expect(lamp['priceUsd']).toBe(42)

    const kettleId = results[2]?.recordId as string
    const kettle = fake.read(`${HOST}/products/${kettleId}`) as Record<string, any>
    expect(kettle).toMatchObject({
      name: 'Kettle',
      slug: 'kettle',
      status: 'active',
      deletedAt: null,
      createdBy: 'uid-1',
      nameLower: 'kettle',
      tags: ['Kitchen'],
      collectionIds: [],
    })
    expect(kettle['variants']).toEqual([expect.objectContaining({ priceUsd: 30, inventory: 4 })])

    // The stock history and the activity log.
    const adjustments = Object.values(fake.docs(`${HOST}/inventoryAdjustments`))
    expect(adjustments).toEqual([expect.objectContaining({ productId: 'lamp', variantId: 'a', delta: 4, reason: 'correction' })])
    expect(mockActivity.map((entry) => [entry.action, entry.target['id']])).toEqual([
      ['Updated product from an import', 'lamp'],
      ['Imported product', kettleId],
    ])

    // A retried chunk writes nothing twice.
    const again = await applyProducts(
      ctx,
      { jobId: 'job-1', index: 0, start: 0, end: 3, rows: rows.filter((row) => row.verdict !== 'unchanged') },
      writer,
    )
    expect(again.results.map((result) => result.outcome)).toEqual(['updated', 'updated', 'created'])
    expect((fake.read(`${HOST}/products/lamp`) as any).variants).toHaveLength(3)

    // Undo: the new product deleted, the lamp as it was.
    const reverted = await revertProducts(ctx, { jobId: 'job-1', chunk: 0, entries: undo })
    expect(reverted.conflicts).toEqual([])
    expect(fake.read(`${HOST}/products/${kettleId}`)).toBeUndefined()
    const restored = fake.read(`${HOST}/products/lamp`) as Record<string, any>
    expect(restored['variants'].map((variant: any) => [variant.sku, variant.priceUsd, variant.inventory])).toEqual([
      ['LAMP-B', 40, 3],
      ['LAMP-R', 55, 1],
    ])
    expect(restored['skus']).toEqual(['lamp-b', 'lamp-r'])
  })

  it('asks before undoing a product edited since the import', async () => {
    const plan = await planFile('Variant SKU,Variant Price\nLAMP-B,45\n', { fieldDefault: { mode: 'overwrite', blank: 'leave' } })
    const { undo } = await applyPlan(plan.rows as ProductPlannedRow[])
    // A sale since: the count moved.
    const lamp = fake.read(`${HOST}/products/lamp`) as Record<string, any>
    fake.seed(`${HOST}/products/lamp`, {
      ...lamp,
      variants: lamp['variants'].map((variant: any) => (variant.id === 'a' ? { ...variant, inventory: 2 } : variant)),
    })
    const kept = await revertProducts(ctx, { jobId: 'job-1', chunk: 0, entries: undo })
    expect(kept.conflicts.map((step) => step.recordId)).toEqual(['lamp'])
    expect((fake.read(`${HOST}/products/lamp`) as any).variants[0].priceUsd).toBe(45)
    const reverted = await revertProducts(ctx, { jobId: 'job-1', chunk: 0, entries: undo }, { lamp: 'revert' })
    expect(reverted.done).toHaveLength(1)
    expect((fake.read(`${HOST}/products/lamp`) as any).variants[0].priceUsd).toBe(40)
  })

  it('holds new products to the plan: a site without commerce creates none', async () => {
    mockOrg = { plan: 'free' }
    const plan = await planFile('Handle,Title,Variant Price\nkettle,Kettle,30\n')
    expect(plan.rows[0]).toMatchObject({ verdict: 'fail', reason: 'planLimit' })
    expect(plan.warnings.map((warning) => warning.class)).toContain('planLimit')
  })

  it('creates a product whose handle another product holds under a free one', async () => {
    const plan = await planFile('Handle,Title,Variant Price\ngone,Gone again,30\n')
    const rows = plan.rows as ProductPlannedRow[]
    expect(rows[0]?.verdict).toBe('create')
    expect(rows[0]?.commerce?.create?.slug).toBe('gone-2')
    const { results } = await applyPlan(rows)
    expect((fake.read(`${HOST}/products/${results[0]?.recordId}`) as any).slug).toBe('gone-2')
  })

  it('records a product deleted since the dry run as a failed row, not a failed chunk', async () => {
    const plan = await planFile('Variant SKU,Variant Price\nLAMP-B,45\n', { fieldDefault: { mode: 'overwrite', blank: 'leave' } })
    fake.seed(`${HOST}/products/lamp`, { ...(fake.read(`${HOST}/products/lamp`) as object), deletedAt: 5 })
    const { results } = await applyPlan(plan.rows as ProductPlannedRow[])
    expect(results).toEqual([expect.objectContaining({ outcome: 'failed', reason: 'matchedRecordMissing' })])
  })
})

describe('add-ons, check-in and quick keys (AGL-4060)', () => {
  const overwrite: Partial<TransferPolicy> = { fieldDefault: { mode: 'overwrite', blank: 'leave' } }
  const stored = () => fake.read(`${HOST}/products/lamp`) as Record<string, any>

  const groups = [
    {
      id: 'g-shade',
      name: 'Shade',
      min: 1,
      max: 1,
      online: true,
      options: [{ id: 'o-linen', name: 'Linen', priceCents: 500, priceCentsByVariant: { b: 700 } }],
    },
  ]

  function seedRegisterLamp() {
    seedProduct('lamp', {
      name: 'Desk lamp',
      slug: 'desk-lamp',
      status: 'draft',
      posQuickKey: true,
      checkIn: { enabled: true, headcount: 2 },
      modifierGroups: groups,
      options: [{ name: 'Color', values: ['Black', 'Brass'] }],
      variants: [
        { id: 'a', options: { Color: 'Black' }, priceUsd: 40, inventory: 3, sku: 'LAMP-B' },
        { id: 'b', options: { Color: 'Brass' }, priceUsd: 55, inventory: 1, sku: 'LAMP-R', checkIn: { enabled: false } },
      ],
      skus: ['lamp-b', 'lamp-r'],
    })
  }

  it('exports them, on the product’s first row and each variant’s own', async () => {
    seedRegisterLamp()
    const fieldIds = ['handle', 'posQuickKey', 'checkIn', 'variantCheckIn', 'modifierGroups']
    const { rows: lamp } = await readProductsPage(ctx, null, fieldIds, { ids: ['lamp'] })
    expect(lamp[0]).toEqual({
      handle: 'desk-lamp',
      posQuickKey: true,
      checkIn: 'Yes, 2 people',
      variantCheckIn: null,
      modifierGroups: 'Shade (at least 1): Linen +$5.00 (Brass +$7.00)',
    })
    expect(lamp[1]).toEqual({ handle: 'desk-lamp', posQuickKey: null, checkIn: null, variantCheckIn: 'No', modifierGroups: null })
  })

  it('creates a product holding them', async () => {
    const plan = await planFile(
      'Handle,Title,Variant Price,Quick key,Check-in,Add-ons\nposter,Poster,9,yes,"Yes, ask which day",Frame: Oak +$12.00\n',
    )
    await applyPlan(plan.rows as ProductPlannedRow[])
    const id = (plan.rows[0] as ProductPlannedRow).commerce?.productId as string
    const doc = fake.read(`${HOST}/products/${id}`) as Record<string, any>
    expect(doc['posQuickKey']).toBe(true)
    expect(doc['checkIn']).toEqual({ enabled: true, headcount: 1, askUseDate: true })
    expect(doc['modifierGroups']).toEqual([
      { id: 'g-frame', name: 'Frame', min: 0, max: 1, online: true, options: [{ id: 'o-oak', name: 'Oak', priceCents: 1200 }] },
    ])
  })

  it('writes an update through to the document, and undo puts every one back', async () => {
    seedRegisterLamp()
    const before = JSON.parse(JSON.stringify(stored()))
    const plan = await planFile(
      'Handle,Quick key,Check-in,Add-ons,Variant SKU,Variant check-in\n' +
        'desk-lamp,no,"Yes, 5 people","Shade (at least 1): Linen +$6.00 (Brass +$8.00), Silk +$9.00; Bulb: LED",LAMP-B,"Yes, 3 people"\n' +
        'desk-lamp,,,,LAMP-R,"Yes, 4 people"\n',
      overwrite,
    )
    expect((plan.rows as ProductPlannedRow[]).map((row) => row.verdict)).toEqual(['update', 'update'])
    const applied = await applyPlan(plan.rows as ProductPlannedRow[])
    expect(applied.results.map((result) => result.outcome)).toEqual(['updated', 'updated'])
    const doc = stored()
    expect(doc['posQuickKey']).toBe(false)
    expect(doc['checkIn']).toEqual({ enabled: true, headcount: 5 })
    expect(doc['variants'][0]['checkIn']).toEqual({ enabled: true, headcount: 3 })
    expect(doc['variants'][1]['checkIn']).toEqual({ enabled: true, headcount: 4 })
    expect(doc['modifierGroups'][0]).toMatchObject({ id: 'g-shade', name: 'Shade' })
    expect(doc['modifierGroups'][0]['options'][0]).toEqual({
      id: 'o-linen',
      name: 'Linen',
      priceCents: 600,
      priceCentsByVariant: { b: 800 },
    })
    expect(doc['modifierGroups'][1]).toMatchObject({ id: 'g-bulb', online: true })

    const undone = await revertProducts(ctx, { jobId: 'job-1', chunk: 0, entries: applied.undo })
    expect(undone.conflicts).toEqual([])
    const back = stored()
    expect(back['posQuickKey']).toBe(true)
    expect(back['checkIn']).toEqual({ enabled: true, headcount: 2 })
    expect(back['variants'][0]['checkIn']).toBeUndefined()
    expect(back['variants'][1]['checkIn']).toEqual(before['variants'][1]['checkIn'])
    expect(back['modifierGroups']).toEqual(before['modifierGroups'])
  })

  it('leaves them exactly as stored when a file omits their columns', async () => {
    seedRegisterLamp()
    const before = JSON.parse(JSON.stringify(stored()))
    const plan = await planFile('Handle,Title,Variant SKU,Variant Price\ndesk-lamp,Lamp v2,LAMP-R,60\n', overwrite)
    await applyPlan(plan.rows as ProductPlannedRow[])
    const doc = stored()
    expect(doc['name']).toBe('Lamp v2')
    expect(doc['variants'][1]['priceUsd']).toBe(60)
    expect(doc['posQuickKey']).toBe(before['posQuickKey'])
    expect(doc['checkIn']).toEqual(before['checkIn'])
    expect(doc['modifierGroups']).toEqual(before['modifierGroups'])
    expect(doc['variants'][1]['checkIn']).toEqual(before['variants'][1]['checkIn'])
  })

  it('refuses add-ons at the write when the options the product stores make too many combinations', async () => {
    const values = (prefix: string) => Array.from({ length: 11 }, (_, at) => `${prefix}${at}`)
    seedProduct('wide', {
      name: 'Wide',
      slug: 'wide',
      options: [
        { name: 'X', values: values('x') },
        { name: 'Y', values: values('y') },
      ],
      variants: [{ id: 'a', options: { X: 'x0', Y: 'y0' }, priceUsd: 1, inventory: null }],
    })
    const plan = await planFile('Handle,Add-ons\nwide,Milk: Oat\n', overwrite)
    const applied = await applyPlan(plan.rows as ProductPlannedRow[])
    expect(applied.results[0]).toMatchObject({ outcome: 'failed', reason: 'refusedValue' })
    expect(applied.results[0]?.message).toMatch(/121 combinations/)
    expect((fake.read(`${HOST}/products/wide`) as Record<string, unknown>)['modifierGroups']).toBeUndefined()
  })
})
