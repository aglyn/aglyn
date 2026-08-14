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

import * as Aglyn from '@aglyn/aglyn'
import type { MarkdownFieldHandle } from '@aglyn/aglyn-markdown-editor'
import { useCallback, useContext, useMemo, useRef } from 'react'
import { MediaPickerContext } from '../contexts/media-picker-context'

export interface MarkdownMediaPicker {
  /** Pass to `MarkdownField`'s `editorRef`. */
  editorRef: (handle: MarkdownFieldHandle | null) => void
  /**
   * Pass to `MarkdownField`'s `onPickImageFromMedia`. `undefined` when the
   * host supplies no picker, which is what makes the editor keep offering its
   * own URL prompt instead of a dead "Choose from media" button — the email
   * besigner has no media scope and mounts no provider.
   */
  onPickImageFromMedia?: (alt: string) => void
}

/**
 * Wires a `MarkdownField` on a besigner surface to the host's media library
 * (AGL-1645).
 *
 * Both besigner surfaces — the attributes panel and the in-place canvas editor
 * — took the editor complete except for this callback, so the toolbar's image
 * action opened a "paste a URL" prompt while every other image attribute in the
 * designer opened the DAM. Same context, same picker, same pipeline the
 * Attributes panel's Browse button and AGL-1304's instance `src` edit already
 * use; nothing new is invented here.
 *
 * ## The picked value is stored VERBATIM
 *
 * Which is what every other besigner surface does, and it took AGL-1686 to get
 * back to it.
 *
 * `onPickMedia` hands back what an attribute should store: a
 * `media:{scope}/{mediaId}` reference for library assets (AGL-1215). The first
 * pass resolved that to a `/api/media/cdn/…` path HERE, at insert time,
 * because no markdown-lite renderer called `resolveMediaSrc` and a reference in
 * a document would have rendered nothing. All five now resolve, so the reason
 * is gone — and keeping the workaround anyway would not be belt-and-braces, it
 * would be a downgrade:
 *
 * * **It bakes the route into the content.** A CDN path in a document couples
 *   every screen, layout, component and template on every host to a delivery
 *   detail that has already changed once (AGL-829). That coupling is the whole
 *   thing the reference exists to remove.
 * * **It is lossy in a way the renderer cannot undo.** Resolving early freezes
 *   the picker's best-guess host qualification. `hostQualifiedScope` re-points
 *   a reference at whichever site is actually rendering, which is what lets ONE
 *   image in a reusable component or a shared layout work on every site that
 *   uses it. A resolved path can only ever name one of them.
 *
 * The reference reaches the document unchanged, and `parseMarkdownLite` now
 * accepts it — the other half of AGL-1686, without which the editor would
 * insert a row that the next parse silently deleted.
 *
 * ## Focus
 *
 * The picker is a modal dialog and it steals focus, which is the class of
 * interaction that breaks a blur-committed editor. Neither surface commits on
 * blur — the panel is on react-final-form's debounce, the canvas on
 * `useDebouncedCommit` — and the dialog is portaled outside both editors'
 * React subtrees, so its Escape never reaches the canvas editor's own
 * close-on-Escape. The insert itself arrives through the imperative handle
 * rather than through focus, so it does not care where the caret went; the
 * editor falls back to appending when its last selection is gone.
 */
export function useMarkdownMediaPicker(): MarkdownMediaPicker {
  const { onPickMedia } = useContext(MediaPickerContext)
  const handleRef = useRef<MarkdownFieldHandle | null>(null)

  const editorRef = useCallback((handle: MarkdownFieldHandle | null) => {
    handleRef.current = handle
  }, [])

  const onPickImageFromMedia = useMemo(() => {
    if (!onPickMedia) return undefined
    return (alt: string) => {
      onPickMedia((stored) => {
        // Gated on what the PARSER keeps, not on what resolves: a value the
        // editor accepts and the parser drops is an image that disappears on
        // the next load with nothing logged, which is exactly how AGL-1645
        // shipped broken. `insertImage` re-checks with the same predicate, so
        // this is the early, reportable refusal rather than the guard.
        if (!stored || !Aglyn.isSupportedImageSrc(stored)) return
        handleRef.current?.insertImage(alt, stored)
      })
    }
  }, [onPickMedia])

  return { editorRef, onPickImageFromMedia }
}

export default useMarkdownMediaPicker
