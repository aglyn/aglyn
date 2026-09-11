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
  applyVideoAssetFacts,
  type VideoAssetFacts,
  videoAssetFactsKey,
  videoAssetRefs,
} from '@aglyn/aglyn/app-utils/video-asset-facts'
import { VIDEO_COMPONENT_ID } from '@aglyn/aglyn/app-utils/video-object'
import { useContext, useEffect, useMemo, useSyncExternalStore } from 'react'
import { VideoAssetFactsContext } from '../contexts/video-asset-facts-context'

const NO_REFS: readonly MediaRef[] = []
const subscribeToNothing = () => () => undefined
const noVersion = () => 0

/**
 * A node map with each placed film's current DAM facts laid over it
 * (AGL-2838): on the canvas, what `composeNodesWithChrome` does to the tree a
 * published page ships.
 *
 * Takes a flat map, children by id, which is the shape `applyVideoAssetFacts`
 * walks. The SAME map comes back until an answer applies — no source, no
 * library film, or a film whose read is pending or failed — so a caller that
 * memoizes on the result pays nothing for a node that is not a film, and a
 * film nobody has answered for renders its stored props.
 *
 * Render copies only. Nothing here writes a node, so a draft never changes
 * because an asset did.
 */
export function useVideoAssetFactsOverlay<T extends Record<string, unknown>>(
  nodes: T | undefined,
): T | undefined {
  const source = useContext(VideoAssetFactsContext)
  const refs = useMemo(
    () => (source && nodes ? videoAssetRefs(nodes) : NO_REFS),
    [source, nodes],
  )
  const refsKey = refs.map(videoAssetFactsKey).join('\n')
  useEffect(() => {
    if (!source || !refs.length) return undefined
    const releases = refs.map((ref) => source.retain(ref))
    return () => {
      for (const release of releases) release()
    }
    // `refsKey` stands in for `refs`: a new map that places the same films
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
    const facts = new Map<string, VideoAssetFacts>()
    for (const ref of refs) {
      const key = videoAssetFactsKey(ref)
      const answer = source.get(key)
      if (answer) facts.set(key, answer)
    }
    return facts.size ? applyVideoAssetFacts(nodes, facts) : nodes
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

/**
 * One node's render copy with its film's current DAM facts laid over it
 * (AGL-2838): {@link useVideoAssetFactsOverlay} for a single leaf.
 *
 * Returns `node` itself for anything that is not a Video element, and for a
 * film nobody has answered for. Canvas nodes are MobX observables whose props
 * change in place, so the copy is keyed by the JSON of those props rather than
 * by the node's identity, the way every other render copy `NodeLeaf` builds
 * is keyed.
 */
export function useNodeWithVideoAssetFacts<N>(node: N): N {
  const rendered = node as RenderedNode | null | undefined
  const isFilm = rendered?.componentId === VIDEO_COMPONENT_ID
  const propsJson = isFilm
    ? JSON.stringify([rendered?.props ?? null, rendered?.resolvedProps ?? null])
    : ''
  const films = useMemo(() => {
    if (!isFilm || !rendered) return undefined
    return {
      film: {
        componentId: rendered.componentId,
        ...(rendered.props ? { props: { ...rendered.props } } : {}),
        ...(rendered.resolvedProps
          ? { resolvedProps: { ...rendered.resolvedProps } }
          : {}),
      },
    }
    // Observable props: the JSON string keys the copy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFilm, rendered, propsJson])
  const overlaid = useVideoAssetFactsOverlay(films)
  return useMemo(() => {
    if (!rendered || !films || overlaid === films) return node
    const film = overlaid?.['film'] as RenderedNode | undefined
    if (!film) return node
    return {
      ...rendered,
      ...(film.props ? { props: film.props } : {}),
      ...(film.resolvedProps ? { resolvedProps: film.resolvedProps } : {}),
    } as N
  }, [node, rendered, films, overlaid])
}

export default useVideoAssetFactsOverlay
