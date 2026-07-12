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

export const dynamic = 'force-dynamic'

/**
 * Per-host robots.txt (SEO Toolkit): the middleware rewrites
 * `{tenant-site}/robots.txt` here. Allows everything and points crawlers at
 * the host's sitemap.
 */
export function GET(request: Request): Response {
  const requestHost = request.headers.get('host') ?? ''
  return new Response(
    'User-agent: *\nAllow: /\n' +
      (requestHost ? `Sitemap: https://${requestHost}/sitemap.xml\n` : ''),
    {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': 's-maxage=3600, stale-while-revalidate',
      },
    },
  )
}
