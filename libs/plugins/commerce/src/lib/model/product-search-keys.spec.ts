/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { liftLegacyProduct, productSearchFields, productStockFields } from './commerce'

/**
 * A product's search keys travel with its name (AGL-2501).
 *
 * The products hub filters by the QUERY now, over `nameTokens`, `nameLower`
 * and `skus`. Those are denormalizations, which means the catalog is only as
 * searchable as the write paths are disciplined — and the failure is the quiet
 * kind. A product whose keys were never written still LISTS normally; it is
 * missing only from searches, so the gap reads as "no such product" to the one
 * person looking for it.
 *
 * Firestore makes it quieter still: `array-contains` drops a document without
 * the array, and `orderBy` drops one without the field it sorts by. Neither
 * errors. There is no runtime signal at all — which is why this is a spec.
 */
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')
const read = (path: string) => readFileSync(join(REPO_ROOT, path), 'utf8')

describe('productSearchFields derives what the hub queries', () => {
  it('returns the name alongside the keys derived FROM it', () => {
    // Returning only the derived keys would leave them spread beside a
    // separately-written name, and the write that forgot would store keys for
    // a name it never saved.
    const fields = productSearchFields({ name: 'Acme Coffee' })
    expect(fields.name).toBe('Acme Coffee')
    expect(fields.nameLower).toBe('acme coffee')
    expect(fields.nameReversed).toBe('eeffoc emca')
  })

  it('tokenizes every word, so a search need not start at the first', () => {
    const { nameTokens } = productSearchFields({ name: 'Acme Coffee' })
    expect(nameTokens).toEqual(expect.arrayContaining(['acme', 'cof', 'coffee']))
    // What it still cannot do — the honest edge of doing this without a
    // search service.
    expect(nameTokens).not.toContain('offee')
  })

  it('flattens variant SKUs, lower-cased and de-duplicated', () => {
    // Lower-cased because the translator lower-cases the typed query before
    // building the `array-contains`; stored and typed must normalize alike.
    const { skus } = productSearchFields({
      name: 'Tee',
      variants: [
        { id: 'a', priceUsd: 10, sku: 'ABC-123' },
        { id: 'b', priceUsd: 10, sku: 'abc-123' },
        { id: 'c', priceUsd: 10, sku: '  DEF-456 ' },
        { id: 'd', priceUsd: 10 },
      ],
    })
    expect(skus).toEqual(['abc-123', 'def-456'])
  })

  it('OMITS skus entirely when no variant has one', () => {
    /*
     * `isNotEmpty` is served as `!= null`, and an empty array is not null. A
     * product written with `skus: []` would answer "has a SKU" — so the field
     * has to be absent, not empty.
     */
    const fields = productSearchFields({
      name: 'Tee',
      variants: [{ id: 'a', priceUsd: 10 }],
    })
    expect('skus' in fields).toBe(false)
    expect('skus' in productSearchFields({ name: 'Tee' })).toBe(false)
  })
})

describe('every product write path carries them', () => {
  /*
   * A static check, because there is no runtime one. Products are written
   * from three places and none of them shares a function with the others: the
   * editor dialog builds one payload for both create and edit, the import
   * (the transfer resource's server half) builds its own, and the console's resources route decides which keys it
   * will store at all.
   */
  const DIALOG =
    'libs/plugins/commerce/src/lib/components/console/product-editor-dialog.component.tsx'
  const HUB =
    'libs/plugins/commerce/src/lib/components/console/products-hub-card.component.tsx'
  const ROUTE = 'apps/console/app/api/hosts/resources/route.ts'
  const CONFIG = 'plugins.config.json'

  it('the editor dialog derives the name rather than assigning it', () => {
    const source = read(DIALOG)
    expect(source).toContain('CommerceModel.productSearchFields({')
    /*
     * The payload must not ALSO set a bare `name:` of its own, which would win
     * or lose by spread order — the exact bug this guards is a rename that
     * stores the new name beside the old name's keys.
     *
     * Scoped to the literal's OWN properties by indentation: the name passed
     * as an argument to the helper is nested one level deeper, and matching
     * that would flag the correct code.
     */
    const base = source.slice(
      source.indexOf('const base = {'),
      source.indexOf('    try {'),
    )
    expect(base).toContain('productSearchFields({')
    expect(base).not.toMatch(/\n {6}name:/)
  })

  it('the import derives them too', () => {
    // A catalog arrives here in bulk, which is precisely the catalog the
    // 500-row window cannot show and the search has to reach.
    const importer = read('libs/plugins/commerce/src/lib/transfer/products.server.ts')
    expect(importer).toContain('...productSearchFields(product)')
    expect(importer).toContain('...derivedKeys(product, smart)')
    expect(importer).toContain('...withoutUndefined(derivedKeys(next, smart))')
  })

  it('the resources route stores all four', () => {
    // An allow-list, so a key nobody named is silently dropped — a create
    // would succeed and the product would simply never be findable. The
    // route's list for a product is the kind this plugin declares beside its
    // collection (AGL-3080), so that declaration is what is read.
    const config = JSON.parse(read(CONFIG)) as {
      plugins: Array<{
        id: string
        hostCollections?: Array<{ name: string; resource?: { kind: string; fields: string[] } }>
      }>
    }
    const product = config.plugins
      .find((plugin) => plugin.id === 'commerce')
      ?.hostCollections?.find((collection) => collection.resource?.kind === 'product')
    expect(product?.name).toBe('products')
    // The route resolves undeclared kinds to a refusal, never to a list, so
    // the route has to be the one reading the declaration for this to hold.
    expect(read(ROUTE)).toContain('pluginHostResource(key)')
    for (const key of [
      'nameLower',
      'nameTokens',
      'nameReversed',
      'skus',
      'barcodes',
      'priceFromCents',
      'soldOut',
    ]) {
      expect([key, product?.resource?.fields.includes(key)]).toEqual([key, true])
    }
  })

  it('every stock writer stores the In stock verdict with the count', () => {
    // A sale, a cancellation, a stock adjustment, an import and the editor: each writes
    // `variants`, and `soldOut` is derived from them (AGL-3321).
    for (const path of [
      'libs/plugins/commerce/src/lib/server/reserve-stock.ts',
      'libs/plugins/commerce/src/lib/server/cancel-order.ts',
      'libs/plugins/commerce/src/lib/transfer/products.server.ts',
      HUB,
      DIALOG,
    ]) {
      expect(read(path)).toContain('productStockFields(')
    }
  })

  it('THE CONTROL: those files exist and mention products', () => {
    // Otherwise every assertion above passes on an empty string the day a
    // file is renamed.
    for (const path of [DIALOG, HUB, ROUTE]) {
      expect(read(path).length).toBeGreaterThan(1000)
    }
    expect(read(CONFIG)).toContain('"name": "products"')
  })
})

/**
 * The worked examples the products backfill restates this logic against
 * (AGL-3321). `tools/scripts/backfill-products-list-fields.mjs` cannot import
 * the library, so it carries a copy of the key builder, the stock verdict and
 * the legacy lift's defaults; its `--self-test` runs these same fixtures, so
 * the copy cannot stamp a key the writers and the queries do not use.
 */
describe('the backfill fixtures are what the library writes', () => {
  const fixtures = JSON.parse(
    read('tools/scripts/lib/product-list-fields.fixtures.json'),
  ) as {
    keys: Array<{ product: { name: string; variants?: never[] }; expected: Record<string, unknown> }>
    stock: Array<{ product: Record<string, unknown>; expected: Record<string, unknown> }>
    lift: Array<{ product: Record<string, unknown>; expected: Record<string, unknown> }>
  }

  it.each(fixtures.keys.map((fixture, at) => [at, fixture] as const))(
    'search keys #%i',
    (_at, { product, expected }) => {
      expect(productSearchFields(product)).toEqual({ name: product.name, ...expected })
    },
  )

  it.each(fixtures.stock.map((fixture, at) => [at, fixture] as const))(
    'stock #%i',
    (_at, { product, expected }) => {
      expect(productStockFields(product as never)).toEqual(expected)
    },
  )

  it.each(fixtures.lift.map((fixture, at) => [at, fixture] as const))(
    'legacy lift #%i',
    (_at, { product, expected }) => {
      const lifted = liftLegacyProduct(product as never)
      const keys = productSearchFields({ name: lifted.name, variants: lifted.variants })
      const stored: Record<string, unknown> = {
        status: lifted.status ?? null,
        type: lifted.type ?? null,
        nameLower: keys.nameLower,
        priceFromCents: keys.priceFromCents,
        soldOut: productStockFields(lifted).soldOut,
      }
      expect(stored).toEqual(expected)
    },
  )

  it('covers every field the fixtures pin', () => {
    expect(fixtures.keys.length).toBeGreaterThan(3)
    expect(fixtures.stock.length).toBeGreaterThan(3)
    expect(fixtures.lift.length).toBeGreaterThan(2)
  })
})
