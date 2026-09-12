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
  type MediaAssetDocument,
  mediaAssetDocumentPath,
  mediaAssetFactsFromDocument,
  mediaAssetFactsKey,
} from '@aglyn/aglyn/app-utils/media-asset-facts'
// Deep, not the designer barrel, so a surface that renders no besigner can
// mount this without loading one.
import {
  createMediaAssetFactsStore,
  MediaAssetFactsContext,
  type MediaAssetFactsStore,
} from '@aglyn/besigner-ui/contexts/media-asset-facts-context'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { doc } from 'firebase/firestore'
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import useFirestoreDoc from '../hooks/use-firestore-doc'

export interface BesignerMediaAssetFactsProviderProps {
  /** The site whose pages the canvas edits. */
  hostId: string
  children?: JSX.Children
}

/**
 * Answers the canvas's placed images and films from their DAM documents
 * (AGL-2838, AGL-2856).
 *
 * The published page lays each placed asset's current records over its node
 * when it is composed: a film's `video` and `poster` (AGL-2807), an image's
 * `width` and `height` (AGL-2833). So a replace reaches the page without a
 * republish. The canvas renders the designer's own nodes, which still hold
 * what the pick copied. This reads the same documents in the browser — one
 * live listener per asset the canvas is drawing — and files what each one
 * answers where `useMediaAssetFactsOverlay` looks for it.
 *
 * The decision is the page's rather than a second one:
 * `mediaAssetFactsFromDocument` is the function the composition's reader
 * calls, asked about `hostId`, the site this canvas belongs to. An asset the
 * page keeps at its stored props — its document missing, deleted, private, or
 * not shared with this site — gets no answer here either, and neither does a
 * read that is pending or has failed.
 *
 * Live rather than one-shot, because a replace is the write this exists for:
 * with the canvas open, an author sees the new file's shape as the replace
 * lands, and nothing is written to the draft.
 */
export function BesignerMediaAssetFactsProvider(
  props: BesignerMediaAssetFactsProviderProps,
) {
  const { hostId, children } = props
  const store = useMemo(() => createMediaAssetFactsStore(), [])
  const assets = useSyncExternalStore(
    store.subscribeRetained,
    store.getRetained,
    store.getRetained,
  )
  return (
    <MediaAssetFactsContext.Provider value={store}>
      {children}
      {assets.map((asset) => (
        <MediaAssetFactsReader
          key={mediaAssetFactsKey(asset)}
          asset={asset}
          hostId={hostId}
          store={store}
        />
      ))}
    </MediaAssetFactsContext.Provider>
  )
}
BesignerMediaAssetFactsProvider.displayName = 'BesignerMediaAssetFactsProvider'

/** One asset's document, read live and filed under its key. Renders nothing. */
function MediaAssetFactsReader(props: {
  asset: MediaRef
  hostId: string
  store: MediaAssetFactsStore
}) {
  const { asset, hostId, store } = props
  const firestore = useFirestore()
  const key = mediaAssetFactsKey(asset)
  const path = mediaAssetDocumentPath(asset)
  const { data, status } = useFirestoreDoc<MediaAssetDocument>(
    () => (path ? doc(firestore, path) : null),
    [firestore, path],
  )
  useEffect(() => {
    store.set(
      key,
      status === 'success'
        ? mediaAssetFactsFromDocument(data, asset, hostId)
        : undefined,
    )
  }, [store, key, status, data, asset, hostId])
  // Withdrawn with the reader, so an asset nothing draws any more stops
  // answering instead of answering from a listener that has closed.
  useEffect(() => () => store.set(key, undefined), [store, key])
  return null
}

export default BesignerMediaAssetFactsProvider
