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

import {
  collectDescendantIds,
  REUSABLE_INSTANCE_COMPONENT_ID,
} from '@aglyn/aglyn/app-utils/compose-reusable-components'
import {
  composeHostComponentNodes,
  type ComponentStoreLike,
} from '@aglyn/aglyn/app-utils/load-referenced-components'

/** Why an email with a dangling reusable block is not published. */
export const EMAIL_UNRESOLVED_BLOCK_REFUSAL =
  'This email places a reusable block whose component is deleted or has ' +
  'never been published. Publish the component or remove the block, then ' +
  'publish the email again.'

/**
 * An email design with the site's reusable blocks INLINED — what both email
 * publishers hand the marketplace (AGL-3287).
 *
 * A shared header or footer is a `reusableInstance` naming a component on the
 * SELLER'S site. A listing is installed into another org, which has none of
 * those components, so a design that kept the reference would install with
 * the blocks missing — and the sanitizer refuses the reference outright
 * anyway, because a placement pointing into another tenant's documents is
 * exactly what its allowlist exists to keep out. So each placement is
 * replaced by the blocks it renders, from the component's PUBLISHED design,
 * with the placement's own property values and attribute overrides applied:
 * the listing is what the seller's own mail looks like, and depends on
 * nothing the seller keeps.
 *
 * A placement that does not resolve — a deleted component, one never
 * published — is REFUSED rather than dropped. It renders nothing in the
 * seller's own mail, but a publish that silently removed part of the design
 * would teach the seller nothing, which is the same argument the starter's
 * inspection makes for refusing a URL instead of trimming it. Only placements
 * the design actually draws count, from `rootId` down, which is the walk the
 * sanitizer publishes.
 */
export async function inlineReusableBlocks<M extends Record<string, unknown>>(
  nodes: M,
  context: { firestore: ComponentStoreLike; hostId: string; rootId: string },
): Promise<{ ok: true; nodes: M } | { ok: false; error: string }> {
  const { rootId, ...site } = context
  const inlined = await composeHostComponentNodes(nodes, site)
  const drawn = [rootId, ...collectDescendantIds(inlined as never, rootId)]
  const dangling = drawn.some(
    (id) =>
      (inlined[id] as { componentId?: unknown } | undefined)?.componentId ===
      REUSABLE_INSTANCE_COMPONENT_ID,
  )
  return dangling
    ? { ok: false, error: EMAIL_UNRESOLVED_BLOCK_REFUSAL }
    : { ok: true, nodes: inlined }
}
