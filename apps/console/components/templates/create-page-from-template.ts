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
import { resolveNamedTokens } from '@aglyn/aglyn'
import {
  resolveTemplateSlug,
  templateScreenAddressRefusal,
  withBundleRootScreen,
} from '@aglyn/aglyn/app-utils/template-slug'
import type { Firestore } from 'firebase/firestore'
import { publishScreenRoute } from '../../constants/screen-publishing'

/**
 * Create one live page from a node map (AGL-672).
 *
 * Both paths that make a page from saved content — using a library template
 * and applying a code-defined starter — went through their own copy of
 * this: create the screen via the quota-enforcing resources API, write the
 * version doc client-side, then publish the route. Two copies of a sequence
 * that must stay in step is one too many, especially the slug de-confliction
 * (getting it wrong overwrites a live page).
 *
 * `usedSlugs` is mutated so a caller creating several pages in a row does
 * not hand two of them the same address.
 */
export async function createPageFromTemplate(
  firestore: Firestore,
  createHostResource: (options: {
    hostId: string
    resource: 'screen'
    data: Record<string, unknown>
    id?: string
  }) => Promise<{ id: string }>,
  createHostVersion: (options: {
    hostId: string
    kind: 'screen'
    parentId: string
    id?: string
    data?: Record<string, unknown>
  }) => Promise<{ id: string }>,
  input: {
    hostId: string
    displayName: string
    nodes: Record<string, unknown>
    description?: string
    seo?: Record<string, unknown>
    /**
     * Preferred address; de-conflicted against `usedSlugs`. `'/'` asks for
     * the site root — see {@link resolveTemplateSlug}.
     */
    slug?: string
    /** Values for any `{{name}}` tokens the content declares. */
    placeholderValues?: Record<string, string> | null
    /** Slugs already taken. Mutated with whatever this page claims. */
    usedSlugs: Set<string>
    /** Version label, e.g. "Installed from template". */
    versionLabel?: string
    /**
     * The signed-in user, so the route this publishes can announce itself to
     * the live site (AGL-2573). Threaded through rather than looked up here:
     * this module is called from three template surfaces and holds no auth
     * context of its own.
     */
    user: { getIdToken?: () => Promise<string> } | undefined | null
  },
): Promise<{ screenId: string; slug: string; requestedSlug: string }> {
  const {
    hostId,
    displayName,
    nodes,
    description,
    seo,
    placeholderValues,
    usedSlugs,
    versionLabel = 'Initial version',
    user,
  } = input

  /*
   * BOTH STORED FORMS (AGL-1151).
   *
   * Decoded HERE rather than at each caller, because the callers are the
   * problem: two of them hand this the `nodes` off a template document read
   * through a collection query, which has no converter, so the value arrives
   * exactly as stored — msgpack for anything written since templates were
   * compressed, a plain map for everything older. A third passes a tree it
   * built in memory, and `decodeStoredNodes` returns that unchanged too.
   *
   * The failure it prevents is silent: `resolveNamedTokens` over a `Bytes`
   * matches no tokens and hands it straight back, so the page is created,
   * the route is published, and the author is looking at a blank screen with
   * no indication that anything went wrong.
   */
  const resolved = resolveNamedTokens(
    (Aglyn.decodeStoredNodes<Record<string, unknown>>(nodes) ?? {}) as any,
    placeholderValues ?? null,
  )
  const { slug, requestedSlug } = resolveTemplateSlug({
    slug: input.slug,
    displayName,
    usedSlugs,
  })

  const screenId = Aglyn.createResourceUid()
  const versionId = Aglyn.createResourceUid()

  // Screen doc rides the quota-enforcing resources API (AGL-473); the version
  // rides /api/hosts/versions (AGL-1369), which allows a resource's FIRST
  // version on any plan and charges `versioning` only for retaining more.
  // This one is always a first — the screen above did not exist a line ago.
  await createHostResource({
    hostId,
    resource: 'screen',
    id: screenId,
    data: {
      displayName,
      ...(description ? { description } : {}),
      ...(seo ? { seo } : {}),
      versionId,
    },
  })
  await createHostVersion({
    hostId,
    kind: 'screen',
    parentId: screenId,
    id: versionId,
    data: {
      screenId,
      displayName: versionLabel,
      nodes: resolved,
    },
  })
  await publishScreenRoute(firestore, { hostId, screenId, user }, slug)
  // No activity append here. `createHostResource` above is
  // /api/hosts/resources, which records the create server-side from a
  // verified uid (AGL-118) — so this path logs whether or not its caller
  // remembers to, which is the property that was missing when three template
  // surfaces created pages and wrote nothing.

  return { screenId, slug, requestedSlug }
}

export { resolveTemplateSlug, templateScreenAddressRefusal, withBundleRootScreen }

export default createPageFromTemplate
