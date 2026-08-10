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

/**
 * Page-level `{{collection.*}}` tokens for template screens (AGL-551), plus
 * the routed category (AGL-1321) so a list template can name what it is
 * showing — "Guides" rather than a heading that says "Blog" on every filtered
 * URL. Both category tokens resolve to the empty string on the unfiltered
 * listing, which is what makes them safe to bind unconditionally.
 *
 * `{{pagination.*}}` follows the same design (AGL-1386). One static list
 * screen serves the bare listing, every `/page/{n}` and every
 * `/category/{slug}`, so a hand-built pager on it renders identically on all
 * of them: "Older →" on a category that has one page, pointing at a URL that
 * dropped the filter. The URLs come from `collectionPaginationLinks`, which
 * builds them through the shared listing-URL builder (so they carry the
 * category) and resolves the EDGES TO THE EMPTY STRING — no previous page,
 * no `prevUrl`. There is no runtime conditional to hide a link with (the
 * `condition` field on nodes is editor-side field visibility, not a render
 * gate), so the empty string is what makes an unconditional binding correct
 * on every route: a link whose href does not resolve renders as an inert
 * placeholder of the same element (AGL-1268/1357).
 *
 * This SURFACES what the platform already computes — the built-in fallback
 * pager reads the same function, so the two cannot drift.
 */
export function collectionTokens(
  collection: Pick<CollectionDoc, 'displayName' | 'slug'>,
  category?: CollectionContent['category'],
  pagination?: CollectionContent['pagination'],
): Record<string, string> {
  // An unpaginated listing is page 1 of 1 — both URLs empty, which reads as
  // the honest "nowhere to page to" rather than a broken link.
  const pager = Aglyn.collectionPaginationLinks({
    collectionSlug: collection.slug,
    ...(category?.slug ? { categorySlug: category.slug } : {}),
    page: pagination?.page,
    totalPages: pagination?.totalPages,
  })
  return {
    'collection.name': collection.displayName,
    'collection.slug': collection.slug,
    'collection.category': category?.name ?? '',
    'collection.categorySlug': category?.slug ?? '',
    'pagination.page': String(pager.page),
    'pagination.totalPages': String(pager.totalPages),
    'pagination.prevUrl': pager.prevUrl,
    'pagination.nextUrl': pager.nextUrl,
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
        // Category names resolve against the collection's taxonomy
        // (AGL-582): `categoryId` lookup first, legacy string fallback.
        ...Aglyn.collectionEntryTokens(
          entry,
          collection.slug,
          collection.categories,
        ),
      }
    : collectionTokens(collection, content.category, content.pagination)
  const nodes = await composeScreenNodes({
    hostId,
    screenId,
    screen: templateRes.screen,
    tokens,
    // List pages hand their already-fetched entries to the Collection
    // entries block; entry pages carry the routed entry (AGL-582, Related
    // posts) and let blocks fetch entry lists on demand (e.g. a "More
    // posts" section on the article template). The category taxonomy
    // rides along so `{{entry.category}}` resolves inside the blocks.
    collection: entry
      ? { slug: collection.slug, entry, categories: collection.categories }
      : {
          slug: collection.slug,
          // Already filtered to the routed category (AGL-1321) — the block
          // repeats what the ROUTE resolved, so a designer-pinned
          // `filterCategory` on the block narrows it further rather than
          // fighting it.
          entries: content.entries,
          categories: collection.categories,
          ...(content.pagination?.page
            ? { page: content.pagination.page }
            : {}),
          ...(content.category ? { categorySlug: content.category.slug } : {}),
        },
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
    : // A LIST passes its screen's own SEO through UNTOUCHED (AGL-1345).
      //
      // This used to default `title` to `collection.displayName`, which reads
      // like a harmless fallback and is not: it made an authored title
      // indistinguishable from a generated one by the time the head was built.
      // The title rule (AGL-1341) turns on exactly that distinction — an
      // authored title renders VERBATIM, a name joins the site title — so a
      // consumer reading this could only choose between dropping the site
      // title off every untitled list ("Changelog") or ignoring the author's
      // title on every titled one ("Changelog – Acme" over the sentence they
      // wrote). The collection name is still the fallback; it just belongs to
      // the title resolver, as the page's `name`, alongside every other
      // surface's fallback rather than baked into stored SEO here.
      screenSeo
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
      pagination: content.pagination,
      category: content.category,
      // The cover resolves through `resolveMediaSrc` (AGL-1407), and an
      // org-scoped reference has to name the site asking or a site-restricted
      // asset will not serve.
      hostId,
    })
    const nodes = await composeNodesWithChrome({
      hostId,
      layoutId,
      screenNodes,
      // Entry routes resolve with an EMPTY entries list (the loader only
      // fetched the one entry), so hand the routed entry over and let the
      // Related posts block fetch the list on demand (AGL-582); list
      // routes keep their already-fetched entries. Categories ride along
      // for `categoryId` → name resolution.
      collection: content.entry
        ? {
            slug: collection.slug,
            entry: content.entry,
            categories: collection.categories,
          }
        : {
            slug: collection.slug,
            entries: content.entries,
            categories: collection.categories,
            ...(content.pagination?.page
              ? { page: content.pagination.page }
              : {}),
            ...(content.category
              ? { categorySlug: content.category.slug }
              : {}),
          },
    })
    return nodes ? { nodes } : null
  } catch (error) {
    console.error(error)
    return null
  }
}

export default composeCollectionTemplatePage
