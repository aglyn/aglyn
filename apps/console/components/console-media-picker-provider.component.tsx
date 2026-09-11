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
  formatMediaRef,
  MediaPickerContext,
  mediaRefFromCdnPath,
  parseMediaRef,
  type PickedMedia,
  type PickMediaOptions,
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
  // Per open, not per mount: one page can hold a picker for page content and
  // one for a product's paid media, and only the second may return a private
  // asset.
  const [allowPrivate, setAllowPrivate] = useState(false)
  const resolver = useRef<((media: PickedMedia | null) => void) | null>(null)

  const settle = useCallback((media: PickedMedia | null) => {
    resolver.current?.(media)
    resolver.current = null
    setOpen(false)
  }, [])

  const pickMedia = useCallback(
    (options?: PickMediaOptions) =>
      new Promise<PickedMedia | null>((resolve) => {
        // A second open before the first settled cancels the first.
        resolver.current?.(null)
        resolver.current = resolve
        setAllowPrivate(options?.allowPrivate === true)
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
        allowPrivate={allowPrivate}
        onClose={() => settle(null)}
        onPick={(media, context) => {
          const picked = media as {
            $id?: string
            url?: string
            cdnPath?: string
            fileName?: string
            contentType?: string
            alt?: string
            private?: boolean
          }
          // The scope the id resolves under. Read off `cdnPath` when there is
          // one, so a host-qualified pick keeps its qualification, and off the
          // library it was chosen from when there is not: a free-tier asset
          // and a private one carry no `cdnPath` at all.
          const mediaScope =
            parseMediaRef(mediaRefFromCdnPath(picked.cdnPath))?.scope ??
            context?.cdnScope
          const isPrivate = picked.private === true
          // Same precedence as the besigner picker (AGL-1215): the stable
          // media-id-keyed CDN path first, the raw storage URL only when
          // there is no CDN path (free tier, legacy uploads). A private asset
          // has neither, and its reference is the one handle a caller that
          // signs its own links can store (AGL-2814).
          const src = isPrivate
            ? formatMediaRef(mediaScope, picked.$id)
            : picked.cdnPath || picked.url
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
                  mediaScope,
                  ...(isPrivate ? { private: true } : {}),
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
