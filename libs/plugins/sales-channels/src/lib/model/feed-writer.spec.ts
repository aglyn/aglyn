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

import type { CatalogOffer } from '@aglyn/aglyn/plugin-manager/plugin-product-catalog'
import { makeOffer, makeSettings, makeStore } from '../testing/catalog-fixtures'
import { salesChannel, SALES_CHANNELS, type SalesChannelId } from './channels'
import { FEED_COLUMNS, resolveOffer } from './feed-columns'
import { csvField, escapeXml, feedHead, feedRow, feedTail, shippingNotation, tsvField } from './feed-writer'

/**
 * Every channel's feed file, written whole (AGL-3637): Google's and Meta's
 * RSS 2.0 with the `g:` namespace, TikTok's and Snapchat's CSV, Pinterest's
 * TSV and Microsoft's tab-delimited text — head, rows and tail, as the route
 * streams them.
 */

const store = makeStore()

function feedFile(id: SalesChannelId, offers: CatalogOffer[]): string {
  const channel = salesChannel(id)!
  let text = feedHead(channel, store)
  for (const offer of offers) {
    const resolved = resolveOffer(offer, { channel, store, settings: makeSettings() })
    if (resolved.included) text += feedRow(channel, store, resolved.row)
  }
  return text + feedTail(channel)
}

/** Splits a CSV file into rows of cells, honoring quotes (RFC 4180). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"') quoted = true
    else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += char
  }
  return rows
}

const tricky = makeOffer({
  id: 'prod-2',
  productId: 'prod-2',
  groupId: 'prod-2',
  title: 'Candle, "Large" <Gift> & Co',
  description: 'Line one\nLine\ttwo, with comma',
})

describe('escaping', () => {
  it('escapes XML and strips characters XML cannot carry', () => {
    expect(escapeXml(`a & b < c > "d" 'e'\u0001`)).toBe('a &amp; b &lt; c &gt; &quot;d&quot; &apos;e&apos;')
  })

  it('quotes a CSV field only when it must', () => {
    expect(csvField('plain')).toBe('plain')
    expect(csvField('a,b')).toBe('"a,b"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField('two\nlines')).toBe('"two\nlines"')
  })

  it('flattens tabs and line breaks in a TSV field', () => {
    expect(tsvField('a\tb\nc\r\nd')).toBe('a b c d')
  })

  it('writes shipping in the flat notation, and Microsoft’s own', () => {
    const entry = { country: 'US', service: 'Ground: 2-day, tracked', priceMinor: 495 }
    expect(shippingNotation(entry, 'USD')).toBe('US::Ground  2-day  tracked:4.95 USD')
    expect(shippingNotation(entry, 'USD', 'microsoft')).toBe('US:Ground  2-day  tracked:4.95')
  })
})

describe.each(['google', 'meta'] as const)('the %s RSS feed', (id) => {
  const xml = feedFile(id, [makeOffer({ gtin: '036000291452' }), tricky, makeOffer({ id: 'gone', imageUrl: undefined })])

  it('is RSS 2.0 in the g: namespace with a channel head', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">')).toBe(true)
    expect(xml).toContain('<title>Candle Co</title>')
    expect(xml).toContain('<link>https://candles.example.com</link>')
    expect(xml.trimEnd().endsWith('</channel>\n</rss>')).toBe(true)
  })

  it('writes one item per included offer, escaped', () => {
    expect(xml.match(/<item>/g)).toHaveLength(2)
    expect(xml).toContain('<g:id>prod-1</g:id>')
    expect(xml).toContain('<g:title>Candle, &quot;Large&quot; &lt;Gift&gt; &amp; Co</g:title>')
    expect(xml).not.toContain('<g:id>gone</g:id>')
    expect(xml).toContain('<g:gtin>036000291452</g:gtin>')
    expect(xml).toContain('<g:price>18.00 USD</g:price>')
    expect(xml).toContain('<g:link>https://candles.example.com/products/beeswax-candle</g:link>')
  })

  it('repeats additional photos and nests shipping', () => {
    expect(xml).toContain('<g:additional_image_link>https://cdn.example.com/candle-2.jpg</g:additional_image_link>')
    expect(xml).toContain(
      '<g:shipping><g:country>US</g:country><g:service>Standard</g:service><g:price>4.95 USD</g:price></g:shipping>',
    )
  })

  it('leaves out empty attributes rather than writing empty elements', () => {
    expect(xml).not.toMatch(/<g:[a-z_]+><\/g:[a-z_]+>/)
  })

  it('is well formed', () => {
    const opened = (xml.match(/<g:[a-z_]+>/g) ?? []).length
    const closed = (xml.match(/<\/g:[a-z_]+>/g) ?? []).length
    expect(opened).toBe(closed)
  })
})

describe('the Google feed', () => {
  it('spells availability with underscores and says when identifiers do not exist', () => {
    const xml = feedFile('google', [makeOffer({ availability: 'out_of_stock', quantity: 0 })])
    expect(xml).toContain('<g:availability>out_of_stock</g:availability>')
    expect(xml).toContain('<g:identifier_exists>no</g:identifier_exists>')
  })
})

describe('the Meta feed', () => {
  it('spells availability with spaces and states the stock to sell', () => {
    const xml = feedFile('meta', [makeOffer()])
    expect(xml).toContain('<g:availability>in stock</g:availability>')
    expect(xml).toContain('<g:quantity_to_sell_on_facebook>12</g:quantity_to_sell_on_facebook>')
    expect(xml).not.toContain('identifier_exists')
  })
})

describe.each(['tiktok', 'snapchat'] as const)('the %s CSV feed', (id) => {
  const rows = parseCsv(feedFile(id, [makeOffer(), tricky]))

  it('has the channel’s header and one row per offer, every row the header’s width', () => {
    expect(rows[0]).toEqual([...FEED_COLUMNS[id]])
    expect(rows).toHaveLength(3)
    for (const row of rows) expect(row).toHaveLength(FEED_COLUMNS[id].length)
  })

  it('round-trips quotes, commas and line breaks', () => {
    const header = rows[0]
    const row = rows[2]
    expect(row[header.indexOf('title')]).toBe('Candle, "Large" <Gift> & Co')
    expect(row[header.indexOf('description')]).toBe('Line one\nLine\ttwo, with comma')
  })

  it('names the id as the channel does', () => {
    expect(rows[0][0]).toBe(id === 'tiktok' ? 'sku_id' : 'id')
    expect(rows[1][0]).toBe('prod-1')
  })
})

describe('the TikTok feed', () => {
  it('writes shipping in the flat notation', () => {
    const rows = parseCsv(feedFile('tiktok', [makeOffer()]))
    expect(rows[1][rows[0].indexOf('shipping')]).toBe('US::Standard:4.95 USD')
  })
})

describe.each(['pinterest', 'microsoft'] as const)('the %s tab-separated feed', (id) => {
  const text = feedFile(id, [makeOffer(), tricky])
  const rows = text.trimEnd().split('\n').map((line) => line.split('\t'))

  it('has one line per offer, every line the header’s width, no tab or break inside a cell', () => {
    expect(rows).toHaveLength(3)
    for (const row of rows) expect(row).toHaveLength(FEED_COLUMNS[id].length)
    const description = rows[2][FEED_COLUMNS[id].indexOf('description')]
    expect(description).toBe('Line one Line two, with comma')
  })

  it('joins additional photos with commas', () => {
    expect(rows[1][FEED_COLUMNS[id].indexOf('additional_image_link')]).toBe('https://cdn.example.com/candle-2.jpg')
  })
})

describe('the Microsoft feed', () => {
  const rows = feedFile('microsoft', [makeOffer({ priceMinor: 2400, salePriceMinor: 1800 })])
    .trimEnd()
    .split('\n')
    .map((line) => line.split('\t'))

  it('names its shipping column with the parts it carries, and writes them so', () => {
    const header = rows[0]
    expect(header).toContain('shipping(country:service:price)')
    expect(rows[1][header.indexOf('shipping(country:service:price)')]).toBe('US:Standard:4.95')
  })

  it('calls the category product_category and states identifier_exists in capitals', () => {
    const header = rows[0]
    expect(header).toContain('product_category')
    expect(header).not.toContain('google_product_category')
    expect(rows[1][header.indexOf('identifier_exists')]).toBe('FALSE')
    expect(rows[1][header.indexOf('sale_price')]).toBe('18.00')
  })
})

describe('every channel', () => {
  it.each(SALES_CHANNELS.map((channel) => channel.id))('%s writes an empty catalog as a valid empty file', (id) => {
    const channel = salesChannel(id)!
    const text = feedFile(id, [])
    if (channel.format === 'rss') expect(text).toContain('</rss>')
    else expect(text.split('\n').filter(Boolean)).toHaveLength(1)
  })
})
