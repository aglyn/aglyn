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

import type { MediaRef } from '@aglyn/aglyn'
// By path: the overlay rules stay out of every `@aglyn/aglyn` barrel.
import {
  applyMediaAssetFacts,
  IMAGE_COMPONENT_ID,
  type MediaAssetFacts,
  mediaAssetFactsKey,
  mediaAssetRefs,
} from '@aglyn/aglyn/app-utils/media-asset-facts'
import { VIDEO_COMPONENT_ID } from '@aglyn/aglyn/app-utils/video-object'
import { useContext, useEffect, useMemo, useSyncExternalStore } from 'react'
import { MediaAssetFactsContext } from '../contexts/media-asset-facts-context'

const NO_REFS: readonly MediaRef[] = []
const subscribeToNothing = () => () => undefined
const noVersion = () => 0

/**
 * A node map with each placed library asset's current DAM facts laid over it
 * (AGL-2838, AGL-2856): on the canvas, what `composeNodesWithChrome` does to
 * the tree a published page ships, for images and films alike.
 *
 * Takes a flat map, children by id, which is the shape `applyMediaAssetFacts`
 * walks. The SAME map comes back until an answer applies — no source, no
 * library asset, or an asset whose read is pending or failed — so a caller
 * that memoizes on the result pays nothing for a node that places no asset,
 * and an asset nobody has answered for renders its stored props.
 *
 * Render copies only. Nothing here writes a node, so a draft never changes
 * because an asset did.
 */
export function useMediaAssetFactsOverlay<T extends Record<string, unknown>>(
  nodes: T | undefined,
): T | undefined {
  const source = useContext(MediaAssetFactsContext)
  const refs = useMemo(
    () => (source && nodes ? mediaAssetRefs(nodes) : NO_REFS),
    [source, nodes],
  )
  const refsKey = refs.map(mediaAssetFactsKey).join('\n')
  useEffect(() => {
    if (!source || !refs.length) return undefined
    const releases = refs.map((ref) => source.retain(ref))
    return () => {
      for (const release of releases) release()
    }
    // `refsKey` stands in for `refs`: a new map that places the same assets
    // keeps the reads it already holds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, refsKey])
  const version = useSyncExternalStore(
    source && refs.length ? source.subscribe : subscribeToNothing,
    source ? source.getVersion : noVersion,
    noVersion,
  )
  return useMemo(() => {
    if (!source || !nodes || !refs.length) return nodes
    const facts = new Map<string, MediaAssetFacts>()
    for (const ref of refs) {
      const key = mediaAssetFactsKey(ref)
      const answer = source.get(key)
      if (answer) facts.set(key, answer)
    }
    return facts.size ? applyMediaAssetFacts(nodes, facts) : nodes
    // `version` is what carries a new answer in; the body reads it through
    // `source.get`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, nodes, refs, version])
}

/** The part of a node `Leaf` renders from. */
interface RenderedNode {
  componentId?: string
  props?: Record<string, unknown>
  resolvedProps?: Record<string, unknown>
}

/** The elements whose placement follows its file, as the composition lists them. */
const followsItsFile = (componentId: string | undefined): boolean =>
  componentId === VIDEO_COMPONENT_ID || componentId === IMAGE_COMPONENT_ID

/**
 * One node's render copy with its asset's current DAM facts laid over it
 * (AGL-2838, AGL-2856): {@link useMediaAssetFactsOverlay} for a single leaf.
 *
 * Returns `node` itself for anything that is not a Video or Image element, and
 * for an asset nobody has answered for. Canvas nodes are MobX observables
 * whose props change in place, so the copy is keyed by the JSON of those props
 * rather than by the node's identity, the way every other render copy
 * `NodeLeaf` builds is keyed.
 */
export function useNodeWithMediaAssetFacts<N>(node: N): N {
  const rendered = node as RenderedNode | null | undefined
  const placesAsset = followsItsFile(rendered?.componentId)
  const propsJson = placesAsset
    ? JSON.stringify([rendered?.props ?? null, rendered?.resolvedProps ?? null])
    : ''
  const single = useMemo(() => {
    if (!placesAsset || !rendered) return undefined
    return {
      leaf: {
        componentId: rendered.componentId,
        ...(rendered.props ? { props: { ...rendered.props } } : {}),
        ...(rendered.resolvedProps
          ? { resolvedProps: { ...rendered.resolvedProps } }
          : {}),
      },
    }
    // Observable props: the JSON string keys the copy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placesAsset, rendered, propsJson])
  const overlaid = useMediaAssetFactsOverlay(single)
  return useMemo(() => {
    if (!rendered || !single || overlaid === single) return node
    const leaf = overlaid?.['leaf'] as RenderedNode | undefined
    if (!leaf) return node
    return {
      ...rendered,
      ...(leaf.props ? { props: leaf.props } : {}),
      ...(leaf.resolvedProps ? { resolvedProps: leaf.resolvedProps } : {}),
    } as N
  }, [node, rendered, single, overlaid])
}

export default useMediaAssetFactsOverlay
