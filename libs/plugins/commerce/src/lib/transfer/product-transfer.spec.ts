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
 * Products on the transfer framework (AGL-3531), the pure half: a file read
 * the way the job engine reads one — headers matched with Shopify's
 * dictionary, cells derived, rows matched by handle, SKU and ID — and then
 * folded by `planProductTransfer` into products. The Shopify assertions of
 * the importer it replaces (`commerce-io.spec.ts`) live here now.
 */

import {
  buildMatchLookup,
  buildTransferFieldCatalog,
  createTransferPolicy,
  deriveTransferRow,
  isTransferFieldImportable,
  mapTransferRow,
  matchHeaders,
  matchRows,
  readTransferSource,
  resolveTransferPreset,
  transferExportCsvHeader,
  transferExportCsvLine,
  type TransferPlanRow,
  type TransferPolicy,
} from '@aglyn/aglyn/data-transfer'
import { validateProduct, type HostProduct } from '../model/commerce'
import {
  PRODUCT_ALIAS_DICTIONARIES,
  PRODUCT_DERIVED_FIELDS,
  PRODUCT_LOCKED_RULES,
  PRODUCT_MATCH_KEYS,
  PRODUCT_STANDARD_FIELDS,
  PRODUCT_SYSTEM_FIELDS,
  PRODUCT_TRANSFER_GROUPS,
  SHOPIFY_PRODUCT_PRESET,
  applyProductRow,
  createProductDocument,
  planProductTransfer,
  productExportRowCount,
  productExportRows,
  productRecord,
  productRowChanges,
  type ProductPlannedRow,
} from './product-transfer'

const catalog = buildTransferFieldCatalog({
  standard: PRODUCT_STANDARD_FIELDS,
  derived: PRODUCT_DERIVED_FIELDS,
  system: PRODUCT_SYSTEM_FIELDS,
  groups: PRODUCT_TRANSFER_GROUPS,
})

interface Stored {
  id: string
  doc: HostProduct
}

/** A file through the engine's steps, to the products plan. */
function plan(
  csv: string,
  stored: Stored[] = [],
  options: { policy?: Partial<TransferPolicy>; taken?: string[]; maxCreates?: number } = {},
) {
  const read = readTransferSource(csv, 'csv')
  if ('problem' in read) throw new Error(read.problem.message)
  const { headers, rows: lines } = read.table
  const matched = matchHeaders(headers, catalog.fields.filter(isTransferFieldImportable), {
    dictionaries: PRODUCT_ALIAS_DICTIONARIES,
  })
  const rows: TransferPlanRow[] = lines.map((cells, index) => {
    const derived = deriveTransferRow(catalog.byId, mapTransferRow(cells, matched.mapping))
    return { index, values: derived.values, derivations: derived.derivations, problems: derived.problems }
  })
  const lookup = buildMatchLookup(
    stored.map(({ id, doc }) => ({
      id,
      values: { handle: doc.slug, sku: doc.variants.map((variant) => variant.sku).filter(Boolean), id },
    })),
    PRODUCT_MATCH_KEYS,
  )
  const matches = matchRows(
    rows.map((row) => row.values),
    PRODUCT_MATCH_KEYS,
    lookup,
  )
  let ids = 0
  let variants = 0
  const result = planProductTransfer(
    {
      fields: catalog.fields,
      rows,
      matches,
      existing: new Map(stored.map(({ id, doc }) => [id, productRecord(doc)])),
      policy: createTransferPolicy({ ...options.policy, locked: PRODUCT_LOCKED_RULES }),
    },
    {
      newProductId: () => `new-${++ids}`,
      newVariantId: () => `nv${++variants}`,
      slugTaken: (slug) => (options.taken ?? []).includes(slug),
      ...(options.maxCreates === undefined ? {} : { maxCreates: options.maxCreates }),
    },
  )
  return { mapping: matched.mapping, headers, result, rows: result.rows as ProductPlannedRow[] }
}

/** What the apply writes for a new product's first row. */
const created = (row: ProductPlannedRow | undefined) =>
  createProductDocument(row?.commerce?.create as NonNullable<NonNullable<ProductPlannedRow['commerce']>['create']>, (names) => [...names])

const SHOPIFY_SAMPLE = `Handle,Title,Body (HTML),Type,Tags,Published,Option1 Name,Option1 Value,Option2 Name,Option2 Value,Option3 Name,Option3 Value,Variant SKU,Variant Barcode,Variant Price,Variant Compare At Price,Variant Inventory Qty,Variant Grams,Image Src
brake-pads,Front Brake Pads,"Sintered, fits 04-09",physical,"brakes, Wear-Items",TRUE,Compound,Sintered,,,,,BP-S,123,39.99,49.99,12,220,https://cdn.example.com/pads.jpg
brake-pads,,,,,,,Organic,,,,,BP-O,,34.99,,5,210,
brake-pads,,,,,,,,,,,,,,,,,,https://cdn.example.com/pads-2.jpg
sticker,Sticker Pack,,physical,,FALSE,,,,,,,,,5,,,"",`

describe('reading a Shopify product CSV', () => {
  it("maps every Shopify column by Shopify's own header", () => {
    const { mapping, headers } = plan(SHOPIFY_SAMPLE)
    const at = (header: string) => mapping[headers.indexOf(header)]
    expect(at('Handle')).toBe('handle')
    expect(at('Body (HTML)')).toBe('description')
    expect(at('Option1 Name')).toBe('option1Name')
    expect(at('Option1 Value')).toBe('option1Value')
    expect(at('Variant SKU')).toBe('sku')
    expect(at('Variant Price')).toBe('price')
    expect(at('Variant Compare At Price')).toBe('compareAtPrice')
    expect(at('Variant Inventory Qty')).toBe('inventory')
    expect(at('Variant Grams')).toBe('weightGrams')
    expect(at('Image Src')).toBe('image')
    expect(at('Published')).toBe('published')
  })

  it('folds the rows of one handle into one product, with its options, variants and images', () => {
    const { rows, result } = plan(SHOPIFY_SAMPLE)
    expect(rows.map((row) => row.verdict)).toEqual(['create', 'create', 'unchanged', 'create'])
    expect(result.summary).toMatchObject({ create: 3, unchanged: 1, fail: 0 })
    const pads = created(rows[0])
    expect(pads.slug).toBe('brake-pads')
    expect(pads.name).toBe('Front Brake Pads')
    expect(pads.description).toBe('Sintered, fits 04-09')
    expect(pads.options).toEqual([{ name: 'Compound', values: ['Sintered', 'Organic'] }])
    expect(pads.variants).toHaveLength(2)
    expect(pads.variants[0]).toMatchObject({
      sku: 'BP-S',
      barcode: '123',
      priceUsd: 39.99,
      compareAtPriceUsd: 49.99,
      inventory: 12,
      weightGrams: 220,
      options: { Compound: 'Sintered' },
    })
    expect(pads.variants[1]).toMatchObject({ sku: 'BP-O', priceUsd: 34.99, inventory: 5, options: { Compound: 'Organic' } })
    // Their case is kept: a smart collection matches a tag exactly.
    expect(pads.tags).toEqual(['brakes', 'Wear-Items'])
    expect(pads.mediaUrls).toEqual(['https://cdn.example.com/pads.jpg', 'https://cdn.example.com/pads-2.jpg'])
    expect(pads.status).toBe('active')
    // The continuation rows ride with their product's first row.
    expect(rows[1]?.commerce).toMatchObject({ role: 'part', productId: 'new-1', leader: 0 })
    const sticker = created(rows[3])
    expect(sticker.status).toBe('draft')
    expect(sticker.variants[0]?.inventory).toBeNull()
  })

  it('fails a new product with no price, and reads a bad price as a dropped cell', () => {
    const { rows, result } = plan('Handle,Title,Variant Price\ngood,Good,10\nbad,Bad,notaprice\nnone,None,\n')
    expect(rows.map((row) => row.verdict)).toEqual(['create', 'fail', 'fail'])
    expect(rows[1]).toMatchObject({ reason: 'missingRequired', missing: ['price'] })
    expect(result.warnings.map((warning) => warning.class)).toContain('droppedCell')
  })

  it("lists a product's first row once for a value it read differently, not once per plan (AGL-4047)", () => {
    // Two rows of one product and a second product: three prices with no
    // currency, so three cells read as US dollars. The first row of each
    // product goes into both the product plan and its variant line's plan,
    // and was listed by each: "5 times in 3 rows".
    const { result } = plan('Handle,Title,Option1 Name,Option1 Value,Variant Price\ncanopy,Canopy,Size,Small,200\ncanopy,,,Large,300\npass,Day pass,,,1\n')
    const derived = result.warnings.find((warning) => warning.class === 'derivation')
    expect(derived).toMatchObject({ count: 3, rows: 3 })
    expect(derived?.samples.map((sample) => [sample.row, sample.fieldId])).toEqual([
      [0, 'price'],
      [1, 'price'],
      [2, 'price'],
    ])
  })

  it('still reports a price it could not read on a product that writes nothing', () => {
    const { result } = plan('Handle,Title,Variant Price,Variant Compare At Price\nlost,,5,abc\n')
    const dropped = result.warnings.find((warning) => warning.class === 'droppedCell')
    expect(dropped?.samples).toEqual([expect.objectContaining({ row: 0, fieldId: 'compareAtPrice' })])
    expect(dropped?.count).toBe(1)
  })

  it('fails a row with no title, the one field a new product cannot do without', () => {
    const { rows } = plan('Handle,Title,Variant Price\norphan,,5\n')
    expect(rows[0]).toMatchObject({ verdict: 'fail', reason: 'missingRequired', missing: ['title'] })
  })
})

describe('matching a product updates it', () => {
  const levers: Stored = {
    id: 'p-levers',
    doc: {
      name: 'Levers',
      slug: 'levers',
      type: 'physical',
      status: 'active',
      options: [{ name: 'Color', values: ['Black', 'Gold'] }],
      variants: [
        { id: 'a', options: { Color: 'Black' }, priceUsd: 59, inventory: 3, sku: 'LV-B' },
        { id: 'b', options: { Color: 'Gold' }, priceUsd: 69, inventory: null },
      ],
    },
  }

  it('by handle: a colliding handle is the same product, never a second one under a suffix', () => {
    const { rows } = plan(
      'Handle,Title,Option1 Name,Option1 Value,Variant Price\nlevers,Levers v2,Color,Black,61\nlevers,,,Gold,70\nlevers,,,Silver,80\n',
      [levers],
      { policy: { fieldDefault: { mode: 'overwrite', blank: 'leave' } } },
    )
    expect(rows.map((row) => row.verdict)).toEqual(['update', 'update', 'update'])
    expect(rows.every((row) => row.recordId === 'p-levers')).toBe(true)
    expect(rows[0]?.commerce?.variant).toEqual({ id: 'a', isNew: false })
    expect(rows[1]?.commerce?.variant).toEqual({ id: 'b', isNew: false })
    expect(rows[2]?.commerce?.variant).toEqual({ id: 'nv1', isNew: true })
    let product = levers.doc
    for (const row of rows) product = applyProductRow(product, productRowChanges(row), (names) => [...names])
    expect(product.name).toBe('Levers v2')
    expect(product.variants.map((variant) => [variant.id, variant.priceUsd])).toEqual([
      ['a', 61],
      ['b', 70],
      ['nv1', 80],
    ])
    expect(product.options).toEqual([{ name: 'Color', values: ['Black', 'Gold', 'Silver'] }])
    // A variant keeps what the file does not name.
    expect(product.variants[0]).toMatchObject({ sku: 'LV-B', inventory: 3 })
  })

  it('by SKU: a row naming only a SKU writes that variant of its product', () => {
    const { rows } = plan('SKU,Inventory\nLV-B,9\n', [levers], {
      policy: { fieldDefault: { mode: 'overwrite', blank: 'leave' } },
    })
    expect(rows[0]).toMatchObject({ verdict: 'update', recordId: 'p-levers' })
    expect(rows[0]?.commerce?.variant).toEqual({ id: 'a', isNew: false })
    expect(rows[0]?.diff).toEqual([expect.objectContaining({ fieldId: 'inventory', before: 3, after: 9 })])
  })

  it('keeps what a product has under the default policy: fill blanks, never overwrite', () => {
    const { rows } = plan('Handle,Title,Option1 Value,Variant Price,Variant Inventory Qty\nlevers,Renamed,Gold,99,4\n', [levers])
    expect(rows[0]?.verdict).toBe('update')
    // The title and the price are kept; the untracked count is filled.
    expect(rows[0]?.diff.map((change) => change.fieldId)).toEqual(['inventory'])
  })

  it("never renames a product's handle or option from a file, and says so", () => {
    const { rows, result } = plan('SKU,Handle,Option1 Name\nLV-B,new-address,Finish\n', [levers], {
      policy: { fieldDefault: { mode: 'overwrite', blank: 'leave' } },
    })
    expect(rows[0]?.heldBack).toEqual(expect.arrayContaining(['handle', 'option1Name']))
    expect(result.warnings.find((warning) => warning.class === 'lockedRule')?.count).toBe(2)
  })

  it('holds back a count for stock kept by location', () => {
    const located: Stored = {
      id: 'p-loc',
      doc: {
        ...levers.doc,
        slug: 'located',
        variants: [{ id: 'a', priceUsd: 5, sku: 'LOC', inventory: 4, inventoryByLocation: { shop: 4 } }],
        options: [],
      },
    }
    const { rows, result } = plan('SKU,Inventory\nLOC,10\n', [located], {
      policy: { fieldDefault: { mode: 'overwrite', blank: 'leave' } },
    })
    expect(rows[0]).toMatchObject({ verdict: 'unchanged', heldBack: ['inventory'] })
    expect(result.warnings.find((warning) => warning.class === 'lockedRule')?.samples[0]?.detail).toMatch(/by location/)
  })

  it('refuses a product the store could not hold, by the model’s own rules', () => {
    const { rows } = plan('Handle,Option1 Value,Variant Compare At Price\nlevers,Black,10\n', [levers], {
      policy: { fieldDefault: { mode: 'overwrite', blank: 'leave' } },
    })
    expect(rows[0]?.commerce?.problem).toMatch(/Compare-at price must exceed the price/)
  })

  it('skips a second row naming the same variant', () => {
    const { rows, result } = plan('Handle,Variant SKU,Variant Price\nlevers,LV-B,1\nlevers,LV-B,2\n', [levers])
    expect(rows[1]).toMatchObject({ verdict: 'skip', reason: 'duplicateInFile' })
    expect(result.warnings.map((warning) => warning.class)).toContain('duplicateInFile')
  })
})

describe('new products and the store', () => {
  it("gives a new product a free handle when another product holds the file's", () => {
    const { rows, result } = plan('Handle,Title,Variant Price\nmug,Mug,5\n', [], { taken: ['mug', 'mug-2'] })
    expect(rows[0]?.commerce?.create?.slug).toBe('mug-3')
    expect(result.warnings.find((warning) => warning.class === 'lockedRule')?.samples[0]?.detail).toMatch(
      /created at \/products\/mug-3/,
    )
  })

  it('makes a handle from the title, and never gives two new products one', () => {
    const { rows } = plan('Title,Variant Price\nBlue Mug,5\nBlue Mug,6\n')
    expect(rows.map((row) => row.commerce?.create?.slug)).toEqual(['blue-mug', 'blue-mug-2'])
  })

  it("stops at the plan's room for new products, counting products rather than rows", () => {
    const { rows } = plan('Handle,Title,Variant Price\na,A,1\na,,2\nb,B,3\n', [], { maxCreates: 1 })
    expect(rows.map((row) => row.verdict)).toEqual(['create', 'create', 'fail'])
    expect(rows[2]?.reason).toBe('planLimit')
  })
})

describe('exporting products', () => {
  const product: HostProduct = {
    name: 'Levers, "Adjustable"',
    slug: 'levers',
    type: 'physical',
    status: 'active',
    tags: ['controls'],
    options: [{ name: 'Color', values: ['Black', 'Gold'] }],
    mediaUrls: ['https://cdn.example.com/levers.jpg', 'https://cdn.example.com/2.jpg', 'https://cdn.example.com/3.jpg'],
    variants: [
      { id: 'a', options: { Color: 'Black' }, priceUsd: 59, inventory: 3, sku: 'LV-B' },
      { id: 'b', options: { Color: 'Gold' }, priceUsd: 69, inventory: null },
    ],
  }

  it('writes a row per variant and per extra image, the product on its first row', () => {
    const fieldIds = ['id', 'handle', 'title', 'option1Name', 'option1Value', 'price', 'image']
    const rows = productExportRows('p1', product, fieldIds)
    expect(rows).toHaveLength(3)
    expect(productExportRowCount(product)).toBe(3)
    expect(rows[0]).toEqual({
      id: 'p1',
      handle: 'levers',
      title: 'Levers, "Adjustable"',
      option1Name: 'Color',
      option1Value: 'Black',
      price: 59,
      image: 'https://cdn.example.com/levers.jpg',
    })
    expect(rows[1]).toEqual({
      id: 'p1',
      handle: 'levers',
      title: null,
      option1Name: null,
      option1Value: 'Gold',
      price: 69,
      image: 'https://cdn.example.com/2.jpg',
    })
    expect(rows[2]).toMatchObject({ handle: 'levers', option1Value: null, price: null, image: 'https://cdn.example.com/3.jpg' })
  })

  it('re-imports its own export as the same product', () => {
    const fieldIds = resolveTransferPreset(catalog, 'reimportable', {
      matchKeyFieldIds: PRODUCT_MATCH_KEYS.map((key) => key.fieldId),
    }).fieldIds
    const rows = productExportRows('p1', product, fieldIds)
    const label = (fieldId: string) => catalog.byId.get(fieldId)?.label ?? fieldId
    const csv = [transferExportCsvHeader(fieldIds, label), ...rows.map((row) => transferExportCsvLine(row, fieldIds))].join('\r\n')
    const { rows: planned } = plan(csv)
    expect(planned.map((row) => row.verdict)).toEqual(['create', 'create', 'unchanged'])
    const again = created(planned[0])
    expect(again.name).toBe('Levers, "Adjustable"')
    expect(again.options).toEqual(product.options)
    expect(again.variants.map((variant) => [variant.sku ?? null, variant.priceUsd, variant.inventory])).toEqual([
      ['LV-B', 59, 3],
      [null, 69, null],
    ])
    expect(again.mediaUrls).toEqual(product.mediaUrls)
    expect(again.tags).toEqual(['controls'])
  })

  it('writes the Shopify preset under Shopify’s column names, which the import reads back', () => {
    const header = transferExportCsvHeader(
      SHOPIFY_PRODUCT_PRESET.fieldIds,
      (fieldId) => SHOPIFY_PRODUCT_PRESET.headers?.[fieldId] ?? fieldId,
    )
    expect(header.split(',').slice(0, 5)).toEqual(['Handle', 'Title', 'Body (HTML)', 'Tags', 'Published'])
    const rows = productExportRows('p1', product, SHOPIFY_PRODUCT_PRESET.fieldIds)
    const csv = [header, ...rows.map((row) => transferExportCsvLine(row, SHOPIFY_PRODUCT_PRESET.fieldIds))].join('\r\n')
    const { mapping } = plan(csv)
    expect(Object.values(mapping).sort()).toEqual([...SHOPIFY_PRODUCT_PRESET.fieldIds].sort())
  })
})

describe('the register’s settings in a file (AGL-4060)', () => {
  const overwrite = { policy: { fieldDefault: { mode: 'overwrite', blank: 'leave' } } } as const
  const canopy: Stored = {
    id: 'p-canopy',
    doc: {
      name: 'Canopy',
      slug: 'canopy',
      type: 'physical',
      status: 'active',
      posQuickKey: true,
      checkIn: { enabled: true, headcount: 4, askUseDate: true },
      options: [{ name: 'Size', values: ['10x10', '10x20'] }],
      modifierGroups: [
        {
          id: 'g-walls',
          name: 'Walls',
          min: 1,
          max: 2,
          online: true,
          options: [
            { id: 'o-back', name: 'Back wall', priceCents: 5000, priceCentsByVariant: { b: 7500 } },
            { id: 'o-side', name: 'Side, full', priceCents: 0 },
          ],
        },
        { id: 'g-bag', name: 'Bag', min: 0, max: 1, options: [{ id: 'o-bag', name: 'Roller bag', priceCents: 2500 }] },
      ],
      variants: [
        { id: 'a', options: { Size: '10x10' }, priceUsd: 300, inventory: null, sku: 'C-1' },
        { id: 'b', options: { Size: '10x20' }, priceUsd: 500, inventory: null, sku: 'C-2', checkIn: { enabled: false } },
      ],
    },
  }

  /** A product through its export and back in, as a file. */
  const roundTrip = (doc: HostProduct, stored: Stored[], policy?: Partial<TransferPolicy>) => {
    const fieldIds = resolveTransferPreset(catalog, 'reimportable', {
      matchKeyFieldIds: PRODUCT_MATCH_KEYS.map((key) => key.fieldId),
    }).fieldIds
    const label = (fieldId: string) => catalog.byId.get(fieldId)?.label ?? fieldId
    const lines = productExportRows('p-canopy', doc, fieldIds).map((row) => transferExportCsvLine(row, fieldIds))
    return plan([transferExportCsvHeader(fieldIds, label), ...lines].join('\r\n'), stored, policy ? { policy } : {})
  }

  const planFor = (cell: string) => plan(`Handle,Title,Variant Price,Add-ons\nmug,Mug,5,"${cell.replace(/"/g, '""')}"\n`)

  it('reads its columns by their plain names', () => {
    const { mapping, headers } = plan('Handle,Quick key,Check-in,Variant check-in,Add-ons\nx,yes,no,no,A: B\n')
    const at = (header: string) => mapping[headers.indexOf(header)]
    expect(at('Quick key')).toBe('posQuickKey')
    expect(at('Check-in')).toBe('checkIn')
    expect(at('Variant check-in')).toBe('variantCheckIn')
    expect(at('Add-ons')).toBe('modifierGroups')
  })

  it('leaves none of a full Shopify export’s columns mapped to them', () => {
    const headers =
      'Handle,Title,Body (HTML),Vendor,Product Category,Type,Tags,Published,Option1 Name,Option1 Value,Option2 Name,Option2 Value,Option3 Name,Option3 Value,Variant SKU,Variant Grams,Variant Inventory Tracker,Variant Inventory Qty,Variant Inventory Policy,Variant Fulfillment Service,Variant Price,Variant Compare At Price,Variant Requires Shipping,Variant Taxable,Variant Barcode,Image Src,Image Position,Image Alt Text,Gift Card,SEO Title,SEO Description,Variant Image,Variant Weight Unit,Variant Tax Code,Cost per item,Price / International,Compare At Price / International,Status'
    const { mapping } = plan(`${headers}\n`)
    expect(Object.values(mapping)).not.toEqual(expect.arrayContaining(['posQuickKey']))
    expect(Object.values(mapping)).not.toEqual(expect.arrayContaining(['checkIn']))
    expect(Object.values(mapping)).not.toEqual(expect.arrayContaining(['variantCheckIn']))
    expect(Object.values(mapping)).not.toEqual(expect.arrayContaining(['modifierGroups']))
  })

  it('creates a product with all of them', () => {
    const { rows, result } = plan(
      'Handle,Title,Option1 Name,Option1 Value,Variant Price,Quick key,Check-in,Variant check-in,Add-ons\n' +
        'pass,Day pass,Kind,Adult,20,yes,"Yes, 2 people, ask which day",,"Extras (at most 2): Wristband +$1.50, Photo; Size (at least 1): Small (Adult +$2.00)"\n' +
        'pass,,,Child,10,,,No,\n',
    )
    expect(result.summary).toMatchObject({ create: 2, fail: 0 })
    expect(rows[0]?.commerce?.problem).toBeUndefined()
    const product = created(rows[0])
    expect(product.posQuickKey).toBe(true)
    expect(product.checkIn).toEqual({ enabled: true, headcount: 2, askUseDate: true })
    expect(product.variants[0]?.checkIn).toBeUndefined()
    expect(product.variants[1]?.checkIn).toEqual({ enabled: false })
    const [extras, size] = product.modifierGroups ?? []
    expect(extras).toMatchObject({ name: 'Extras', min: 0, max: 2, online: true })
    expect(extras?.options.map((option) => [option.name, option.priceCents])).toEqual([
      ['Wristband', 150],
      ['Photo', 0],
    ])
    expect(size).toMatchObject({ min: 1, max: 1 })
    expect(size?.options[0]?.priceCentsByVariant).toEqual({ [product.variants[0]?.id as string]: 200 })
    // What a product stored this way is checked by, once more, whole.
    expect(validateProduct(product)).toBeNull()
  })

  it('round-trips every one of them: an export re-imported into its product changes nothing', () => {
    const { rows, result } = roundTrip(canopy.doc, [canopy], { fieldDefault: { mode: 'overwrite', blank: 'leave' } })
    expect(result.summary).toMatchObject({ update: 0, fail: 0 })
    expect(rows.every((row) => row.verdict === 'unchanged')).toBe(true)
    expect(rows.every((row) => !row.commerce?.problem)).toBe(true)
  })

  it('round-trips every one of them into a new product, prices by variant included', () => {
    const { rows } = roundTrip(canopy.doc, [])
    expect(rows[0]?.commerce?.problem).toBeUndefined()
    const again = created(rows[0])
    expect(again.posQuickKey).toBe(true)
    expect(again.checkIn).toEqual(canopy.doc.checkIn)
    expect(again.variants.map((variant) => variant.checkIn)).toEqual([undefined, { enabled: false }])
    const large = again.variants.find((variant) => variant.options?.['Size'] === '10x20')?.id as string
    const strip = (groups: HostProduct['modifierGroups']) =>
      groups?.map((group) => ({
        name: group.name,
        min: group.min,
        max: group.max,
        online: group.online === true,
        options: group.options.map((option) => [option.name, option.priceCents, Object.values(option.priceCentsByVariant ?? {})]),
      }))
    expect(strip(again.modifierGroups)).toEqual(strip(canopy.doc.modifierGroups))
    expect(again.modifierGroups?.[0]?.options[0]?.priceCentsByVariant).toEqual({ [large]: 7500 })
  })

  it('leaves them alone on an update that omits their columns', () => {
    const { rows } = plan('Handle,Title\ncanopy,Canopy v2\n', [canopy], overwrite)
    expect(rows[0]?.diff.map((change) => change.fieldId)).toEqual(['title'])
    const next = applyProductRow(canopy.doc, productRowChanges(rows[0] as ProductPlannedRow), (names) => [...names])
    expect(next.modifierGroups).toEqual(canopy.doc.modifierGroups)
    expect(next.checkIn).toEqual(canopy.doc.checkIn)
    expect(next.posQuickKey).toBe(true)
  })

  it('leaves a variant’s own check-in alone when a row changes the rest of it', () => {
    const stored = {
      ...canopy,
      doc: { ...canopy.doc, variants: canopy.doc.variants.map((variant) => (variant.id === 'b' ? { ...variant, checkIn: { enabled: true } } : variant)) },
    }
    const { rows } = plan('SKU,Variant Price\nC-2,510\n', [stored], overwrite)
    const next = applyProductRow(stored.doc, productRowChanges(rows[0] as ProductPlannedRow), (names) => [...names])
    expect(next.variants[1]).toMatchObject({ priceUsd: 510, checkIn: { enabled: true } })
    expect(next.variants[1]?.checkIn).toEqual({ enabled: true })
  })

  it('leaves them alone on a blank cell, and keeps what a product has under the default policy', () => {
    expect(plan('Handle,Title,Check-in,Add-ons,Quick key\ncanopy,Canopy,,,\n', [canopy], overwrite).rows[0]?.verdict).toBe('unchanged')
    const kept = plan('Handle,Check-in,Add-ons\ncanopy,No,Bag: Other\n', [canopy])
    expect(kept.rows[0]?.verdict).toBe('unchanged')
  })

  it('clears them when the person chose to clear blanks', () => {
    const { rows } = plan('Handle,Quick key,Check-in,Add-ons\ncanopy,,,\n', [canopy], {
      policy: { fieldDefault: { mode: 'overwrite', blank: 'clear' } },
    })
    const next = applyProductRow(canopy.doc, productRowChanges(rows[0] as ProductPlannedRow), (names) => [...names])
    expect(next.modifierGroups).toBeUndefined()
    expect(next.checkIn).toBeUndefined()
    expect(next.posQuickKey).toBeUndefined()
  })

  it('keeps the ids of the groups and choices a cell still names, so a cart holding one finds it', () => {
    const { rows } = plan(
      'Handle,Add-ons\ncanopy,"walls (at least 1, at most 2): BACK WALL +$60.00 (10x20 +$80.00), New wall +$10.00"\n',
      [canopy],
      overwrite,
    )
    expect(rows[0]?.verdict).toBe('update')
    const next = applyProductRow(canopy.doc, productRowChanges(rows[0] as ProductPlannedRow), (names) => [...names])
    expect(next.modifierGroups).toHaveLength(1)
    expect(next.modifierGroups?.[0]?.id).toBe('g-walls')
    expect(next.modifierGroups?.[0]?.options[0]).toEqual({
      id: 'o-back',
      name: 'BACK WALL',
      priceCents: 6000,
      priceCentsByVariant: { b: 8000 },
    })
    expect(next.modifierGroups?.[0]?.options[1]).toMatchObject({ id: 'o-new-wall', name: 'New wall', priceCents: 1000 })
  })

  it('prices a choice on a variant a later row of the same file adds', () => {
    const { rows } = plan(
      'Handle,Add-ons,Option1 Value,Variant Price\ncanopy,"Walls (at least 1): Back wall +$50.00 (20x20 +$90.00)",10x10,300\ncanopy,,20x20,700\n',
      [canopy],
      overwrite,
    )
    expect(rows[0]?.commerce?.problem).toBeUndefined()
    const added = rows[1]?.commerce?.variant?.id as string
    let product = canopy.doc
    for (const row of rows) product = applyProductRow(product, productRowChanges(row), (names) => [...names])
    expect(product.modifierGroups?.[0]?.options[0]?.priceCentsByVariant).toEqual({ [added]: 9000 })
  })

  describe('a cell the dry run can’t read', () => {
    it.each([
      ['Milk', /after a colon/],
      ['Milk: Whole +$1.234', /is not a price/],
      ['Milk: Whole -$1.00', /is not a price/],
      ['Milk (some): Whole', /not a group setting/],
      ['Milk: Whole (vinyl)', /needs a variant and a price/],
      ['Milk: Whole +$1,000.00', /without a comma/],
      ['Milk: "Whole', /not closed/],
      ['Time: 12:00', /double quotes/],
    ])('%s is dropped with its row and reason, and nothing is written', (cell, message) => {
      const { rows, result } = planFor(cell)
      expect(rows[0]?.verdict).toBe('create')
      expect(created(rows[0]).modifierGroups).toBeUndefined()
      const dropped = result.warnings.find((warning) => warning.class === 'droppedCell')
      expect(dropped?.requiresAcknowledgement).toBe(true)
      expect(dropped?.samples[0]).toMatchObject({ row: 0, fieldId: 'modifierGroups', value: cell })
      expect(dropped?.samples[0]?.detail).toMatch(message)
    })

    it.each([['maybe'], ['Yes, lots of people'], ['No, 2 people']])('a check-in of %s is too', (cell) => {
      const { rows, result } = plan(`Handle,Title,Variant Price,Check-in\nmug,Mug,5,"${cell}"\n`)
      expect(created(rows[0]).checkIn).toBeUndefined()
      expect(result.warnings.find((warning) => warning.class === 'droppedCell')?.samples[0]).toMatchObject({ fieldId: 'checkIn' })
    })

    it('a quick key that is neither yes nor no is too', () => {
      const { rows, result } = plan('Handle,Title,Variant Price,Quick key\nmug,Mug,5,perhaps\n')
      expect(created(rows[0]).posQuickKey).toBeUndefined()
      expect(result.warnings.find((warning) => warning.class === 'droppedCell')?.samples[0]).toMatchObject({ fieldId: 'posQuickKey' })
    })
  })

  describe('add-ons the store would refuse fail the product, by the model’s own checks', () => {
    const many = (count: number, text: (at: number) => string) => Array.from({ length: count }, (_, at) => text(at))

    it.each([
      ['eleven groups', many(11, (at) => `Group ${at}: A`).join('; '), /At most 10 modifier groups/],
      ['twenty-one choices', `Milk: ${many(21, (at) => `Choice ${at}`).join(', ')}`, /more than 20 choices/],
      ['a choice over the ceiling', 'Milk: Gold +$1000.01', /price of \$0 to \$1,000/],
      ['an at most above its choices', 'Milk (at most 3): Whole, Oat', /allows 1 to 2 choices/],
      ['an at least above its at most', 'Milk (at least 2, at most 1): Whole, Oat', /requires more choices than it allows/],
      ['no choices', 'Milk:', /Add a choice/],
      ['a price for a variant it lacks', 'Milk: Oat +$1.00 (Large +$2.00)', /no variant by that name/],
    ])('%s', (_name, cell, message) => {
      expect(planFor(cell).rows[0]?.commerce?.problem).toMatch(message)
    })

    it('a check-in for more people than one item admits', () => {
      const { rows } = plan('Handle,Title,Variant Price,Check-in\nmug,Mug,5,"Yes, 51 people"\n')
      expect(rows[0]?.commerce?.problem).toMatch(/People per item must be a whole number from 1 to 50/)
    })

    it('a variant’s check-in for more people than one item admits', () => {
      const { rows } = plan('Handle,Title,Variant Price,Variant check-in\nmug,Mug,5,"Yes, 51 people"\n')
      expect(rows[0]?.commerce?.problem).toMatch(/People per item/)
    })

    describe('the 100-combination rule', () => {
      /** Six rows naming 5 × 5 × 5 option values: 125 combinations from 5 variants. */
      const sparse = (extraHeader: string, extraCell: string) => {
        const lines = ['A', 'B', 'C', 'D', 'E'].map(
          (value, at) => `wide,${at === 0 ? 'Wide' : ''},${at === 0 ? 'X' : ''},X${value},${at === 0 ? 'Y' : ''},Y${value},${at === 0 ? 'Z' : ''},Z${value},${at + 1}${at === 0 ? extraCell : extraHeader ? ',' : ''}`,
        )
        return `Handle,Title,Option1 Name,Option1 Value,Option2 Name,Option2 Value,Option3 Name,Option3 Value,Variant Price${extraHeader}\n${lines.join('\n')}\n`
      }

      it('refuses add-ons on a product whose options make more than a product holds', () => {
        const { rows } = plan(sparse(',Add-ons', ',Milk: Oat'))
        expect(rows[0]?.commerce?.problem).toMatch(/These options make 125 combinations, and a product holds at most 100/)
      })

      it('leaves the same file without an Add-ons column exactly as it was', () => {
        const { rows } = plan(sparse('', ''))
        expect(rows[0]?.commerce?.problem).toBeUndefined()
        expect(rows.every((row) => row.verdict === 'create')).toBe(true)
      })

      it('holds at exactly 100', () => {
        const { rows } = plan(
          'Handle,Title,Option1 Name,Option1 Value,Option2 Name,Option2 Value,Variant Price,Add-ons\n' +
            many(10, (a) => many(10, (b) => `grid,Grid,X,X${a},Y,Y${b},1,Milk: Oat`).join('\n')).join('\n') +
            '\n',
        )
        expect(rows[0]?.commerce?.problem).toBeUndefined()
      })
    })
  })

  describe('a cell on a product’s other rows', () => {
    it('is read when the first row leaves it blank', () => {
      const { rows } = plan('Handle,Title,Variant Price,Option1 Name,Option1 Value,Add-ons\nx,X,1,Size,S,\nx,,2,,M,Milk: Oat\n')
      expect(created(rows[0]).modifierGroups?.[0]?.name).toBe('Milk')
    })

    it('is the same product’s setting when every row repeats it, with no warning', () => {
      const { result } = plan('Handle,Title,Variant Price,Option1 Name,Option1 Value,Add-ons\nx,X,1,Size,S,Milk: Oat\nx,,2,,M,Milk: Oat\n')
      expect(result.warnings.map((warning) => warning.class)).not.toContain('droppedCell')
    })

    it('is reported when it disagrees with the first row’s, never dropped without a word', () => {
      const { rows, result } = plan('Handle,Title,Variant Price,Option1 Name,Option1 Value,Add-ons\nx,X,1,Size,S,Milk: Oat\nx,,2,,M,Milk: Soy\n')
      expect(created(rows[0]).modifierGroups?.[0]?.options[0]?.name).toBe('Oat')
      expect(result.warnings.find((warning) => warning.class === 'droppedCell')?.samples[0]).toMatchObject({
        row: 1,
        fieldId: 'modifierGroups',
        value: 'Milk: Soy',
      })
    })

    it('is reported when it cannot be read on a row with no variant', () => {
      const { result } = plan('Handle,Title,Variant Price,Image,Add-ons\nx,X,1,https://cdn.example.com/1.jpg,\nx,,,https://cdn.example.com/2.jpg,Milk\n')
      expect(result.warnings.find((warning) => warning.class === 'droppedCell')?.samples[0]).toMatchObject({ row: 1, fieldId: 'modifierGroups' })
    })
  })

  it('stays out of the Shopify preset', () => {
    for (const fieldId of ['posQuickKey', 'checkIn', 'variantCheckIn', 'modifierGroups']) {
      expect(SHOPIFY_PRODUCT_PRESET.fieldIds).not.toContain(fieldId)
    }
  })
})
