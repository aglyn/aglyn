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
 * Wix and Squarespace product files (AGL-4245), the pure half: each file is
 * read the way the job engine reads one (headers matched with the product
 * dictionaries, cells derived) and folded by `planProductTransfer` with the
 * source its headers name. The files are written here by hand from each
 * platform's documented column list, with made-up products and addresses on
 * reserved `.test` names; they are not any real store's export.
 */

import {
  buildTransferFieldCatalog,
  createTransferPolicy,
  deriveTransferRow,
  isTransferFieldExportable,
  isTransferFieldImportable,
  mapTransferRow,
  matchHeaders,
  readTransferSource,
  TRANSFER_FILE_SAMPLE_ROW,
  type TransferPlanRow,
} from '@aglyn/aglyn/data-transfer'
import {
  PRODUCT_ALIAS_DICTIONARIES,
  PRODUCT_DERIVED_FIELDS,
  PRODUCT_FIELD,
  PRODUCT_LOCKED_RULES,
  PRODUCT_STANDARD_FIELDS,
  PRODUCT_SYSTEM_FIELDS,
  PRODUCT_TRANSFER_GROUPS,
  createProductDocument,
  planProductTransfer,
  productPlanPhotoUrls,
  type ProductPlannedRow,
} from './product-transfer'
import { PRODUCT_IMPORT_IMAGES_MAX, productImageCell, productImageList } from './product-images'
import { SOURCE_FIELD, SOURCE_ONLY_FIELDS, productFileSource, wixChoiceName } from './product-sources'

const catalog = buildTransferFieldCatalog({
  standard: PRODUCT_STANDARD_FIELDS,
  derived: PRODUCT_DERIVED_FIELDS,
  system: PRODUCT_SYSTEM_FIELDS,
  groups: PRODUCT_TRANSFER_GROUPS,
})
const importable = catalog.fields.filter(isTransferFieldImportable)

const mappingOf = (headers: readonly string[]) =>
  matchHeaders(headers, importable, { dictionaries: PRODUCT_ALIAS_DICTIONARIES }).proposals.map(
    (proposal) => [proposal.header, proposal.fieldId] as const,
  )

const csvLine = (cells: readonly string[]) =>
  cells.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(',')

/** A file through the engine's read, map and derive, then the products plan with the source its headers name. */
function plan(headers: readonly string[], lines: ReadonlyArray<Readonly<Record<string, string>>>) {
  const csv = [csvLine(headers), ...lines.map((line) => csvLine(headers.map((header) => line[header] ?? '')))].join('\n')
  const read = readTransferSource(csv, 'csv')
  if ('problem' in read) throw new Error(read.problem.message)
  const { mapping } = matchHeaders(read.table.headers, importable, { dictionaries: PRODUCT_ALIAS_DICTIONARIES })
  const rows: TransferPlanRow[] = read.table.rows.map((cells, index) => {
    const derived = deriveTransferRow(catalog.byId, mapTransferRow(cells, mapping))
    return { index, values: derived.values, derivations: derived.derivations, problems: derived.problems }
  })
  let ids = 0
  let variants = 0
  const result = planProductTransfer(
    {
      fields: catalog.fields,
      rows,
      matches: rows.map(() => ({ kind: 'new' as const })),
      existing: new Map(),
      policy: createTransferPolicy({ locked: PRODUCT_LOCKED_RULES }),
    },
    {
      newProductId: () => `p${(ids += 1)}`,
      newVariantId: () => `v${(variants += 1)}`,
      source: productFileSource(read.table.headers, rows),
    },
  )
  const planned = result.rows as ProductPlannedRow[]
  const products = planned
    .filter((row) => row.commerce?.role === 'create' && row.commerce.create)
    .map((row) => createProductDocument(row.commerce?.create as never, (names) => [...names]))
  return { result, planned, products }
}

const screeningOf = (result: ReturnType<typeof plan>['result']) => result.warnings.find((warning) => warning.class === 'screening')

/*------------------------------------------
 * The files, by each platform's column list
 *-----------------------------------------*/

const range = (count: number) => Array.from({ length: count }, (_value, at) => at + 1)

const WIX_HEADERS = [
  'handleId',
  'fieldType',
  'name',
  'description',
  'productImageUrl',
  'collection',
  'sku',
  'ribbon',
  'price',
  'surcharge',
  'visible',
  'discountMode',
  'discountValue',
  'inventory',
  'weight',
  'cost',
  ...range(6).flatMap((n) => [`productOptionName${n}`, `productOptionType${n}`, `productOptionDescription${n}`]),
  ...range(6).flatMap((n) => [`additionalInfoTitle${n}`, `additionalInfoDescription${n}`]),
  ...range(2).flatMap((n) => [`customTextField${n}`, `customTextCharLimit${n}`, `customTextMandatory${n}`]),
  'brand',
]

const SQUARESPACE_HEADERS = [
  'Product ID [Non Editable]',
  'Variant ID [Non Editable]',
  'Product Type [Non Editable]',
  'Product Page',
  'Product URL',
  'Title',
  'Description',
  'SKU',
  'Option Name 1',
  'Option Value 1',
  'Option Name 2',
  'Option Value 2',
  'Option Name 3',
  'Option Value 3',
  'Price',
  'Sale Price',
  'On Sale',
  'Stock',
  'Categories',
  'Tags',
  'Weight',
  'Length',
  'Width',
  'Height',
  'Visible',
  'Hosted Image URLs',
]

/** Shopify's whole product CSV header row, every column it writes. */
const SHOPIFY_HEADERS = [
  'Handle',
  'Title',
  'Body (HTML)',
  'Vendor',
  'Product Category',
  'Type',
  'Tags',
  'Published',
  'Option1 Name',
  'Option1 Value',
  'Option1 Linked To',
  'Option2 Name',
  'Option2 Value',
  'Option2 Linked To',
  'Option3 Name',
  'Option3 Value',
  'Option3 Linked To',
  'Variant SKU',
  'Variant Grams',
  'Variant Inventory Tracker',
  'Variant Inventory Qty',
  'Variant Inventory Policy',
  'Variant Fulfillment Service',
  'Variant Price',
  'Variant Compare At Price',
  'Variant Requires Shipping',
  'Variant Taxable',
  'Variant Barcode',
  'Image Src',
  'Image Position',
  'Image Alt Text',
  'Gift Card',
  'SEO Title',
  'SEO Description',
  'Variant Image',
  'Variant Weight Unit',
  'Variant Tax Code',
  'Cost per item',
  'Status',
]

describe('recognizing the file', () => {
  it('names Wix and Squarespace by their header signature, in any case, and nothing else', () => {
    expect(productFileSource(WIX_HEADERS)).toBe('wix')
    expect(productFileSource(WIX_HEADERS.map((header) => header.toUpperCase()))).toBe('wix')
    expect(productFileSource(SQUARESPACE_HEADERS)).toBe('squarespace')
    expect(productFileSource(SQUARESPACE_HEADERS.filter((header) => header !== 'Variant ID [Non Editable]'))).toBe('squarespace')
    expect(productFileSource(SHOPIFY_HEADERS)).toBeNull()
    expect(productFileSource(['Title', 'Price', 'SKU'])).toBeNull()
  })

  it("maps a Wix file's columns with nothing to pick, and leaves the columns Aglyn has no field for unmapped", () => {
    const mapped = new Map(mappingOf(WIX_HEADERS))
    expect(Object.fromEntries([...mapped].filter(([, fieldId]) => fieldId))).toEqual({
      handleId: SOURCE_FIELD.sourceProductId,
      fieldType: SOURCE_FIELD.rowType,
      name: PRODUCT_FIELD.title,
      description: PRODUCT_FIELD.description,
      productImageUrl: PRODUCT_FIELD.images,
      collection: PRODUCT_FIELD.categories,
      sku: PRODUCT_FIELD.sku,
      price: PRODUCT_FIELD.price,
      surcharge: SOURCE_FIELD.priceSurcharge,
      visible: PRODUCT_FIELD.published,
      discountMode: SOURCE_FIELD.discountType,
      discountValue: SOURCE_FIELD.discountAmount,
      inventory: PRODUCT_FIELD.inventory,
      weight: PRODUCT_FIELD.weightGrams,
      productOptionName1: PRODUCT_FIELD.option1Name,
      productOptionName2: PRODUCT_FIELD.option2Name,
      productOptionName3: PRODUCT_FIELD.option3Name,
      productOptionDescription1: PRODUCT_FIELD.option1Value,
      productOptionDescription2: PRODUCT_FIELD.option2Value,
      productOptionDescription3: PRODUCT_FIELD.option3Value,
    })
  })

  it("maps a Squarespace file's columns the same way", () => {
    const mapped = Object.fromEntries(mappingOf(SQUARESPACE_HEADERS).filter(([, fieldId]) => fieldId))
    expect(mapped).toEqual({
      'Product ID [Non Editable]': SOURCE_FIELD.sourceProductId,
      'Product Type [Non Editable]': SOURCE_FIELD.sourceType,
      'Product URL': PRODUCT_FIELD.handle,
      Title: PRODUCT_FIELD.title,
      Description: PRODUCT_FIELD.description,
      SKU: PRODUCT_FIELD.sku,
      'Option Name 1': PRODUCT_FIELD.option1Name,
      'Option Value 1': PRODUCT_FIELD.option1Value,
      'Option Name 2': PRODUCT_FIELD.option2Name,
      'Option Value 2': PRODUCT_FIELD.option2Value,
      'Option Name 3': PRODUCT_FIELD.option3Name,
      'Option Value 3': PRODUCT_FIELD.option3Value,
      Price: PRODUCT_FIELD.price,
      'Sale Price': SOURCE_FIELD.salePrice,
      'On Sale': SOURCE_FIELD.onSale,
      Stock: PRODUCT_FIELD.inventory,
      Categories: PRODUCT_FIELD.categories,
      Tags: PRODUCT_FIELD.tags,
      Weight: PRODUCT_FIELD.weightGrams,
      Visible: PRODUCT_FIELD.published,
      'Hosted Image URLs': PRODUCT_FIELD.images,
    })
  })

  it("still maps a Shopify file as before, and never to a field that only reads another store's file", () => {
    const mapped = Object.fromEntries(mappingOf(SHOPIFY_HEADERS).filter(([, fieldId]) => fieldId))
    expect(mapped).toMatchObject({
      Handle: PRODUCT_FIELD.handle,
      'Body (HTML)': PRODUCT_FIELD.description,
      'Variant Price': PRODUCT_FIELD.price,
      'Variant Compare At Price': PRODUCT_FIELD.compareAtPrice,
      'Image Src': PRODUCT_FIELD.image,
      'Variant Image': PRODUCT_FIELD.variantImage,
    })
    for (const fieldId of [...SOURCE_ONLY_FIELDS, PRODUCT_FIELD.images]) expect(Object.values(mapped)).not.toContain(fieldId)
  })

  it("offers the fields that only read another store's file on import, never on export", () => {
    const exported = catalog.fields.filter(isTransferFieldExportable).map((field) => field.id)
    for (const fieldId of SOURCE_ONLY_FIELDS) {
      expect(importable.map((field) => field.id)).toContain(fieldId)
      expect(exported).not.toContain(fieldId)
    }
    expect(exported).toContain(PRODUCT_FIELD.images)
  })

  it('uses the same field ids as the products resource', () => {
    for (const fieldId of Object.values(SOURCE_FIELD)) expect(Object.values(PRODUCT_FIELD)).toContain(fieldId)
  })
})

/*------------------------------------------
 * Wix
 *-----------------------------------------*/

describe('a Wix Stores file', () => {
  const tee = { handleId: 'product_tee-0001' }
  const file = [
    {
      ...tee,
      fieldType: 'Product',
      name: 'Field tee',
      description: '<p>Soft <strong>cotton</strong></p>',
      productImageUrl: 'a1b2c3_d4e5~mv2.jpg;https://static.wix-media.test/media/tee-front.jpg',
      collection: 'Shirts;Summer',
      sku: 'TEE',
      ribbon: 'New',
      price: '25',
      visible: 'true',
      discountMode: 'PERCENT',
      discountValue: '20',
      inventory: 'InStock',
      weight: '0.3',
      cost: '8',
      productOptionName1: 'Color',
      productOptionType1: 'COLOR',
      productOptionDescription1: '#000000:Black,#FFFFFF:White',
      productOptionName2: 'Size',
      productOptionType2: 'DROP_DOWN',
      productOptionDescription2: 'S,M',
      additionalInfoTitle1: 'Care',
      additionalInfoDescription1: 'Wash cold',
      brand: 'Trailhead',
    },
    {
      ...tee,
      fieldType: 'Variant',
      sku: 'TEE-BK-S',
      surcharge: '0',
      visible: 'true',
      inventory: 'InStock',
      productOptionDescription1: '#000000:Black',
      productOptionDescription2: 'S',
    },
    {
      ...tee,
      fieldType: 'Variant',
      sku: 'TEE-WH-M',
      surcharge: '2',
      visible: 'true',
      inventory: 'OutOfStock',
      productOptionDescription1: '#FFFFFF:White',
      productOptionDescription2: 'M',
    },
    {
      handleId: 'product_mug-0002',
      fieldType: 'Product',
      name: 'Camp mug',
      description: '<p>Enamel</p>',
      productImageUrl: 'https://static.wix-media.test/media/mug.jpg',
      sku: 'MUG',
      price: '12',
      visible: 'false',
      discountMode: 'AMOUNT',
      discountValue: '2',
      inventory: '5',
    },
    {
      handleId: 'product_cap-0003',
      fieldType: 'Product',
      name: 'Trail cap',
      price: '18',
      visible: 'true',
      inventory: '9',
      productOptionName1: 'Size',
      productOptionDescription1: 'S/M,L/XL',
    },
  ]

  it('makes one product of a Product row and its Variant rows, with each choice, price and stock', () => {
    const { planned, products } = plan(WIX_HEADERS, file)
    expect(planned.map((row) => row.verdict)).toEqual(['create', 'create', 'create', 'create', 'create'])
    const [teeProduct, mug, cap] = products
    expect(teeProduct).toMatchObject({
      name: 'Field tee',
      slug: 'field-tee',
      status: 'active',
      description: '<p>Soft <strong>cotton</strong></p>',
      options: [
        { name: 'Color', values: ['Black', 'White'] },
        { name: 'Size', values: ['S', 'M'] },
      ],
      categoryIds: ['Shirts', 'Summer'],
    })
    expect(teeProduct?.variants.map((variant) => [variant.sku, variant.options, variant.priceUsd, variant.compareAtPriceUsd, variant.inventory])).toEqual([
      // 20% off $25, and 20% off $25 + $2.
      ['TEE-BK-S', { Color: 'Black', Size: 'S' }, 20, 25, null],
      ['TEE-WH-M', { Color: 'White', Size: 'M' }, 21.6, 27, 0],
    ])
    // No weight: the file does not say its unit.
    expect(teeProduct?.variants.some((variant) => variant.weightGrams !== undefined)).toBe(false)
    expect(mug).toMatchObject({ name: 'Camp mug', status: 'draft' })
    expect(mug?.variants).toEqual([expect.objectContaining({ sku: 'MUG', priceUsd: 10, compareAtPriceUsd: 12, inventory: 5 })])
    // Choices with no variant rows: one variant, and the dry run says so.
    expect(cap?.options).toBeUndefined()
    expect(cap?.variants).toEqual([expect.objectContaining({ priceUsd: 18, inventory: 9 })])
  })

  it('copies every full photo address, and reports the bare Wix media names and the weights it leaves out', () => {
    const { result, products } = plan(WIX_HEADERS, file)
    expect(products[0]?.mediaUrls).toEqual(['https://static.wix-media.test/media/tee-front.jpg'])
    expect(productPlanPhotoUrls(result.rows)).toEqual([
      'https://static.wix-media.test/media/tee-front.jpg',
      'https://static.wix-media.test/media/mug.jpg',
    ])
    const screening = screeningOf(result)
    expect(screening?.requiresAcknowledgement).toBe(true)
    const details = screening?.samples.map((sample) => sample.detail) ?? []
    expect(details[0]).toMatch(/^Copies 2 photos into your media library, in a folder named "Imported products"/)
    expect(details).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^1 photo is not copied/),
        expect.stringMatching(/^Weights are not brought in, because a Wix file/),
        expect.stringMatching(/choices have no variant rows/),
        expect.stringMatching(/names the photo but not where it is online/),
      ]),
    )
    expect(screening?.samples.find((sample) => /online/.test(sample.detail))).toMatchObject({ row: 0, value: 'a1b2c3_d4e5~mv2.jpg' })
    expect(result.acknowledgementsRequired).toContain('screening')
    // Stock written as words is read, never reported as a cell it could not read.
    expect(result.warnings.find((warning) => warning.class === 'droppedCell')).toBeUndefined()
  })

  it('reads a colour choice by its name', () => {
    expect(wixChoiceName('#00ff00:Moss green')).toBe('Moss green')
    expect(wixChoiceName('Large')).toBe('Large')
  })
})

/*------------------------------------------
 * Squarespace
 *-----------------------------------------*/

describe('a Squarespace file', () => {
  const file = [
    {
      'Product ID [Non Editable]': '5f1a0001',
      'Variant ID [Non Editable]': 'v-1',
      'Product Type [Non Editable]': 'PHYSICAL',
      'Product Page': 'shop',
      'Product URL': '/shop/p/linen-apron',
      Title: 'Linen apron',
      Description: '<p>Stonewashed</p>',
      SKU: 'APR-NAT',
      'Option Name 1': 'Color',
      'Option Value 1': 'Natural',
      Price: '40.00',
      'Sale Price': '32.00',
      'On Sale': 'Yes',
      Stock: '6',
      Categories: 'Kitchen',
      Tags: 'linen, gifts',
      Weight: '1',
      Visible: 'Yes',
      'Hosted Image URLs': 'https://images.squarespace-cdn.test/a/apron-1.jpg https://images.squarespace-cdn.test/a/apron-2.jpg',
    },
    {
      'Product ID [Non Editable]': '5f1a0001',
      'Variant ID [Non Editable]': 'v-2',
      SKU: 'APR-CHR',
      'Option Value 1': 'Charcoal',
      Price: '40.00',
      'Sale Price': '0.00',
      'On Sale': 'No',
      Stock: 'Unlimited',
    },
    {
      'Product Type [Non Editable]': 'DIGITAL',
      'Product URL': 'pattern-pack',
      Title: 'Pattern pack',
      SKU: 'PAT',
      Price: '9',
      Stock: 'Unlimited',
      Visible: 'No',
      'Hosted Image URLs': 'http://images.squarespace-cdn.test/a/pattern.jpg',
    },
    { SKU: 'PAT-XL', 'Option Value 1': 'XL', Price: '11' },
    {
      'Product ID [Non Editable]': '5f1a0009',
      'Product Type [Non Editable]': 'GIFT_CARD',
      Title: 'Gift card',
      Price: '50',
    },
    {
      'Product ID [Non Editable]': '5f1a0010',
      'Product Type [Non Editable]': 'SERVICE',
      'Product URL': 'sharpening',
      Title: 'Knife sharpening',
      Price: '15',
    },
  ]

  it('groups variant rows under their product, keeps the old address, and reads sales, stock and kinds', () => {
    const { planned, products } = plan(SQUARESPACE_HEADERS, file)
    expect(planned.map((row) => row.verdict)).toEqual(['create', 'create', 'create', 'create', 'skip', 'create'])
    const [apron, pattern, sharpening] = products
    expect(apron).toMatchObject({ name: 'Linen apron', slug: 'linen-apron', type: 'physical', tags: ['linen', 'gifts'] })
    expect(apron?.variants.map((variant) => [variant.sku, variant.priceUsd, variant.compareAtPriceUsd, variant.inventory])).toEqual([
      ['APR-NAT', 32, 40, 6],
      ['APR-CHR', 40, undefined, null],
    ])
    expect(apron?.mediaUrls).toEqual([
      'https://images.squarespace-cdn.test/a/apron-1.jpg',
      'https://images.squarespace-cdn.test/a/apron-2.jpg',
    ])
    // A row with no product ID, handle or title belongs to the product above it.
    expect(pattern).toMatchObject({ name: 'Pattern pack', slug: 'pattern-pack', type: 'digital', status: 'draft' })
    expect(pattern?.variants.map((variant) => variant.sku)).toEqual(['PAT', 'PAT-XL'])
    expect(pattern?.mediaUrls).toBeUndefined()
    expect(sharpening).toMatchObject({ slug: 'sharpening', type: 'service' })
  })

  it('skips a gift card and an http:// photo, and says why', () => {
    const { result, planned } = plan(SQUARESPACE_HEADERS, file)
    expect(planned[4]).toMatchObject({ verdict: 'skip', reason: 'resourceRule' })
    const details = screeningOf(result)?.samples.map((sample) => sample.detail) ?? []
    expect(details).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Copies 2 photos/),
        expect.stringMatching(/A gift card is not a product/),
        expect.stringMatching(/starts with http:\/\//),
        expect.stringMatching(/a Squarespace file does not say whether/),
      ]),
    )
  })
})

/*------------------------------------------
 * Photos in any file
 *-----------------------------------------*/

describe('photo cells', () => {
  it('copies https, keeps a library file, and skips the rest', () => {
    expect(productImageCell('https://cdn.shop.test/p.jpg?v=3#top')).toEqual({ kind: 'copy', url: 'https://cdn.shop.test/p.jpg?v=3' })
    expect(productImageCell('https://cdn.shop.test/p.jpg?utm_source=x')).toEqual({ kind: 'copy', url: 'https://cdn.shop.test/p.jpg' })
    expect(productImageCell('cdn.shop.test/p.jpg')).toEqual({ kind: 'copy', url: 'https://cdn.shop.test/p.jpg' })
    expect(productImageCell('media:h1/abc123')).toEqual({ kind: 'stored', value: 'media:h1/abc123' })
    expect(productImageCell('http://cdn.shop.test/p.jpg')).toMatchObject({ kind: 'skip', skip: 'notHttps' })
    expect(productImageCell('https://user:pw@cdn.shop.test/p.jpg')).toMatchObject({ kind: 'skip', skip: 'notAddress' })
    expect(productImageCell('https://cdn.shop.test:8443/p.jpg')).toMatchObject({ kind: 'skip', skip: 'notAddress' })
    expect(productImageCell('ftp://cdn.shop.test/p.jpg')).toMatchObject({ kind: 'skip', skip: 'notAddress' })
    expect(productImageCell('abc~mv2.png')).toMatchObject({ kind: 'skip', skip: 'mediaName' })
    expect(productImageCell('  ')).toBeNull()
  })

  it('splits a cell of several, never on a comma an address may hold', () => {
    expect(productImageList('https://a.test/1.jpg; https://a.test/w_2,h_2/2.jpg | https://a.test/3.jpg\nhttps://a.test/1.jpg')).toEqual([
      'https://a.test/1.jpg',
      'https://a.test/w_2,h_2/2.jpg',
      'https://a.test/3.jpg',
    ])
  })

  it('copies at most the import limit of distinct photos, and lists the rest as skipped', () => {
    const headers = ['Handle', 'Title', 'Variant Price', 'Images']
    const many = Array.from({ length: PRODUCT_IMPORT_IMAGES_MAX + 2 }, (_value, at) => `https://cdn.shop.test/${at}.jpg`)
    const { result } = plan(headers, [{ Handle: 'poster', Title: 'Poster', 'Variant Price': '5', Images: many.join(';') }])
    expect(productPlanPhotoUrls(result.rows)).toHaveLength(PRODUCT_IMPORT_IMAGES_MAX)
    const screening = screeningOf(result)
    expect(screening?.samples[1]).toMatchObject({ row: TRANSFER_FILE_SAMPLE_ROW, detail: expect.stringMatching(/^2 photos are not copied/) })
    expect(screening?.samples.some((sample) => /up to 2,000 photos/.test(sample.detail))).toBe(true)
  })

  it('says how many photos a Shopify file copies, with nothing to acknowledge for that alone', () => {
    const headers = ['Handle', 'Title', 'Variant Price', 'Image Src', 'Variant Image']
    const { result, planned } = plan(headers, [
      { Handle: 'mug', Title: 'Mug', 'Variant Price': '12', 'Image Src': 'https://cdn.shop.test/mug.jpg', 'Variant Image': 'https://cdn.shop.test/mug-blue.jpg' },
      { Handle: 'mug', 'Image Src': 'https://cdn.shop.test/mug.jpg' },
    ])
    expect(planned[0]?.commerce?.create?.variants[0]?.values[PRODUCT_FIELD.variantImage]).toBe('https://cdn.shop.test/mug-blue.jpg')
    expect(screeningOf(result)).toMatchObject({ count: 2, requiresAcknowledgement: false })
    expect(result.acknowledgementsRequired).not.toContain('screening')
  })

  it('applies a sale price in any file that has one', () => {
    const headers = ['Handle', 'Title', 'Variant Price', 'Sale Price']
    const { products } = plan(headers, [{ Handle: 'lamp', Title: 'Lamp', 'Variant Price': '60', 'Sale Price': '45' }])
    expect(products[0]?.variants).toEqual([expect.objectContaining({ priceUsd: 45, compareAtPriceUsd: 60 })])
  })
})
