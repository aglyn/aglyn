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
import applyDuePublishSchedule from './apply-publish-schedule'
import getComponents from './get-components'
import getDatasets from './get-datasets'
import { getPublishedCollectionSource } from './get-collection-content'
import getPluginInstalls from './get-plugin-installs'
import getVariables, { getFunctions, getWorkflows } from './get-variables'
import getPublishedLayoutVersion from './get-layout-version'
import getScreenVersion from './get-screen-version'

/**
 * Content-collection context for a compose (AGL-551): the collection the
 * route resolved (list/entry template screens). `entries` rides along when
 * the route already fetched them (list pages); blocks bound to other
 * collections — or to this one when `entries` is absent — fetch on demand.
 */
export interface ComposeCollectionContext {
  slug: string
  entries?: Aglyn.CollectionEntryRecord[]
  /**
   * The entry being rendered (AGL-582, entry-template screens / entry
   * fallback) — the Related posts block resolves against it.
   */
  entry?: Aglyn.CollectionEntryRecord | null
  /**
   * The routed collection's category taxonomy (AGL-582): entry
   * `categoryId`s resolve to display names against it during expansion.
   */
  categories?: Aglyn.CollectionCategory[]
}

/**
 * Expands Collection entries blocks (AGL-551) against their collections'
 * published entries, and Related posts blocks (AGL-582) against the routed
 * entry. Fetches lazily — screens without the blocks cost nothing — and
 * fails open on lookup errors like every other compose stage.
 */
async function expandCollectionEntryBlocks(
  hostId: string,
  nodes: Record<string, any>,
  collection?: ComposeCollectionContext,
): Promise<Record<string, any>> {
  const slugs = new Set<string>()
  let hasRelated = false
  for (const node of Object.values(nodes)) {
    if (node?.componentId === Aglyn.COLLECTION_ENTRIES_COMPONENT_ID) {
      const slug =
        String(node?.props?.collectionSlug ?? '').trim() || collection?.slug
      if (slug) slugs.add(slug)
    }
    // Related posts (AGL-582) always resolve against the ROUTED collection
    // — they only mean something with a current entry in context.
    if (
      node?.componentId === Aglyn.COLLECTION_RELATED_COMPONENT_ID &&
      collection?.slug &&
      collection.entry
    ) {
      hasRelated = true
      slugs.add(collection.slug)
    }
  }
  if (!slugs.size) return nodes
  const sources: Record<string, Aglyn.CollectionEntriesSource> = {}
  await Promise.all(
    [...slugs].map(async (slug) => {
      // The routed collection rides its already-fetched entries +
      // categories (AGL-582); other collections fetch both on demand.
      if (slug === collection?.slug && collection.entries) {
        sources[slug] = {
          slug,
          entries: collection.entries,
          categories: collection.categories,
        }
        return
      }
      const fetched = await getPublishedCollectionSource({
        hostId,
        collectionSlug: slug,
      })
      sources[slug] = {
        slug,
        entries: fetched.entries,
        categories:
          slug === collection?.slug && collection.categories
            ? collection.categories
            : fetched.categories,
      }
    }),
  )
  const expanded = Aglyn.expandCollectionEntries(
    nodes,
    sources,
    collection?.slug,
  )
  if (!hasRelated || !collection?.entry) return expanded
  return Aglyn.expandCollectionRelated(
    expanded,
    sources[collection.slug],
    collection.entry,
  )
}

/**
 * Shared post-version composition (AGL-551, extracted from
 * `composeScreenNodes`): layout chrome, reusable components, repeatables,
 * collection entries, bindings, function definitions, plugin installs,
 * named tokens, denormalize. The screen path and the collection-fallback
 * path (which has no screen doc) build identical trees through this one
 * pipeline.
 */
export async function composeNodesWithChrome(options: {
  hostId: string
  layoutId?: string | null
  screenNodes: Record<string, any>
  /** Entry-template tokens (AGL-105) substituted before denormalize. */
  tokens?: Record<string, string>
  /** Routed content collection (AGL-551) for Collection entries blocks. */
  collection?: ComposeCollectionContext
}): Promise<Record<string, any>> {
  const { hostId, layoutId, screenNodes } = options

  const layoutRes = layoutId
    ? await getPublishedLayoutVersion({ hostId, layoutId })
    : undefined

  const composedNodes = Aglyn.composeLayoutAndScreenNodes(
    layoutRes?.version?.nodes as any,
    screenNodes as any,
  )
  const componentsRes = await getComponents({ hostId })
  const grafted = Aglyn.composeReusableComponentNodes(
    composedNodes as any,
    componentsRes.definitions as any,
  )
  // Host variable + function bindings (AGL-91/93): {{name}} and
  // {{fn:name(args)}} in string props resolve to values; unknown tokens
  // and failed runs stay literal.
  const [rawVariables, functions, datasets, workflows, pluginInstalls] =
    await Promise.all([
      getVariables({ hostId }),
      getFunctions({ hostId }),
      getDatasets({ hostId }),
      getWorkflows({ hostId }),
      getPluginInstalls({ hostId }),
    ])
  // Computed variables (AGL-129): workflow-backed values resolve once per
  // compose; failures keep each variable's stored fallback.
  const variables = Aglyn.resolveComputedVariables(
    rawVariables,
    functions,
    workflows,
  )
  // Repeatables (AGL-103) expand after grafting (so they work inside
  // reusable components) and before bindings (so {{name}} tokens inside
  // cloned items still resolve).
  const repeated = Aglyn.expandRepeatables(grafted as any, datasets)
  // Collection entries blocks (AGL-551) expand alongside repeatables:
  // per-entry {{entry.*}} tokens substitute inside the clones here, while
  // page-level tokens wait for resolveNamedTokens below.
  const withEntries = await expandCollectionEntryBlocks(
    hostId,
    repeated,
    options.collection,
  )
  const bound = Aglyn.resolveNodesBindings(
    withEntries as any,
    variables,
    functions,
  )
  // Function widgets run client-side: embed their definitions (AGL-93).
  const withFunctions = Aglyn.attachFunctionDefinitions(bound, functions)
  // Community plugins (AGL-45): stamp each communityPlugin node with its
  // pinned install (version/sha256/capabilities) + kill-switch state.
  const nodes = Aglyn.attachPluginInstalls(withFunctions, pluginInstalls)
  // Entry-template tokens (AGL-105): {{entry.*}} from the rendered entry.
  const finalNodes = Aglyn.resolveNamedTokens(nodes as any, options.tokens)
  return Aglyn.canvas.processNodesToDenormalized(finalNodes as any)
}

/**
 * Full published-render composition for one screen (extracted for AGL-87 so
 * the SSG path and the password-unlock API build identical trees): applies
 * a due publish schedule, loads the version, composes the shared layout
 * chrome, grafts reusable components, and denormalizes.
 */
export async function composeScreenNodes(options: {
  hostId: string
  screenId: string
  screen: Aglyn.AglynScreen
  /** Entry-template tokens (AGL-105) substituted before denormalize. */
  tokens?: Record<string, string>
  /** Routed content collection (AGL-551) for Collection entries blocks. */
  collection?: ComposeCollectionContext
  /**
   * Compose a specific version instead of the published one (AGL-253):
   * experiment variants point at versions; schedules don't apply.
   */
  versionId?: string
}): Promise<Record<string, any> | null> {
  const { hostId, screenId, screen } = options

  const effectiveVersionId = options.versionId
    ? null
    : await applyDuePublishSchedule({
        hostId,
        collectionName: 'screens',
        docId: screenId,
        parent: screen,
      })
  const versionRes = await getScreenVersion({
    hostId,
    screenId,
    versionId: (options.versionId ??
      effectiveVersionId ??
      screen.versionId) as string,
  })
  if (versionRes.error || !versionRes.version) return null

  return composeNodesWithChrome({
    hostId,
    layoutId: screen.layoutId as string | undefined,
    screenNodes: versionRes.version.nodes as any,
    tokens: options.tokens,
    collection: options.collection,
  })
}

export default composeScreenNodes
