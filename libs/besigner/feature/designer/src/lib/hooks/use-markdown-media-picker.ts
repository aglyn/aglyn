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
 * ## Why the picked value is RESOLVED rather than stored verbatim
 *
 * This is the one place a besigner surface must NOT write the picker's value
 * through untouched, which is what everything else does.
 *
 * `onPickMedia` hands back what an *attribute* should store: a
 * `media:{scope}/{mediaId}` reference for library assets (AGL-1215), resolved
 * at render time by whichever component reads it. A markdown document has no
 * such reader. Its `![alt](src)` goes to five renderers and not one of them
 * calls `resolveMediaSrc` — `libs/plugins/mui/src/lib/components/markdown.tsx`
 * passes `block.src` straight to an `<img>` — so a reference dropped into a
 * document is a permanently broken image on the published page. The console's
 * blog editor reached the same conclusion from the other side and keeps the raw
 * URL for body images while the cover takes a reference.
 *
 * So the reference is resolved HERE, at insert time, to the CDN path it names.
 * That is strictly better than the raw storage URL the blog editor stores: the
 * CDN path is keyed by media id, so it survives the folder move that made
 * AGL-1215 a permanent 404, and it survives a replace. What it does not survive
 * is re-routing `/api/media/cdn/…`, which is the cost of markdown renderers
 * resolving nothing — a renderer-side fix, filed separately, and deliberately
 * not made here where it would touch all five.
 *
 * No `hostId` is passed, for the same reason `resolveMediaSrc` documents: the
 * besigner canvas has no site context, and the picker has already baked its
 * best guess into the reference's scope.
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
        const src = Aglyn.resolveMediaSrc(stored)
        // A reference that does not parse resolves to undefined rather than
        // reaching an `<img src>`; inserting nothing is better than inserting
        // a row the author then has to find and delete.
        if (!src) return
        handleRef.current?.insertImage(alt, src)
      })
    }
  }, [onPickMedia])

  return { editorRef, onPickImageFromMedia }
}

export default useMarkdownMediaPicker
