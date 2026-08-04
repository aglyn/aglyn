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
  const [open, setOpen] = useState(false)
  const pendingPick = useRef<((value: string) => void) | null>(null)

  const onPickMedia = useCallback((onPick: (value: string) => void) => {
    pendingPick.current = onPick
    setOpen(true)
  }, [])
  const value = useMemo(() => ({ onPickMedia }), [onPickMedia])

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
          if (src) pendingPick.current?.(src)
          pendingPick.current = null
          setOpen(false)
        }}
      />
    </MediaPickerContext.Provider>
  )
}
BesignerMediaPickerProvider.displayName = 'BesignerMediaPickerProvider'

export default BesignerMediaPickerProvider
