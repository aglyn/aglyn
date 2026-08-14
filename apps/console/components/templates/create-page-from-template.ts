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
import {
  normalizeScreenSlug,
  resolveNamedTokens,
  SCREEN_ROOT_PATH,
} from '@aglyn/aglyn'
import type { Firestore } from 'firebase/firestore'
import { publishScreenRoute } from '../../constants/screen-publishing'

/**
 * The address one template page claims (AGL-1575).
 *
 * This used to be a private `slugifyPageName` that stripped every character
 * outside `[a-z0-9]`, so `'/'` and `''` both reduced to the empty string and
 * fell through to the display name. A template screen asking for the SITE
 * ROOT could therefore never get it: the shop starters declared `slug: ''`
 * meaning home and were published at `/home`, and a site started from any
 * template 404'd at its own URL while the console showed a success toast.
 *
 * The routing-map format has one canonical normalizer — `normalizeScreenSlug`
 * — which is what the Screens page and the besigner already publish through,
 * and which is the only place that knows `'/'` is the root path rather than
 * punctuation. Template pages now go through it too, so all three surfaces
 * agree on what a user-supplied address means.
 *
 * ## De-confliction (the invariant)
 *
 * `usedSlugs` holds every path already routed on the host plus everything
 * claimed earlier in the same batch. A claim that collides FALLS BACK; it
 * never overwrites, because the caller publishes into the host's routing map
 * and a duplicate path would take a live page off the site.
 *
 * The root is the interesting case: `'/-2'` is not an address, so a second
 * claimant on a host that already has a home page falls back to its NAME
 * (`Home` → `home`), and only then to numeric suffixes. First claimant wins
 * the root; everybody after it gets a real path of their own.
 *
 * Mutates `usedSlugs` with whatever it hands out.
 */
export function resolveTemplateSlug(input: {
  /** Preferred address as authored — `'/'` (or `SCREEN_ROOT_PATH`) for home. */
  slug?: string
  /** Falls back to a slug of this when no address is authored. */
  displayName: string
  /** Paths already taken. Mutated with whatever this page claims. */
  usedSlugs: Set<string>
}): { slug: string; requestedSlug: string } {
  const { usedSlugs } = input
  // `normalizeScreenSlug` returns undefined for anything that sanitizes away
  // (`''`, `'###'`) — the caller decides what that means, and here it means
  // "no address authored", so the display name answers instead.
  const named = normalizeScreenSlug(input.displayName) ?? 'page'
  const requested = normalizeScreenSlug(input.slug) ?? named

  const base =
    requested === SCREEN_ROOT_PATH && usedSlugs.has(SCREEN_ROOT_PATH)
      ? named
      : requested
  let slug = base
  let attempt = 2
  while (usedSlugs.has(slug)) slug = `${base}-${attempt++}`
  usedSlugs.add(slug)
  return { slug, requestedSlug: requested }
}

/**
 * Gives a multi-page bundle a home page when nothing in it claims one
 * (AGL-1575).
 *
 * A starter is somebody's whole site, and a site whose root 404s is broken in
 * the one place every visitor lands. When no screen in the bundle asks for
 * `SCREEN_ROOT_PATH` and the host has no root route yet, the FIRST screen —
 * authored order, which is the order the author meant them to be created in —
 * takes it. That also repairs starters materialized before this fix, whose
 * seeded documents dropped the home screen's `slug: ''` on the floor.
 *
 * Deliberately NOT applied to the single-template "Use template" dialog: the
 * user types an address there, and silently re-pointing an explicit answer at
 * the root would be a worse surprise than a site that needs a home page.
 * Deliberately conditional on the host having no root: it never moves a live
 * home page, which is the same invariant `resolveTemplateSlug` protects.
 */
export function withBundleRootScreen<T extends { slug?: string }>(
  screens: readonly T[],
  usedSlugs: Iterable<string>,
): T[] {
  const list = [...screens]
  if (!list.length) return list
  if ([...usedSlugs].includes(SCREEN_ROOT_PATH)) return list
  const claimsRoot = list.some(
    (screen) => normalizeScreenSlug(screen.slug) === SCREEN_ROOT_PATH,
  )
  if (claimsRoot) return list
  list[0] = { ...list[0], slug: SCREEN_ROOT_PATH }
  return list
}

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
  } = input

  const resolved = resolveNamedTokens(nodes as any, placeholderValues ?? null)
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
  await publishScreenRoute(firestore, { hostId, screenId }, slug)

  return { screenId, slug, requestedSlug }
}

export default createPageFromTemplate
