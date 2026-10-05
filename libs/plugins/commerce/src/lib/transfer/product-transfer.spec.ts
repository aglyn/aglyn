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
import type { HostProduct } from '../model/commerce'
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
