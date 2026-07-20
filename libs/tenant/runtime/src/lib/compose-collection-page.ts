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
import buildCollectionFallbackNodes from './collection-fallback-nodes'
import composeScreenNodes, {
  composeNodesWithChrome,
} from './compose-screen-nodes'
import type { CollectionContent } from './get-collection-content'
import getScreen from './get-screen'

type CollectionDoc = NonNullable<CollectionContent['collection']>

/**
 * Which template screen a collection route renders through (AGL-551):
 * `/{collection}` uses `listScreenId`, `/{collection}/{entry}` uses
 * `entryScreenId` — falling back to the legacy AGL-105 `templateScreenId`
 * so existing blogs keep rendering. `undefined` means no template is set
 * and the designed built-in fallback applies.
 */
export function resolveCollectionTemplateScreenId(
  collection: Pick<
    CollectionDoc,
    'listScreenId' | 'entryScreenId' | 'templateScreenId'
  >,
  kind: 'list' | 'entry',
): string | undefined {
  if (kind === 'list') return collection.listScreenId || undefined
  return collection.entryScreenId || collection.templateScreenId || undefined
}

/** Page-level `{{collection.*}}` tokens for template screens (AGL-551). */
export function collectionTokens(
  collection: Pick<CollectionDoc, 'displayName' | 'slug'>,
): Record<string, string> {
  return {
    'collection.name': collection.displayName,
    'collection.slug': collection.slug,
  }
}

export interface ComposedCollectionPage {
  /** Template screen doc with the entry/collection SEO merged in. */
  screen: Record<string, any>
  nodes: Record<string, any>
}

/**
 * Renders a collection route through its designated template screen
 * (AGL-551), the same mechanism as commerce PDP/collection templates: the
 * screen composes through the NORMAL published pipeline — theme, shared
 * layout, reusable components — with `{{entry.*}}`/`{{collection.*}}`
 * tokens substituted and Collection entries blocks expanded. Returns null
 * when no template is designated (or it fails to compose) so the caller
 * falls through to the designed built-in fallback.
 */
export async function composeCollectionTemplatePage(options: {
  hostId: string
  content: CollectionContent
}): Promise<ComposedCollectionPage | null> {
  const { hostId, content } = options
  const collection = content.collection
  if (!collection) return null
  const kind = content.entry ? 'entry' : 'list'
  const screenId = resolveCollectionTemplateScreenId(collection, kind)
  if (!screenId) return null

  const templateRes = await getScreen({ hostId, screenId })
  if (!templateRes.screen) return null

  const entry = content.entry
  const tokens = entry
    ? {
        ...collectionTokens(collection),
        ...Aglyn.collectionEntryTokens(entry, collection.slug),
      }
    : collectionTokens(collection)
  const nodes = await composeScreenNodes({
    hostId,
    screenId,
    screen: templateRes.screen,
    tokens,
    // List pages hand their already-fetched entries to the Collection
    // entries block; entry pages carry the routed entry (AGL-582, Related
    // posts) and let blocks fetch entry lists on demand (e.g. a "More
    // posts" section on the article template).
    collection: entry
      ? { slug: collection.slug, entry }
      : { slug: collection.slug, entries: content.entries },
  })
  if (!nodes) return null

  const screenSeo = (templateRes.screen as any).seo ?? {}
  const seo = entry
    ? // Entry metadata drives the head (AGL-117 merge; AGL-582 overrides).
      {
        ...screenSeo,
        title: entry.seoTitle || entry.title,
        description: entry.seoDescription || entry.excerpt || undefined,
        image: entry.coverImage || screenSeo.image || undefined,
      }
    : { ...screenSeo, title: screenSeo.title ?? collection.displayName }
  return {
    screen: { ...(templateRes.screen as any), seo },
    nodes,
  }
}

/**
 * The designed built-in rendering (AGL-551): when a collection has no
 * template screen, its routes still compose through the site's theme and
 * the host's default shared layout (the home screen's layout) instead of
 * the old unthemed article. Fail-open — any error returns null and the
 * caller keeps the legacy plain rendering.
 */
export async function composeCollectionFallbackPage(options: {
  hostId: string
  host: Aglyn.AglynHost
  content: CollectionContent
}): Promise<{ nodes: Record<string, any> } | null> {
  const { hostId, host, content } = options
  const collection = content.collection
  if (!collection) return null
  try {
    // Host default layout: screens carry their own layoutId, so the home
    // screen's shared layout is the closest thing to a site-wide default.
    const screensMap = (host.screens ?? {}) as Record<string, string>
    const homeEntry = Object.entries(screensMap).find(
      ([, path]) => path === Aglyn.SCREEN_ROOT_PATH,
    )
    let layoutId: string | undefined
    if (homeEntry) {
      const homeRes = await getScreen({ hostId, screenId: homeEntry[0] })
      layoutId = (homeRes.screen as any)?.layoutId ?? undefined
    }
    const screenNodes = buildCollectionFallbackNodes({
      collection,
      entries: content.entries,
      entry: content.entry,
    })
    const nodes = await composeNodesWithChrome({
      hostId,
      layoutId,
      screenNodes,
      // Entry routes resolve with an EMPTY entries list (the loader only
      // fetched the one entry), so hand the routed entry over and let the
      // Related posts block fetch the list on demand (AGL-582); list
      // routes keep their already-fetched entries.
      collection: content.entry
        ? { slug: collection.slug, entry: content.entry }
        : { slug: collection.slug, entries: content.entries },
    })
    return nodes ? { nodes } : null
  } catch (error) {
    console.error(error)
    return null
  }
}

export default composeCollectionTemplatePage
