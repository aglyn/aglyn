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

import type { AglynNodeSchema, NodeId } from '../foundation'
import { resolveNamedTokens } from './resolve-named-tokens'

/**
 * Persisted component id of the "Collection entries" repeater block
 * (plugins-mui). Like `layoutSlot`, the id lives here so the tenant compose
 * pipeline can find the block without importing the component bundle.
 */
export const COLLECTION_ENTRIES_COMPONENT_ID = 'collectionEntries'

/** Persisted component id of the markdown "Entry body" block (plugins-mui). */
export const COLLECTION_ENTRY_BODY_COMPONENT_ID = 'collectionEntryBody'

/**
 * Persisted component id of the "Related posts" block (plugins-mui,
 * AGL-582). The compose pipeline stamps the related entries onto the node,
 * so the id lives here like the entries/body blocks.
 */
export const COLLECTION_RELATED_COMPONENT_ID = 'collectionRelated'

/** Persisted component id of the share-bar block (plugins-mui, AGL-582). */
export const COLLECTION_SHARE_COMPONENT_ID = 'collectionShare'

/** Persisted component id of the entry-meta block (plugins-mui, AGL-582). */
export const COLLECTION_ENTRY_META_COMPONENT_ID = 'collectionEntryMeta'

/** Namespaces cloned template ids per container/entry (cf. `rep__`). */
export const COLLECTION_ENTRIES_NODE_ID_PREFIX = 'centry__'

/** Hard bound on entries a single block renders, before `entriesLimit`. */
export const COLLECTION_ENTRIES_MAX = 100

/** Default/most related posts a Related posts block renders (AGL-582). */
export const COLLECTION_RELATED_DEFAULT_LIMIT = 3
export const COLLECTION_RELATED_MAX = 12

/**
 * One published content-collection entry as the compose pipeline sees it
 * (AGL-551). Mirrors the tenant's `CollectionEntrySummary` without the
 * Firestore dependency so the expansion stays pure.
 */
export interface CollectionEntryRecord {
  $id?: string
  title?: string
  slug?: string
  excerpt?: string
  body?: string
  coverImage?: string
  /** Search-result title override (AGL-582); falls back to `title`. */
  seoTitle?: string
  /** Meta description override (AGL-582); falls back to `excerpt`. */
  seoDescription?: string
  /** Single taxonomy bucket (AGL-582), e.g. "Engineering". */
  category?: string
  /** Free-form labels (AGL-582), e.g. ["nextjs", "seo"]. */
  tags?: string[]
  publishedAt?: { seconds: number } | null
}

/** A collection's published entries, keyed for expansion by its slug. */
export interface CollectionEntriesSource {
  slug: string
  entries: CollectionEntryRecord[]
}

/**
 * The `{{entry.*}}` token map for one entry (AGL-105/551): substituted
 * globally on entry-template screens and per-clone inside the Collection
 * entries block. `entry.url` resolves to the entry's auto-route so links
 * (`Read more`, titles) work without hardcoding the collection slug.
 */
export function collectionEntryTokens(
  entry: CollectionEntryRecord,
  collectionSlug: string,
): Record<string, string> {
  return {
    'entry.title': entry.title ?? '',
    'entry.excerpt': entry.excerpt ?? '',
    'entry.body': entry.body ?? '',
    'entry.coverImage': entry.coverImage ?? '',
    'entry.slug': entry.slug ?? '',
    'entry.url': `/${collectionSlug}/${entry.slug ?? ''}`,
    'entry.date': entry.publishedAt?.seconds
      ? new Date(entry.publishedAt.seconds * 1000).toLocaleDateString()
      : '',
    // Entry model v2 (AGL-582): taxonomy + SEO tokens. The SEO pair falls
    // back to title/excerpt so templates can bind them unconditionally.
    'entry.category': entry.category ?? '',
    'entry.tags': (entry.tags ?? []).join(', '),
    'entry.seoTitle': entry.seoTitle || entry.title || '',
    'entry.seoDescription': entry.seoDescription || entry.excerpt || '',
  }
}

/**
 * Category/tag membership check (AGL-582), shared by the Collection entries
 * filter props and the query-less list surfaces. Matching is trimmed and
 * case-insensitive — editors type these by hand.
 */
export function entryMatchesFilter(
  entry: CollectionEntryRecord,
  filter: { category?: string; tag?: string },
): boolean {
  const normalize = (value: string) => value.trim().toLowerCase()
  if (filter.category) {
    if (normalize(entry.category ?? '') !== normalize(filter.category)) {
      return false
    }
  }
  if (filter.tag) {
    const wanted = normalize(filter.tag)
    if (!(entry.tags ?? []).some((tag) => normalize(tag) === wanted)) {
      return false
    }
  }
  return true
}

/**
 * Collection entries blocks (AGL-551): a `collectionEntries` container
 * treats its children as the item template and renders them once per
 * published entry, with `{{entry.*}}` tokens in cloned string props replaced
 * per entry — the content-collection sibling of {@link expandRepeatables}.
 *
 * - The block's collection resolves from its `collectionSlug` prop, falling
 *   back to `defaultSlug` (the routed collection on list-template screens).
 * - Clone ids are namespaced `centry__{containerId}__{index}__…` so repeats
 *   never collide; run AFTER grafting and BEFORE binding resolution.
 * - Rows are bounded by `props.entriesLimit` and
 *   {@link COLLECTION_ENTRIES_MAX}.
 * - Unknown collections or empty entry lists leave the node untouched
 *   (fail-open: a renamed collection must never take a screen down).
 * - Inputs are never mutated; template nodes stay in the map unreferenced.
 */
export function expandCollectionEntries<
  N extends AglynNodeSchema = AglynNodeSchema,
>(
  nodes: Record<NodeId, N>,
  sourcesBySlug: Record<string, CollectionEntriesSource | undefined>,
  defaultSlug?: string,
): Record<NodeId, N> {
  const containers = Object.entries(nodes).filter(
    ([, node]) => node?.componentId === COLLECTION_ENTRIES_COMPONENT_ID,
  )
  if (!containers.length) return nodes

  const next: Record<NodeId, N> = { ...nodes }
  for (const [containerId, container] of containers) {
    const slug =
      String((container.props as any)?.collectionSlug ?? '').trim() ||
      defaultSlug
    const source = slug ? sourcesBySlug[slug] : undefined
    if (!source?.entries?.length) continue
    const limitRaw = Number((container.props as any)?.entriesLimit)
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(limitRaw, COLLECTION_ENTRIES_MAX)
        : COLLECTION_ENTRIES_MAX
    const templateIds = Array.isArray(container.nodes)
      ? (container.nodes as NodeId[])
      : []
    if (!templateIds.length) continue

    // Category/tag filter props (AGL-582): the block-level answer to
    // /blog?tag=x — query params never reach the ISR-cached loader, so
    // filtered lists are designed as filtered BLOCKS instead.
    const filterCategory = String(
      (container.props as any)?.filterCategory ?? '',
    ).trim()
    const filterTag = String(
      (container.props as any)?.filterTag ?? '',
    ).trim()
    const filtered =
      filterCategory || filterTag
        ? source.entries.filter((entry) =>
            entryMatchesFilter(entry, {
              category: filterCategory || undefined,
              tag: filterTag || undefined,
            }),
          )
        : source.entries

    const childIds: NodeId[] = []
    filtered.slice(0, limit).forEach((entry, index) => {
      const prefix = `${COLLECTION_ENTRIES_NODE_ID_PREFIX}${containerId}__${index}__`
      const prefixId = (id: NodeId) => `${prefix}${id}`
      const cloned: Record<NodeId, N> = {}
      const cloneSubtree = (id: NodeId, parentId: NodeId) => {
        const node = nodes[id]
        if (!node) return
        const clonedChildren = Array.isArray(node.nodes)
          ? (node.nodes as NodeId[])
          : undefined
        cloned[prefixId(id)] = {
          ...node,
          $id: prefixId(id),
          parentId,
          ...(clonedChildren && {
            nodes: clonedChildren.map((childId) => prefixId(childId)),
          }),
        }
        clonedChildren?.forEach((childId) =>
          cloneSubtree(childId, prefixId(id)),
        )
      }
      for (const templateId of templateIds) {
        cloneSubtree(templateId, containerId)
        childIds.push(prefixId(templateId))
      }
      Object.assign(
        next,
        resolveNamedTokens(cloned, collectionEntryTokens(entry, source.slug)),
      )
    })
    next[containerId] = { ...container, nodes: childIds }
  }
  return next
}

/** One related post as stamped onto a Related posts block (AGL-582). */
export interface CollectionRelatedItem {
  title: string
  url: string
  date?: string
  excerpt?: string
  category?: string
}

/**
 * Related-post selection (AGL-582): other entries of the same collection
 * that share the current entry's category or at least one tag, newest
 * first. Pure so the compose stage and tests share one implementation. An
 * entry with no category and no tags relates to nothing — the caller
 * renders nothing rather than guessing.
 */
export function selectRelatedEntries(
  entries: CollectionEntryRecord[],
  current: CollectionEntryRecord,
  limit = COLLECTION_RELATED_DEFAULT_LIMIT,
): CollectionEntryRecord[] {
  const category = (current.category ?? '').trim()
  const tags = (current.tags ?? []).map((tag) => tag.trim()).filter(Boolean)
  if (!category && !tags.length) return []
  const bounded = Math.min(
    Math.max(limit, 0) || COLLECTION_RELATED_DEFAULT_LIMIT,
    COLLECTION_RELATED_MAX,
  )
  return entries
    .filter((entry) => {
      if (
        (entry.$id && entry.$id === current.$id) ||
        (entry.slug && entry.slug === current.slug)
      ) {
        return false
      }
      if (category && entryMatchesFilter(entry, { category })) return true
      return tags.some((tag) => entryMatchesFilter(entry, { tag }))
    })
    .sort(
      (a, b) => (b.publishedAt?.seconds ?? 0) - (a.publishedAt?.seconds ?? 0),
    )
    .slice(0, bounded)
}

/**
 * Related posts blocks (AGL-582): stamps each `collectionRelated` node with
 * the current entry's related posts as a serializable `entries` prop the
 * component renders directly (no template cloning — the block owns its
 * markup). Runs only on entry renders; without an entry context the nodes
 * stay untouched, so the component's besigner placeholder / empty site
 * render applies. Inputs are never mutated.
 */
export function expandCollectionRelated<
  N extends AglynNodeSchema = AglynNodeSchema,
>(
  nodes: Record<NodeId, N>,
  source: CollectionEntriesSource | undefined,
  currentEntry: CollectionEntryRecord | null | undefined,
): Record<NodeId, N> {
  if (!source || !currentEntry) return nodes
  const containers = Object.entries(nodes).filter(
    ([, node]) => node?.componentId === COLLECTION_RELATED_COMPONENT_ID,
  )
  if (!containers.length) return nodes

  const next: Record<NodeId, N> = { ...nodes }
  for (const [containerId, container] of containers) {
    const limitRaw = Number((container.props as any)?.limit)
    const related = selectRelatedEntries(
      source.entries ?? [],
      currentEntry,
      Number.isFinite(limitRaw) && limitRaw > 0
        ? limitRaw
        : COLLECTION_RELATED_DEFAULT_LIMIT,
    )
    const items: CollectionRelatedItem[] = related.map((entry) => ({
      title: entry.title ?? '',
      url: `/${source.slug}/${entry.slug ?? ''}`,
      ...(entry.publishedAt?.seconds
        ? {
            date: new Date(
              entry.publishedAt.seconds * 1000,
            ).toLocaleDateString(),
          }
        : {}),
      ...(entry.excerpt ? { excerpt: entry.excerpt } : {}),
      ...(entry.category ? { category: entry.category } : {}),
    }))
    next[containerId] = {
      ...container,
      props: { ...(container.props as any), entries: items },
    }
  }
  return next
}

export default expandCollectionEntries
