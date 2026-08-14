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

import { createContext, useCallback, useContext } from 'react'

/**
 * Identity of the published site a node tree renders inside. Provided by
 * the tenant page and by the console's Preview; absent in the besigner
 * canvas, which is how components with side effects (forms) know to stay
 * inert.
 *
 * Lives banner-free in @aglyn/aglyn for the same reason as
 * ScreenLinkContext: a 'use client' banner in this module graph duplicates
 * the canvas singleton and blanks the tenant site (AGL-52).
 */
export interface SiteContextValue {
  /** Host document id of the rendered site. */
  hostId?: string
  /**
   * True on the console's Preview surface (AGL-1139).
   *
   * Preview now supplies a real `hostId`, because without one every plugin
   * block took its `if (!hostId)` placeholder branch — thirty of them — and
   * someone laying out a shop saw dashed boxes instead of their products.
   * A `hostId` is what makes those blocks resolve real data.
   *
   * The same `hostId` is what would let them WRITE it. Preview exists to
   * answer "what will this look like and do", not to place an order, post a
   * review or book a table, so this flag is how a block tells the difference.
   * Read through `useSiteFetch`, which refuses unsafe methods rather than
   * asking each block to remember.
   */
  preview?: boolean
  /**
   * Data a site-page resolver already loaded on the server for THIS page,
   * keyed by plugin (AGL-659).
   *
   * Blocks whose primary content came from a `useEffect` fetch rendered a
   * skeleton during SSR — so the crawler saw a product page with no product
   * in it. Seeding from here lets a block render its real content in the
   * server HTML and still hydrate normally, without giving up ISR caching.
   *
   * Absent in the besigner/preview, so blocks must keep working without it.
   */
  pageData?: Record<string, unknown>
}

export const SiteContext = createContext<SiteContextValue>({})
SiteContext.displayName = 'AglynSiteContext'

/** The rendered site's identity; empty in the besigner canvas. */
export function useSite(): SiteContextValue {
  return useContext(SiteContext)
}

/**
 * Dispatched when Preview refuses a write (AGL-1139). The preview surface
 * listens once and says so; blocks do not each need their own message.
 */
export const PREVIEW_WRITE_BLOCKED_EVENT = 'aglyn:preview-write-blocked'

/**
 * The status `useSiteFetch` answers a refused write with. Exported so a block
 * can tell "Preview refused this" from "the server errored" — the two need
 * opposite words, and a block that cannot tell them apart says "something went
 * wrong" about a deliberate, correct refusal (AGL-1249).
 */
export const PREVIEW_REFUSED_STATUS = 423

/**
 * Was this response Preview declining to write, rather than a failure?
 *
 * The status alone stopped being sufficient with AGL-1511: a read-only
 * lockdown refuses a live site's writes with the SAME 423, so a block that
 * keys on the status only would tell a paying visitor "Preview does not
 * change real data" about a real checkout. Pass the parsed body and the
 * `preview: true` marker decides; a caller with no body in hand keeps the
 * old status-only behaviour, which is still right in the surface Preview
 * actually renders (its refusal never reaches the network, so a lockdown 423
 * cannot arrive there).
 */
export function isPreviewRefusal(
  response: { status?: number } | null | undefined,
  body?: unknown,
): boolean {
  if (response?.status !== PREVIEW_REFUSED_STATUS) return false
  if (body === undefined) return true
  return (
    Boolean(body) &&
    typeof body === 'object' &&
    (body as { preview?: unknown }).preview === true
  )
}

/** Methods that cannot change server state, so Preview lets them through. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** What a blocked call resolves to. */
const BLOCKED_BODY = {
  error: 'Preview does not change real data.',
  preview: true,
}

/**
 * `fetch` for a site block, aware of which surface it is rendering on.
 *
 * Once Preview supplies a real `hostId` every block's data call starts
 * working — including the ones that book a table, post a review, register a
 * member or place an order. Those are not previews of anything; they are the
 * thing itself, triggered by someone checking their layout.
 *
 * So the boundary is drawn once, HERE, by method rather than by endpoint:
 * reads pass through, anything that can change state resolves to a 423
 * without a request being made. Drawing it per block would mean thirteen
 * files each remembering, and the fourteenth block silently not — the same
 * shape as the revalidate omission in AGL-1150.
 *
 * Deliberately resolves rather than rejects. Every caller already branches on
 * `response.ok`, so a refusal travels down the path they already have for a
 * server that said no, and no block needs a new `catch`.
 */
export function useSiteFetch(): typeof fetch {
  const { preview } = useSite()
  return useCallback(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const method = String(
        init?.method ??
          (typeof Request !== 'undefined' && input instanceof Request
            ? input.method
            : 'GET'),
      ).toUpperCase()
      if (!preview || READ_METHODS.has(method)) return fetch(input, init)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent(PREVIEW_WRITE_BLOCKED_EVENT, { detail: { method } }),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify(BLOCKED_BODY), {
          // 423 Locked: the request was understood and refused because of the
          // surface it came from, not because it was malformed or forbidden.
          status: PREVIEW_REFUSED_STATUS,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    },
    [preview],
  )
}
