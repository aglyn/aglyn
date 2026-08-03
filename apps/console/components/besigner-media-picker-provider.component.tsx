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

import { MediaPickerContext } from '@aglyn/besigner-ui'
import { useCallback, useMemo, useRef, useState } from 'react'
import MediaPickerDialog from './media/media-picker-dialog.component'

export interface BesignerMediaPickerProviderProps {
  hostId: string
  children?: JSX.Children
}

/**
 * Feeds the designer's "Browse media" action (AGL-106): opens the console's
 * media-picker dialog and hands the chosen asset URL back to the requesting
 * attribute panel.
 */
export function BesignerMediaPickerProvider(
  props: BesignerMediaPickerProviderProps,
) {
  const { hostId, children } = props
  const [open, setOpen] = useState(false)
  const pendingPick = useRef<((url: string) => void) | null>(null)

  const onPickMedia = useCallback((onPick: (url: string) => void) => {
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
          // Prefer the stable, mediaId-keyed CDN path (AGL-1215). The raw
          // `url` is a firebasestorage download URL that names the object's
          // CURRENT location, so a folder move — which physically copies the
          // object, rewrites `url` and DELETES the original — turns every
          // node holding it into a permanent 404. `cdnPath` survives moves
          // and replaces, and it is the only form the image element can
          // build a responsive srcSet from, so picking the raw URL also
          // silently cost every picked image its WebP variants.
          //
          // The dialog has already host-qualified `cdnPath` for org assets
          // restricted to specific sites, so take it verbatim. Relative on
          // purpose: the CDN route is mounted in the console AND the tenant
          // app, so one path resolves in the editor canvas and on the
          // published site. `url` remains the fallback for free-tier orgs
          // (cdnPath is a paid `mediaCdn` entitlement) and legacy uploads.
          const src = media.cdnPath || media.url
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
