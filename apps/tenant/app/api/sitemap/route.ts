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

import { screenRoutePathToUrl } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import getHost from '../../../utils/get-host'

export const dynamic = 'force-dynamic'

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/**
 * Per-host sitemap (SEO Toolkit): the middleware rewrites
 * `{tenant-site}/sitemap.xml` here with the resolved tenant host. URLs come
 * from the host routing map — exactly the published screens.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const host = String(
    request.headers.get('x-aglyn-tenant-host') ??
      url.searchParams.get('host') ??
      '',
  )
  if (!host) return new Response('Missing host', { status: 400 })

  const hostRes = await getHost({ host })
  if (hostRes.error || !hostRes.host) {
    return new Response('Not found', { status: 404 })
  }

  const requestHost = String(request.headers.get('host') ?? host)
  const base = `https://${requestHost}`
  const urls = Object.values(hostRes.host.screens ?? {})
    .map((path) => `${base}${screenRoutePathToUrl(path)}`)
    .sort()

  // Commerce URLs (AGL-299): active product + collection pages join the
  // sitemap when the host has the matching template configured.
  try {
    const hostRef = firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostRes.host.$id)
    const storeSettings = await hostRef.collection('settings').doc('store').get()
    if (storeSettings.get('pdpScreenId')) {
      const products = await hostRef.collection('products').limit(500).get()
      for (const docSnapshot of products.docs) {
        const raw = docSnapshot.data() as any
        if (raw.deletedAt || raw.status !== 'active' || !raw.slug) continue
        urls.push(`${base}/products/${raw.slug}`)
      }
    }
    if (storeSettings.get('collectionScreenId')) {
      const collections = await hostRef.collection('collections').limit(250).get()
      for (const docSnapshot of collections.docs) {
        const raw = docSnapshot.data() as any
        if (raw.slug) urls.push(`${base}/collections/${raw.slug}`)
      }
    }
  } catch {
    // Sitemap stays screens-only if commerce reads fail.
  }

  // Content collections & blog (AGL-582): /{collection} lists and their
  // published /{collection}/{entry} articles join the sitemap. Bounded
  // reads, fail-open — a content read failure never takes the sitemap down.
  try {
    const hostRef = firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostRes.host.$id)
    const collections = await hostRef.collection('collections').limit(50).get()
    for (const docSnapshot of collections.docs) {
      const collectionSlug = (docSnapshot.data() as any).slug
      if (!collectionSlug) continue
      urls.push(`${base}/${collectionSlug}`)
      const entries = await docSnapshot.ref
        .collection('entries')
        .where('status', '==', 'published')
        .limit(200)
        .get()
      for (const entryDoc of entries.docs) {
        const entrySlug = (entryDoc.data() as any).slug
        if (entrySlug) urls.push(`${base}/${collectionSlug}/${entrySlug}`)
      }
    }
  } catch {
    // Sitemap stays screens-only if content reads fail.
  }

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    // De-duplicated (AGL-582): a collection slug can shadow a screen path.
    [...new Set(urls)]
      .map((item) => `  <url><loc>${escapeXml(item)}</loc></url>`)
      .join('\n') +
    '\n</urlset>\n'

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 's-maxage=3600, stale-while-revalidate',
    },
  })
}
