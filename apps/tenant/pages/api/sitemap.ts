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

import * as Aglyn from '@aglyn/aglyn'
import type { NextApiRequest, NextApiResponse } from 'next'
import getHost from '../../utils/get-host'

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
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const host = String(
    req.headers['x-aglyn-tenant-host'] ?? req.query['host'] ?? '',
  )
  if (!host) return res.status(400).send('Missing host')

  const hostRes = await getHost({ host })
  if (hostRes.error || !hostRes.host) return res.status(404).send('Not found')

  const requestHost = String(req.headers['host'] ?? host)
  const base = `https://${requestHost}`
  const urls = Object.values(hostRes.host.screens ?? {})
    .map((path) => `${base}${Aglyn.screenRoutePathToUrl(path)}`)
    .sort()

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls
      .map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`)
      .join('\n') +
    '\n</urlset>\n'

  res.setHeader('Content-Type', 'application/xml')
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate')
  return res.status(200).send(xml)
}
