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

/** Namespaces cloned template ids per container/entry (cf. `rep__`). */
export const COLLECTION_ENTRIES_NODE_ID_PREFIX = 'centry__'

/** Hard bound on entries a single block renders, before `entriesLimit`. */
export const COLLECTION_ENTRIES_MAX = 100

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
  }
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

    const childIds: NodeId[] = []
    source.entries.slice(0, limit).forEach((entry, index) => {
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

export default expandCollectionEntries
