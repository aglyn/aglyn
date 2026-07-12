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

import type { PluginApiHandler } from '@aglyn/aglyn/server'
import * as Aglyn from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Google Merchant Center product feed (AGL-299): RSS 2.0 with the g:
 * namespace over active products — one item per product (default
 * variant pricing; per-variant feeds can come later). Submit
 * `https://{site}/api/commerce/feed?hostId={id}` in Merchant Center.
 */
export const feedHandler: PluginApiHandler = async (req, res) => {
  const hostId = String(req.query.hostId ?? '')
  if (!hostId) return res.status(400).send('Missing hostId')
  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const productsSnapshot = await hostRef
      .collection('products')
      .limit(500)
      .get()
    const requestHost = String(req.headers['host'] ?? '')
    const base = `https://${requestHost}`
    const items = productsSnapshot.docs
      .map((docSnapshot) => ({
        ...Aglyn.liftLegacyProduct(docSnapshot.data() as any),
        $id: docSnapshot.id,
      }))
      .filter(
        (product) => !product.deletedAt && product.status === 'active',
      )
      .map((product) => {
        const [minPrice] = Aglyn.productPriceRange(product)
        const inventory = Aglyn.productInventory(product)
        const availability =
          inventory != null &&
          inventory <= 0 &&
          product.oversellPolicy !== 'backorder'
            ? 'out_of_stock'
            : 'in_stock'
        const image = product.mediaUrls?.[0] ?? product.imageUrl
        return (
          '    <item>\n' +
          `      <g:id>${escapeXml(product.$id)}</g:id>\n` +
          `      <g:title>${escapeXml(product.name)}</g:title>\n` +
          `      <g:description>${escapeXml(product.description ?? product.name)}</g:description>\n` +
          `      <g:link>${escapeXml(`${base}/products/${product.slug}`)}</g:link>\n` +
          (image
            ? `      <g:image_link>${escapeXml(image)}</g:image_link>\n`
            : '') +
          `      <g:price>${minPrice.toFixed(2)} USD</g:price>\n` +
          `      <g:availability>${availability}</g:availability>\n` +
          `      <g:condition>new</g:condition>\n` +
          '    </item>'
        )
      })
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n' +
      '  <channel>\n' +
      `    <title>${escapeXml(requestHost)} products</title>\n` +
      `    <link>${escapeXml(base)}</link>\n` +
      '    <description>Product feed</description>\n' +
      items.join('\n') +
      '\n  </channel>\n</rss>\n'
    res.setHeader('Content-Type', 'application/xml')
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate')
    return res.status(200).send(xml)
  } catch (error) {
    console.error(error)
    return res.status(500).send('Feed unavailable')
  }
}
