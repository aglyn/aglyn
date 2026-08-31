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

import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'

/**
 * Drop the live site's cached HTML after a publish (AGL-1150).
 *
 * Publishing writes a pointer; the live page is ISR-cached, so without this the
 * change waits out the revalidate window and then STILL serves stale to the
 * next visitor while Next regenerates behind them. Publish, refresh, see
 * nothing, refresh again, see it.
 *
 * Shared rather than inlined at each publish site on purpose. AGL-1150 wired
 * exactly one of them — the screen version view page — and the besigner's
 * versions panel, which is where publishing actually happens most of the time,
 * revalidated nothing at all for screens OR layouts. That is the same shape as
 * AGL-1147: one omission repeated across call sites until a helper made it
 * impossible to forget.
 *
 * BEST EFFORT, ALWAYS. The publish has already succeeded by the time this runs
 * — a cache hint that fails must never make a successful publish look failed,
 * and the revalidate window is still underneath as the backstop.
 */
export interface RevalidateLivePagesOptions {
  /** The signed-in user; its ID token authenticates the console route. */
  user: { getIdToken?: () => Promise<string> } | undefined | null
  hostId: string
  /** Publishing a screen invalidates that screen's own path. */
  screenId?: string
  /**
   * Publishing a layout invalidates every screen rendered inside it, however
   * deep. The console route owns that fan-out — it is the only side holding
   * both the layout→screen graph and the tenant's cache keys.
   */
  layoutId?: string
  /**
   * Publishing a component invalidates every screen that renders it — placed
   * directly, nested inside another component, or sitting in a layout's
   * chrome (AGL-1161). The console route owns that closure too, for the same
   * reason: it is the side holding the node graph and the tenant's cache keys.
   *
   * Costlier than the others, because a component's dependents are found by
   * searching node trees rather than by matching a pointer. That is why every
   * caller fires this without awaiting — and unlike a screen publish, nobody
   * is watching one specific URL for it to change.
   */
  componentId?: string
}

/**
 * What the drop actually covered (AGL-1239).
 *
 * Returned rather than swallowed because the two shortfalls below are the only
 * cases where a publish reported as complete leaves live pages stale on
 * purpose, and until now they were recorded in a server log nobody reads
 * during a publish.
 */
export interface RevalidateLivePagesResult {
  /** Pages whose cached HTML was actually dropped. */
  revalidated: number
  /**
   * Pages the tenant would not take because the payload exceeded its cap —
   * AGL-1161's `truncated`, surfaced by the console route as `pathsDropped`.
   */
  pathsDropped: number
  /** The console-side dependent scan hit its limit and stopped early. */
  scanTruncated: boolean
  /**
   * Why the drop is not a plain success, or `'ok'` — passed straight through
   * from the console route.
   *
   * Dropping this was its own quiet failure: `revalidated: 0` reads the same
   * for "this screen is not routed, so there was nothing to drop" as it does
   * for "the tenant refused the call", and only the second means the live page
   * is now stale for the rest of its window. Both used to arrive as a plain
   * success, which is how a publish came to report itself complete while the
   * page it published kept serving the old HTML.
   */
  reason: string
}

/**
 * One sentence for a drop that did not cover the whole site, or `null` when it
 * did.
 *
 * Lives beside the call rather than at each call site so the two publish
 * surfaces cannot word this differently — the same omission-repeated-per-caller
 * shape the helper itself exists to prevent.
 */
export function describeRevalidateShortfall(
  result: RevalidateLivePagesResult | null,
): string | null {
  if (!result) return null
  const { pathsDropped, scanTruncated, reason } = result
  /**
   * A REFUSED drop, which is the only case where the live pages are stale for
   * the whole revalidate window rather than for a moment.
   *
   * `not-routed` is deliberately not in here: a screen with no route has no
   * live page to be stale, so saying anything would be alarming and wrong.
   */
  if (reason && reason !== 'ok' && reason !== 'not-routed') {
    // Says what it means for THEM. The publish itself landed — only the cache
    // hint did not — so the honest sentence is that the site catches up on its
    // own, with a bound rather than a shrug.
    return (
      'Published. The live pages could not be refreshed just now, so they ' +
      'may show the previous version for up to an hour.'
    )
  }
  if (!pathsDropped && !scanTruncated) return null
  // Deliberately says what to DO. "Truncated" is accurate and useless: the
  // reader's question is whether their site is broken, and the answer is that
  // it catches up on its own within the minute.
  const stale = pathsDropped
    ? `${pathsDropped} page${pathsDropped === 1 ? '' : 's'}`
    : 'Some pages'
  return (
    `Published. ${stale} that use this are too many to refresh at once — ` +
    'they update on their own within a minute.'
  )
}

export async function revalidateLivePages(
  options: RevalidateLivePagesOptions,
): Promise<RevalidateLivePagesResult | null> {
  const { user, hostId, screenId, layoutId, componentId } = options
  if (!hostId || (!screenId && !layoutId && !componentId)) return null
  try {
    const response = await authorizedFetch(user, '/api/screens/revalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostId,
        ...(screenId ? { screenId } : {}),
        ...(layoutId ? { layoutId } : {}),
        ...(componentId ? { componentId } : {}),
      }),
    })
    if (!response.ok) return null
    const body = (await response.json().catch(() => null)) as {
      revalidated?: unknown
      pathsDropped?: unknown
      truncated?: unknown
      reason?: unknown
    } | null
    if (!body) return null
    return {
      revalidated: Array.isArray(body.revalidated) ? body.revalidated.length : 0,
      pathsDropped: Number(body.pathsDropped ?? 0) || 0,
      scanTruncated: Boolean(body.truncated),
      reason: typeof body.reason === 'string' ? body.reason : 'ok',
    }
  } catch {
    // Best effort by design — see above. A cache hint that could not be sent
    // is NOT reported: the revalidate window is still underneath it, and
    // telling someone their successful publish half-failed would be a worse
    // lie than saying nothing.
    return null
  }
}

export default revalidateLivePages
