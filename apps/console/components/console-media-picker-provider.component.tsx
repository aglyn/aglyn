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

import {
  MediaPickerContext,
  mediaRefFromCdnPath,
  parseMediaRef,
  type PickedMedia,
} from '@aglyn/aglyn'
import { useCallback, useMemo, useRef, useState } from 'react'
import MediaPickerDialog from './media/media-picker-dialog.component'

export interface ConsoleMediaPickerProviderProps {
  /**
   * The site whose private library is offered, when there is one.
   *
   * Optional since AGL-2662: the organization-level CRM mounts this with no
   * site, where only the shared library exists — a surface about every site
   * must not offer one site's private assets.
   */
  hostId?: string
  /** The organization whose shared library is offered. */
  orgId?: string
  children?: JSX.Children
}

/**
 * Console-side implementation of the plugin-facing {@link MediaPickerContext}
 * (AGL-395). Mounted by the shell around plugin console pages so a relocated
 * plugin component (e.g. the commerce product editor) can open the console
 * media browser — which is coupled to the org/session context and so cannot
 * live in a plugin lib — and receive the chosen asset via a promise.
 */
export function ConsoleMediaPickerProvider(
  props: ConsoleMediaPickerProviderProps,
) {
  const { hostId, orgId, children } = props
  const [open, setOpen] = useState(false)
  const resolver = useRef<((media: PickedMedia | null) => void) | null>(null)

  const settle = useCallback((media: PickedMedia | null) => {
    resolver.current?.(media)
    resolver.current = null
    setOpen(false)
  }, [])

  const pickMedia = useCallback(
    () =>
      new Promise<PickedMedia | null>((resolve) => {
        // A second open before the first settled cancels the first.
        resolver.current?.(null)
        resolver.current = resolve
        setOpen(true)
      }),
    [],
  )

  const value = useMemo(() => ({ pickMedia }), [pickMedia])

  return (
    <MediaPickerContext.Provider value={value}>
      {children}
      <MediaPickerDialog
        hostId={hostId}
        orgId={orgId}
        open={open}
        onClose={() => settle(null)}
        onPick={(media) => {
          const picked = media as {
            $id?: string
            url?: string
            cdnPath?: string
            fileName?: string
            contentType?: string
            alt?: string
          }
          // Same precedence as the besigner picker (AGL-1215): the stable
          // media-id-keyed CDN path first, the raw storage URL only when
          // there is no CDN path (free tier, legacy uploads).
          const src = picked.cdnPath || picked.url
          settle(
            src
              ? {
                  url: src,
                  fileName: picked.fileName,
                  contentType: picked.contentType,
                  // The asset's authored alt (AGL-1896) — a plugin console
                  // page can default a blank alt field from it rather than
                  // making the author retype it per placement. Passed
                  // through raw; `inheritedMediaAlt` at the call site is
                  // what decides whether it may win.
                  alt: picked.alt,
                  // The document id and the scope it resolves under, for a
                  // caller that stores a REFERENCE rather than a placement
                  // (AGL-2662) — the CRM's record attachments.
                  mediaId: picked.$id,
                  mediaScope: parseMediaRef(mediaRefFromCdnPath(picked.cdnPath))?.scope,
                }
              : null,
          )
        }}
      />
    </MediaPickerContext.Provider>
  )
}
ConsoleMediaPickerProvider.displayName = 'ConsoleMediaPickerProvider'

export default ConsoleMediaPickerProvider
