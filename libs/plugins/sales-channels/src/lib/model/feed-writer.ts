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

import type { CatalogShippingPrice, CatalogStore } from '@aglyn/aglyn/plugin-manager/plugin-product-catalog'
import type { SalesChannelDefinition } from './channels'
import { FEED_COLUMNS, formatFeedPrice, type FeedRow } from './feed-columns'

/**
 * THE FEED FILE, PIECE BY PIECE (AGL-3637): a head, one chunk per row, a
 * tail. The route streams them, so a catalog of any size is written without
 * holding the file in memory. Pure and client-safe.
 */

/** Characters XML 1.0 cannot carry at all, and lone surrogate halves. */
const XML_INVALID =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

export function escapeXml(text: string): string {
  return text
    .replace(XML_INVALID, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** A CSV field, quoted when it must be (RFC 4180). */
export function csvField(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** A TSV field: tabs and line breaks become spaces, since TSV cannot quote them. */
export function tsvField(text: string): string {
  return text.replace(/[\t\r\n]+/g, ' ')
}

/**
 * One shipping price in a flat feed's notation: `US::Standard:4.95 USD`
 * (country, region, service, price — Google's, Meta's, TikTok's, Pinterest's
 * and Snapchat's), or Microsoft's `US:Standard:4.95`, which has no region
 * and a bare price, as its `shipping(country:service:price)` header says.
 */
export function shippingNotation(
  entry: CatalogShippingPrice,
  currency: string,
  channel?: SalesChannelDefinition['id'],
): string {
  const service = entry.service.replace(/[:,]/g, ' ').trim()
  const price = formatFeedPrice(entry.priceMinor, currency)
  if (channel === 'microsoft') return `${entry.country}:${service}:${price.split(' ')[0]}`
  return `${entry.country}::${service}:${price}`
}

/**
 * A column's header: Microsoft names its shipping column with the parts its
 * value carries, and every other channel and column by the attribute alone.
 */
export function columnHeader(channel: SalesChannelDefinition, column: string): string {
  if (channel.id === 'microsoft' && column === 'shipping') return 'shipping(country:service:price)'
  return column
}

const isShipping = (value: FeedRow[string]): value is CatalogShippingPrice[] =>
  Array.isArray(value) && value.length > 0 && typeof value[0] === 'object'

/** The file's opening: the RSS head, or the header row. */
export function feedHead(channel: SalesChannelDefinition, store: CatalogStore): string {
  const columns = FEED_COLUMNS[channel.id]
  if (channel.format === 'rss') {
    const origin = store.origin ?? ''
    return (
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n' +
      '<channel>\n' +
      `<title>${escapeXml(store.name)}</title>\n` +
      `<link>${escapeXml(origin)}</link>\n` +
      `<description>${escapeXml(`${store.name} products`)}</description>\n`
    )
  }
  const separator = channel.format === 'csv' ? ',' : '\t'
  return `${columns.map((column) => columnHeader(channel, column)).join(separator)}\n`
}

/** One row of the file. */
export function feedRow(channel: SalesChannelDefinition, store: CatalogStore, row: FeedRow): string {
  const columns = FEED_COLUMNS[channel.id]
  if (channel.format === 'rss') {
    let item = '<item>\n'
    for (const column of columns) {
      const value = row[column]
      if (value === undefined) continue
      if (isShipping(value)) {
        for (const entry of value) {
          item +=
            '<g:shipping>' +
            `<g:country>${escapeXml(entry.country)}</g:country>` +
            `<g:service>${escapeXml(entry.service)}</g:service>` +
            `<g:price>${escapeXml(formatFeedPrice(entry.priceMinor, store.currency))}</g:price>` +
            '</g:shipping>\n'
        }
        continue
      }
      for (const one of Array.isArray(value) ? value : [value]) {
        if (typeof one !== 'string' || !one) continue
        item += `<g:${column}>${escapeXml(one)}</g:${column}>\n`
      }
    }
    return `${item}</item>\n`
  }
  const field = channel.format === 'csv' ? csvField : tsvField
  const separator = channel.format === 'csv' ? ',' : '\t'
  const cells = columns.map((column) => {
    const value = row[column]
    if (value === undefined) return ''
    if (isShipping(value)) {
      return field(value.map((entry) => shippingNotation(entry, store.currency, channel.id)).join(','))
    }
    if (Array.isArray(value)) return field((value as string[]).filter(Boolean).join(','))
    return field(value)
  })
  return `${cells.join(separator)}\n`
}

/** The file's close. */
export function feedTail(channel: SalesChannelDefinition): string {
  return channel.format === 'rss' ? '</channel>\n</rss>\n' : ''
}
