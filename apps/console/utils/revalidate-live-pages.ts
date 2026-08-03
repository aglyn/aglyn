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

export async function revalidateLivePages(
  options: RevalidateLivePagesOptions,
): Promise<void> {
  const { user, hostId, screenId, layoutId, componentId } = options
  if (!hostId || (!screenId && !layoutId && !componentId)) return
  try {
    const idToken = await user?.getIdToken?.()
    if (!idToken) return
    await fetch('/api/screens/revalidate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        hostId,
        ...(screenId ? { screenId } : {}),
        ...(layoutId ? { layoutId } : {}),
        ...(componentId ? { componentId } : {}),
      }),
    })
  } catch {
    // Best effort by design — see above.
  }
}

export default revalidateLivePages
