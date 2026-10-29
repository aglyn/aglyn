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

// lockdown-423: via apps/tenant/app/[host]/[scheme]/[[...slug]]/load-page-data.ts
// This route deliberately composes nothing itself: it calls the same loader the
// page uses, so the loader's lockdown branch (and protection, membership,
// maintenance, org suspension) answers `nodes: null` and this returns 404.

import { deferLazyPanelNodes } from '@aglyn/tenant-runtime/defer-lazy-panels'
import {
  isSitePreviewRequest,
  sitePreviewPaths,
} from '@aglyn/aglyn/app-utils/site-preview'
import {
  loadPageData,
  SITE_PREVIEW_TEAM_VIEW,
  type SiteOverride,
} from '../../../[host]/[scheme]/[[...slug]]/load-page-data'
import getHost from '../../../../utils/get-host'
import { sitePreviewViewerForRequest } from '../../../../utils/site-preview-viewer'

/**
 * The node definitions a page withheld from its payload (AGL-1285/1287).
 *
 * The page render withholds the subtrees of lazy tab panels that will not
 * mount (`deferLazyPanelNodes`), so those panels reach the reader as empty
 * shells. This is the other half: the client asks for the missing pieces the
 * first time someone touches a tab, and merges them in.
 *
 * It returns a PATCH, not the document. Returning the whole map was the first
 * shape and it inverted the trade — measured on `/pricing`, the response was
 * 88 KB gzipped against a 37 KB saving, so anyone who opened a tab downloaded
 * more in total than before the deferral existed. Everything already on the
 * page was being sent a second time.
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
    /**
     * A site, or this page, in preview (AGL-4086): the team's page asks for
     * its panels here too, and gets them only once its cookie is verified —
     * the same check the uncached preview route runs. Either answer is kept
     * out of every shared cache, because the URL is the same for the team and
     * for the public and only one of them may see the page.
     */
    const hostRes = await getHost({ host })
    const hostDoc = hostRes.host as never
    const inPreview = isSitePreviewRequest(
      {
        preview: (hostRes.host as { preview?: unknown } | null)?.preview === true,
        previewPaths: sitePreviewPaths(hostDoc),
      },
      `/${slug.join('/')}`,
    )
    let override: SiteOverride = ''
    if (inPreview && hostRes.host?.$id) {
      const viewer = await sitePreviewViewerForRequest(request, String(hostRes.host.$id))
      if (viewer.admitted) override = SITE_PREVIEW_TEAM_VIEW
    }
    const result = await loadPageData(host, slug, '', override)
    // Anything that is not a rendered page — a 404, the canonical-origin
    // redirect, or a gated surface that withholds its nodes — has nothing to
    // hand back. Deliberately indistinguishable: this must not become a probe
    // for which screens exist behind a password.
    if (!('props' in result) || !result.props.nodes) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    // Re-run the same prune the page ran and send back only what it removed.
    // Two parts, and missing the second leaves every panel empty:
    //
    //  - the DROPPED descendants — everything `deferLazyPanelNodes` took out;
    //  - the ORIGINAL panel nodes. The prune does not remove those, it REWRITES
    //    them (`nodes: []`, plus the `aglynDeferred` marker), so the page is
    //    holding a hollowed-out copy. Sending the originals is what restores
    //    each panel's child list — and it clears the marker, which is what
    //    makes the panel's loading state resolve itself.
    //
    // Both sides derive from the same deterministic function over the same
    // cached document, so they agree. If an author republishes inside the 60s
    // revalidate window the patch could be computed against a newer document
    // than the page holds; the worst case is a panel that renders short until
    // the next load, not a corrupted tree.
    const full = result.props.nodes
    const { nodes: pruned, deferredPanelIds } = deferLazyPanelNodes(full)
    const patch: Record<string, unknown> = {}
    for (const id of Object.keys(full)) {
      if (!(id in pruned)) patch[id] = full[id]
    }
    for (const id of deferredPanelIds) patch[id] = full[id]

    return Response.json(
      { nodes: patch },
      {
        headers: {
          // Public page content, so it caches like the page does — otherwise
          // every visitor who opens a tab pays a full compose. Matches the
          // page's own 60s `revalidate`. Never for a page in preview.
          'Cache-Control': inPreview
            ? 'private, no-store, max-age=0'
            : 'public, s-maxage=60, stale-while-revalidate=300',
        },
      },
    )
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Load failed' }, { status: 500 })
  }
}
