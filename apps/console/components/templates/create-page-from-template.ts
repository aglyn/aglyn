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
import { Timestamp } from '@aglyn/shared-util-timestamp'
import type { Firestore } from 'firebase/firestore'
import { doc, setDoc } from 'firebase/firestore'
import { publishScreenRoute } from '../../constants/screen-publishing'

/** Firestore-safe slug: lowercase, dashes, no leading/trailing dash. */
export function slugifyPageName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
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
  input: {
    hostId: string
    displayName: string
    nodes: Record<string, unknown>
    description?: string
    seo?: Record<string, unknown>
    /** Preferred address; de-conflicted against `usedSlugs`. */
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
  const base =
    slugifyPageName(input.slug ?? '') || slugifyPageName(displayName) || 'page'
  let slug = base
  let attempt = 2
  while (usedSlugs.has(slug)) slug = `${base}-${attempt++}`
  usedSlugs.add(slug)

  const screenId = Aglyn.createResourceUid()
  const versionId = Aglyn.createResourceUid()
  const timestamp = Timestamp.now()

  // Screen doc rides the quota-enforcing resources API (AGL-473); the
  // version stays client-written, matching every other creation path.
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
  await setDoc(
    doc(firestore, 'hosts', hostId, 'screens', screenId, 'versions', versionId),
    {
      screenId,
      displayName: versionLabel,
      nodes: resolved,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  )
  await publishScreenRoute(firestore, { hostId, screenId }, slug)

  return { screenId, slug, requestedSlug: base }
}

export default createPageFromTemplate
