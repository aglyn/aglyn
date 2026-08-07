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

import { loadPageData } from '../../../[host]/[[...slug]]/load-page-data'

/**
 * The composed node document for a page, in full (AGL-1285).
 *
 * The page render withholds the subtrees of lazy tab panels that will not
 * mount (`deferLazyPanelNodes`), so those panels reach the reader as empty
 * shells. This is the other half: the client asks for the whole document the
 * first time someone touches a tab, and swaps it in.
 *
 * It calls `loadPageData` — the same loader the page uses — rather than
 * composing a screen directly. That is a security decision, not a convenience
 * one. `/api/protection/unlock` may compose from a raw `screenId` because a
 * password guards it; this route has no such gate, and a bare
 * `getScreen` + `composeScreenNodes` here would hand out the nodes of
 * password-protected and members-only screens to anyone who could name them.
 * Routing through the loader means every gate the page honours — protection,
 * membership, maintenance, org suspension, template screens — is honoured
 * here too, because those branches return `nodes: null` and this returns 404.
 *
 * The host param is passed through verbatim rather than re-derived. A request
 * that arrived on a custom domain reaches the page as `cname--{hostname}`, and
 * only the page knows which form it was rendered under; re-deriving it here
 * would either miss the sentinel or trip the canonical-origin redirect.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const host = url.searchParams.get('host')
  if (!host) return Response.json({ error: 'Invalid request' }, { status: 400 })

  let slug: string[]
  try {
    const parsed = JSON.parse(url.searchParams.get('slug') ?? '[]')
    if (
      !Array.isArray(parsed) ||
      parsed.length > 16 ||
      parsed.some((segment) => typeof segment !== 'string')
    ) {
      throw new Error('bad slug')
    }
    slug = parsed
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }

  try {
    const result = await loadPageData(host, slug)
    // Anything that is not a rendered page — a 404, the canonical-origin
    // redirect, or a gated surface that withholds its nodes — has nothing to
    // hand back. Deliberately indistinguishable: this must not become a probe
    // for which screens exist behind a password.
    if (!('props' in result) || !result.props.nodes) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }
    return Response.json(
      { nodes: result.props.nodes },
      {
        headers: {
          // Public page content, so it caches like the page does — otherwise
          // every visitor who opens a tab pays a full compose. Matches the
          // page's own 60s `revalidate`.
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      },
    )
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Load failed' }, { status: 500 })
  }
}
