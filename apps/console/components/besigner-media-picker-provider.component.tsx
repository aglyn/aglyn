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

import { mediaNodeSrc } from '@aglyn/aglyn'
import { MediaPickerContext } from '@aglyn/besigner-ui'
import { useCallback, useMemo, useRef, useState } from 'react'
import { doc } from 'firebase/firestore'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import useFirestoreDoc from '../hooks/use-firestore-doc'
import MediaPickerDialog from './media/media-picker-dialog.component'

export interface BesignerMediaPickerProviderProps {
  hostId: string
  children?: JSX.Children
}

/**
 * Feeds the designer's "Browse media" action (AGL-106): opens the console's
 * media-picker dialog and hands the chosen asset back to the requesting
 * attribute panel as the value that attribute should STORE — a media
 * reference for library assets (AGL-1215), a raw URL for everything else.
 */
export function BesignerMediaPickerProvider(
  props: BesignerMediaPickerProviderProps,
) {
  const { hostId, children } = props
  const firestore = useFirestore()
  const [open, setOpen] = useState(false)
  // Restates `MediaPickerContextValue['onPickMedia']` from the designer
  // rather than importing it: this provider is the console's side of that
  // contract, and the two must widen together — a metadata field the designer
  // accepts but this never sends is a copy that silently does not happen.
  type PickedAsset = { alt?: string; width?: number; height?: number }
  const pendingPick = useRef<
    ((value: string, asset?: PickedAsset) => void) | null
  >(null)

  const onPickMedia = useCallback(
    (onPick: (value: string, asset?: PickedAsset) => void) => {
      pendingPick.current = onPick
      setOpen(true)
    },
    [],
  )
  // The site's approved image hosts (AGL-1152), so the attribute panel can
  // warn an author that a pasted URL will be refused on the published page.
  // Read here because this provider already knows the host and the designer
  // must not read Firestore itself.
  const { data: host } = useFirestoreDoc<{ approvedImageHosts?: string[] }>(
    () => doc(firestore, 'hosts', hostId),
    [firestore, hostId],
    { idField: '$id' },
  )
  // `undefined` while the read is in flight, which the context reads as "not
  // known" and warns about nothing — never as "nothing approved".
  const approvedImageHosts = host?.approvedImageHosts
  const value = useMemo(
    () => ({ onPickMedia, approvedImageHosts }),
    [onPickMedia, approvedImageHosts],
  )

  return (
    <MediaPickerContext.Provider value={value}>
      {children}
      <MediaPickerDialog
        hostId={hostId}
        open={open}
        onClose={() => setOpen(false)}
        onPick={(media) => {
          // Store a REFERENCE to the asset, not a URL for it (AGL-1215).
          //
          // The first pass got the first half right: the raw `url` is a
          // firebasestorage download URL naming the object's CURRENT
          // location, so a folder move — a physical copy plus a rewrite plus
          // a DELETE — turned every node holding it into a permanent 404,
          // and `cdnPath` is keyed by media id so it survives moves and
          // replaces. But `cdnPath` is still a URL for OUR route, and a
          // document that spells out `/api/media/cdn/…` cannot be re-routed
          // without migrating every screen, layout, component and template
          // on every host. `mediaNodeSrc` turns it into `media:{scope}/{id}`
          // and the renderer rebuilds the URL.
          //
          // The dialog has already host-qualified `cdnPath` for org assets
          // restricted to specific sites; that qualification is carried into
          // the reference's scope so the besigner canvas — which has no site
          // context to re-derive it from — can still fetch the asset.
          //
          // Falls back to the raw `url` when there is no `cdnPath`: that is
          // a free-tier org (CDN delivery is the paid `mediaCdn`
          // entitlement) or a legacy upload, and minting a reference for one
          // would hand it paid delivery, since the CDN handler checks the
          // entitlement nowhere.
          const src = mediaNodeSrc(media)
          // The asset's own alt rides along (AGL-1896) so the requesting
          // surface can default a blank alt attribute from it. Handed over
          // raw — `inheritedMediaAlt` at the call site owns the precedence,
          // because only the call site can see the placement's current alt
          // and its `decorative` switch.
          // The pixel dimensions ride along too (AGL-2486), for the same
          // reason and by the same route: the tenant renderer never reads a
          // media document, so the only way an `<img>` can carry intrinsic
          // `width`/`height` — and reserve its box before the bytes land — is
          // for the pick to copy them onto the node. Handed over raw; the
          // call site decides which prop names they land under, because only
          // it knows what the element declares.
          if (src)
            pendingPick.current?.(src, {
              alt: media.alt,
              width: media.width,
              height: media.height,
            })
          pendingPick.current = null
          setOpen(false)
        }}
      />
    </MediaPickerContext.Provider>
  )
}
BesignerMediaPickerProvider.displayName = 'BesignerMediaPickerProvider'

export default BesignerMediaPickerProvider
