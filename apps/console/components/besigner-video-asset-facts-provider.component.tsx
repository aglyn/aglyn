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
'use client'

import type { MediaRef } from '@aglyn/aglyn'
// By path: the overlay rules stay out of every `@aglyn/aglyn` barrel.
import {
  type VideoAssetDocument,
  videoAssetDocumentPath,
  videoAssetFactsFromDocument,
  videoAssetFactsKey,
} from '@aglyn/aglyn/app-utils/video-asset-facts'
// Deep, not the designer barrel, so a surface that renders no besigner can
// mount this without loading one.
import {
  createVideoAssetFactsStore,
  VideoAssetFactsContext,
  type VideoAssetFactsStore,
} from '@aglyn/besigner-ui/contexts/video-asset-facts-context'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { doc } from 'firebase/firestore'
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import useFirestoreDoc from '../hooks/use-firestore-doc'

export interface BesignerVideoAssetFactsProviderProps {
  /** The site whose pages the canvas edits. */
  hostId: string
  children?: JSX.Children
}

/**
 * Answers the canvas's films from their DAM documents (AGL-2838).
 *
 * The published page lays each placed film's current `video` and `poster`
 * records over its node when it is composed (AGL-2807), so a replace reaches
 * the page without a republish. The canvas renders the designer's own nodes,
 * which still hold what the pick copied. This reads the same documents in the
 * browser — one live listener per film the canvas is drawing — and files what
 * each one answers where `useVideoAssetFactsOverlay` looks for it.
 *
 * The decision is the page's rather than a second one:
 * `videoAssetFactsFromDocument` is the function the composition's reader
 * calls, asked about `hostId`, the site this canvas belongs to. A film the page
 * keeps at its stored props — its document missing, deleted, private, or not
 * shared with this site — gets no answer here either, and neither does a read
 * that is pending or has failed.
 *
 * Live rather than one-shot, because a replace is the write this exists for:
 * with the canvas open, an author sees the new film's shape as the replace
 * lands, and nothing is written to the draft.
 */
export function BesignerVideoAssetFactsProvider(
  props: BesignerVideoAssetFactsProviderProps,
) {
  const { hostId, children } = props
  const store = useMemo(() => createVideoAssetFactsStore(), [])
  const films = useSyncExternalStore(
    store.subscribeRetained,
    store.getRetained,
    store.getRetained,
  )
  return (
    <VideoAssetFactsContext.Provider value={store}>
      {children}
      {films.map((film) => (
        <VideoAssetFactsReader
          key={videoAssetFactsKey(film)}
          film={film}
          hostId={hostId}
          store={store}
        />
      ))}
    </VideoAssetFactsContext.Provider>
  )
}
BesignerVideoAssetFactsProvider.displayName = 'BesignerVideoAssetFactsProvider'

/** One film's document, read live and filed under its key. Renders nothing. */
function VideoAssetFactsReader(props: {
  film: MediaRef
  hostId: string
  store: VideoAssetFactsStore
}) {
  const { film, hostId, store } = props
  const firestore = useFirestore()
  const key = videoAssetFactsKey(film)
  const path = videoAssetDocumentPath(film)
  const { data, status } = useFirestoreDoc<VideoAssetDocument>(
    () => (path ? doc(firestore, path) : null),
    [firestore, path],
  )
  useEffect(() => {
    store.set(
      key,
      status === 'success'
        ? videoAssetFactsFromDocument(data, film, hostId)
        : undefined,
    )
  }, [store, key, status, data, film, hostId])
  // Withdrawn with the reader, so a film nothing draws any more stops
  // answering instead of answering from a listener that has closed.
  useEffect(() => () => store.set(key, undefined), [store, key])
  return null
}

export default BesignerVideoAssetFactsProvider
