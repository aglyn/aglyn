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

import * as Aglyn from '@aglyn/aglyn/server'
import { visitorContentRefusal } from '@aglyn/tenant-data-admin'
import { getTemplateScreenRouting } from '@aglyn/tenant-runtime/template-screens'
import getHost from '../../../utils/get-host'
import { loadPageData } from '../../[host]/[scheme]/[[...slug]]/load-page-data'
import type { Props } from '../../[host]/[scheme]/[[...slug]]/types'

export const dynamic = 'force-dynamic'

/**
 * The Markdown representation of a tenant page (AGL-2716).
 *
 * The middleware routes here when a request negotiates `text/markdown`, or
 * when the path ends in `.md`. It is a ROUTE HANDLER rather than a branch
 * inside the page, and that is the whole reason it exists as a file: a
 * `page.tsx` can only return a React tree, so there is no way for the catch-all
 * to answer one request with HTML and the next with a different media type.
 *
 * ## Why this loads the page rather than fetching it
 *
 * `loadPageData` is the same loader the render calls, so the Markdown is built
 * from the same composed document the HTML is — the same layout composition,
 * the same collection resolution, the same gates. Fetching our own HTML and
 * converting it would be a second render plus a lossy parse, and would
 * disagree with the page the first time either changed.
 *
 * ## Gated pages
 *
 * A password-protected, members-only or maintenance page composes NO nodes —
 * the loader withholds them — so this answers with the page's title and
 * nothing else, exactly as the HTML does before the visitor unlocks it. That
 * falls out of the data rather than being special-cased, which is the property
 * to preserve: a new gate added to the loader is closed here on the day it
 * ships, without anyone remembering this file.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const tenantHost = String(
    request.headers.get('x-aglyn-tenant-host') ??
      url.searchParams.get('host') ??
      '',
  )
  if (!tenantHost) return new Response('Missing host', { status: 400 })

  /*
    The HEADER first, then the query. A route handler behind a rewrite sees the
    ORIGINAL request URL (AGL-1501), so through the middleware the query is not
    this request's — it is the visitor's. The header is what the rewrite can
    actually deliver; the query serves a direct
    `/api/markdown?host=&path=` call, which has no rewrite in front of it.
  */
  const slug = (
    request.headers.get('x-aglyn-markdown-path') ??
    url.searchParams.get('path') ??
    ''
  )
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)

  /*
    Which SPELLING asked for Markdown. Both reach this handler, and they differ
    in exactly one way that matters: `.md` is its own URL and therefore its own
    thing for a crawler to index, while a negotiated response shares the URL of
    the page it mirrors. See `markdownResponse`.
  */
  const suffixForm =
    request.headers.get('x-aglyn-markdown-suffix') === '1' ||
    url.searchParams.get('md') === '1'
  /*
    A LOCKED SITE MUST NOT PUBLISH THROUGH ITS OWN TAKEDOWN (AGL-2495).

    This is the route the guard's own note is about: it hands back the page's
    COMPOSED CONTENT, which is serving the site itself, so it is wired rather
    than recorded as a known-open read. The middleware runs the verdict before
    it rewrites here — that is why the rewrite sits below the lockdown check —
    but the matcher excludes `/api`, so a direct `/api/markdown?host=…&path=…`
    call arrives without ever having passed it.

    Resolved from the host record rather than from the loaded page, and BEFORE
    the load, so a locked host pays for no reads. Read-only locks are untouched:
    `lockdownBlocks(state, 'read')` is true only for a full lock.
  */
  const { host: hostRecord } = await getHost({ host: tenantHost })
  if (hostRecord?.$id) {
    const down = await visitorContentRefusal({ hostId: hostRecord.$id })
    if (down) return down
  }

  const result = await loadPageData(tenantHost, slug)

  if ('notFound' in result) {
    return markdownResponse(
      '# Not found\n\nNo page answers at this address.\n',
      404,
      { suffixForm },
    )
  }
  if ('redirect' in result) {
    const { destination, statusCode } = result.redirect
    // The same status the page would have sent, so an agent following the
    // Markdown variant lands where a browser would and learns the same thing
    // about whether the move is permanent.
    return new Response(null, {
      status: statusCode === 301 || statusCode === 308 ? 308 : 307,
      headers: { Location: destination, Vary: 'Accept' },
    })
  }

  const { markdown, canonicalUrl } = await renderMarkdown(result.props, slug)
  return markdownResponse(markdown, 200, { suffixForm, canonicalUrl })
}

/** HEAD, so a client can probe the variant without paying for the body. */
export async function HEAD(request: Request): Promise<Response> {
  const response = await GET(request)
  return new Response(null, {
    status: response.status,
    headers: response.headers,
  })
}

/**
 * One response shape, so every path answers with the same headers.
 *
 * `Vary: Accept` is on EVERY response including the 404, and that is not
 * belt-and-braces: this body and the HTML page are two representations of one
 * resource, so a cache that stored this one without the header would serve
 * Markdown to the next browser that asked for the page.
 *
 * ## The two spellings need different crawler headers
 *
 * `X-Robots-Tag: noindex` is set ONLY for the `.md` suffix form. That form is a
 * SECOND URL for content that already has one, which is the definition of a
 * duplicate, so it should not be indexed in its own right.
 *
 * On the NEGOTIATED response it would be actively dangerous. That response
 * carries the page's own URL, and a `noindex` on it is a statement about that
 * URL — so any crawler that ever sent `Accept: text/markdown` would be told to
 * drop the page from the index. No crawler does today. "No crawler does today"
 * is not a property to build a deindexing risk on.
 *
 * Both forms carry `Link: rel="canonical"` instead, which says the same thing
 * — this is a representation of that page — without any instruction to forget
 * anything.
 */
function markdownResponse(
  body: string,
  status: number,
  options?: { suffixForm?: boolean; canonicalUrl?: string },
): Response {
  const headers: Record<string, string> = {
    'Content-Type': Aglyn.MARKDOWN_CONTENT_TYPE,
    Vary: 'Accept',
    // Matches the sitemap and robots windows: cheap to regenerate, and the
    // page it mirrors is itself cached. A publish busts the underlying data
    // cache, so a republished page's Markdown follows within that window
    // rather than waiting out this one.
    'Cache-Control': 's-maxage=300, stale-while-revalidate=3600',
  }
  if (options?.canonicalUrl) {
    headers['Link'] = `<${options.canonicalUrl}>; rel="canonical"`
  }
  if (options?.suffixForm) headers['X-Robots-Tag'] = 'noindex'
  return new Response(body, { status, headers })
}

/** ISO date from a Firestore-shaped timestamp, or undefined. */
function isoDate(
  value: { seconds?: number } | null | undefined,
): string | undefined {
  const seconds = value?.seconds
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return undefined
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

/** Compose the Markdown document for a loaded page. */
async function renderMarkdown(
  props: Props,
  slug: string[],
): Promise<{ markdown: string; canonicalUrl?: string }> {
  const host = props.data?.host
  const origin = Aglyn.hostPublicOrigin(host)
  const canonicalUrl = origin
    ? `${origin}${slug.length ? `/${slug.join('/')}` : '/'}`
    : undefined
  const context: Aglyn.PageMarkdownContext = {
    origin: origin ?? null,
    hostId: host?.$id,
  }

  /*
    A content ENTRY short-circuits the node walk. Its body is already
    markdown-lite source — the dialect `parseMarkdownLite` reads — so the
    faithful representation is that string, and rendering it into a node tree
    and back could only lose fidelity. The entry template's chrome is not
    missed: it is the same furniture on every entry.

    It therefore carries NO `screenRoutes`, and needs none: a body string is
    emitted verbatim, and the only link shapes markdown-lite stores are the
    ones `safeLinkUrl` admits — `/path` and `http(s):`. A `screen:` reference
    cannot be written into one, which is why this branch cannot leak the token
    the node walk had to be taught to resolve (AGL-2740). Anything added below
    that RESOLVES links in a body would need the map built further down.
  */
  const entry = props.content?.entry
  if (entry) {
    return {
      canonicalUrl,
      markdown: Aglyn.buildPageMarkdown({
        body: entry.body ?? '',
        front: {
          title: entry.title,
          description: entry.seoDescription || entry.excerpt,
          canonicalUrl,
          author: entry.author?.name || entry.authorName || undefined,
          publishedAt: isoDate(entry.publishedAt),
          updatedAt: isoDate(entry.updatedAt),
        },
        context,
      }),
    }
  }

  const screen = props.data?.screen?.data as
    | {
        $id?: string
        displayName?: string
        seo?: { title?: string; description?: string }
      }
    | undefined

  /*
    Screen links resolve against the routing map the ROUTER honors, not the one
    publishing wrote (AGL-1998) — the same derivation `page.tsx` does, and for
    the same reason: without it the Markdown would carry the dead links that
    fix removed from the HTML. It costs no Firestore read, because the loader
    above has already asked for this cache entry on this request.
  */
  let screenRoutes: Record<string, string> | undefined
  const routedHost = props.data?.host as
    { $id?: string; screens?: Record<string, string> } | undefined
  if (routedHost?.$id) {
    const routing = await getTemplateScreenRouting({ hostId: routedHost.$id })
    screenRoutes = Aglyn.linkableScreenRoutes(routedHost.screens, {
      routedElsewhere: routing.listRoutes,
      unrouted: routing.templateScreenIds,
    })
  }

  const listing = props.content?.collection
  return {
    canonicalUrl,
    markdown: Aglyn.buildPageMarkdown({
      nodes: props.nodes as Aglyn.PageMarkdownNodes | null,
      front: {
        title:
          screen?.seo?.title ||
          screen?.displayName ||
          listing?.displayName ||
          host?.seo?.title ||
          host?.displayName,
        description: screen?.seo?.description || host?.seo?.description,
        canonicalUrl,
      },
      context: { ...context, screenRoutes },
    }),
  }
}
