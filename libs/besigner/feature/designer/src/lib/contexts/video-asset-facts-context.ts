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
  type VideoAssetFacts,
  videoAssetFactsKey,
} from '@aglyn/aglyn/app-utils/video-asset-facts'
import { createContext } from 'react'

/**
 * What each placed film's DAM asset records NOW, for the canvas (AGL-2838).
 *
 * Picking a library film copies its running time, its frame's pixel pair and
 * its poster flag onto the Video node. A replace rewrites the asset and cannot
 * rewrite the nodes. The published page lays the asset's current records over
 * the node when it is composed (AGL-2807); a canvas drawing the node's props
 * alone would show the replaced film's shape and poster instead.
 *
 * The designer does not read Firestore — it renders inside a plugin sandbox,
 * and the documents are the host app's to know, which is the same reason
 * `MediaPickerContext` carries the approved image hosts. So the host app
 * supplies a source, the canvas holds the films it is drawing, and
 * `useVideoAssetFactsOverlay` lays each answer over the render copy through
 * `applyVideoAssetFacts`, the published page's own rule.
 *
 * ABSENT when no host app answers for films: every film then renders from its
 * stored props.
 */
export interface VideoAssetFactsSource {
  /**
   * The facts filed under `videoAssetFactsKey`, or `undefined` while nothing
   * has answered for that film. Pending, refused, deleted and failed are all
   * `undefined`, because each of them renders the node's stored props.
   */
  get(key: string): VideoAssetFacts | undefined
  /**
   * Keeps the film's document read while the caller holds it, and returns the
   * release. Holds are counted, so two placements of one film share a read and
   * the read ends with the last of them.
   */
  retain(ref: MediaRef): () => void
  /** Called after any film's answer changes. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void
  /** Moves on every change, so a subscriber can tell a new answer apart. */
  getVersion(): number
}

/** The source, plus the two ends the host app drives it from. */
export interface VideoAssetFactsStore extends VideoAssetFactsSource {
  /** Files a film's answer; `undefined` withdraws it. */
  set(key: string, facts: VideoAssetFacts | undefined): void
  /**
   * The films something currently holds, one per key. The array is replaced
   * only when that set changes, which is the stable snapshot
   * `useSyncExternalStore` needs to render one reader per film.
   */
  getRetained(): readonly MediaRef[]
  /** Called after the held set changes. Returns the unsubscribe. */
  subscribeRetained(listener: () => void): () => void
}

/** An in-memory store. How each film is read is the host app's business. */
export function createVideoAssetFactsStore(): VideoAssetFactsStore {
  const answers = new Map<string, VideoAssetFacts>()
  const holds = new Map<string, { ref: MediaRef; count: number }>()
  const listeners = new Set<() => void>()
  const retainedListeners = new Set<() => void>()
  let version = 0
  let retained: readonly MediaRef[] = []
  const notify = (targets: Set<() => void>) => {
    for (const listener of [...targets]) listener()
  }
  const publishRetained = () => {
    retained = [...holds.values()].map((hold) => hold.ref)
    notify(retainedListeners)
  }
  return {
    get: (key) => answers.get(key),
    getVersion: () => version,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    retain: (ref) => {
      const key = videoAssetFactsKey(ref)
      const hold = holds.get(key)
      if (hold) {
        hold.count += 1
      } else {
        holds.set(key, { ref, count: 1 })
        publishRetained()
      }
      let released = false
      return () => {
        if (released) return
        released = true
        const current = holds.get(key)
        if (!current) return
        current.count -= 1
        if (current.count > 0) return
        holds.delete(key)
        publishRetained()
      }
    },
    set: (key, facts) => {
      if (facts) answers.set(key, facts)
      else if (!answers.delete(key)) return
      version += 1
      notify(listeners)
    },
    getRetained: () => retained,
    subscribeRetained: (listener) => {
      retainedListeners.add(listener)
      return () => {
        retainedListeners.delete(listener)
      }
    },
  }
}

export const VideoAssetFactsContext = createContext<
  VideoAssetFactsSource | undefined
>(undefined)
VideoAssetFactsContext.displayName = 'VideoAssetFactsContext'

export default VideoAssetFactsContext
