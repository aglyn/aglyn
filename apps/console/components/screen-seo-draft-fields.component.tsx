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

import { SCREEN_SEO_TEXT_GUIDANCE } from '@aglyn/aglyn/app-utils/screen-seo-fields'
import { Button, TextField } from '@mui/material'
import { memo, useSyncExternalStore } from 'react'
import type { ScreenSeoEdits, ScreenSocialImageDraft } from '../constants/screen-seo'
import ScreenSocialImageField from './screen-social-image-field.component'

/**
 * The staged SEO edits of one open screen: `null` means untouched, so the
 * field shows what the document holds.
 */
export interface ScreenSeoDraft {
  title: string | null
  description: string | null
  image: ScreenSocialImageDraft | null
}

const UNTOUCHED: ScreenSeoDraft = { title: null, description: null, image: null }

/**
 * Where the Besigner keeps the staged SEO edits, outside React state.
 *
 * They used to be three `useState`s on the Besigner page, so every letter
 * typed into Search title or Search description redrew the whole editor:
 * canvas, panels, toolbars. Keystrokes that arrive faster than that redraw
 * finishes queue up and are processed back to back, and React counts each
 * of those commits as nested until it throws #185, "Maximum update depth
 * exceeded", and drops the letter. A burst of about a hundred characters
 * did exactly that in production on 2026-11-06 (the saved description read
 * "set up fr your store").
 *
 * The store is read when it is needed (the save, a plugin staging a field)
 * and subscribed to only by `ScreenSeoDraftFields`, so a keystroke redraws
 * the fields and nothing above them. A typed draft still survives closing
 * and reopening Screen Properties, as it did when the page held it.
 */
export interface ScreenSeoDraftStore {
  get(): ScreenSeoDraft
  set<K extends keyof ScreenSeoDraft>(field: K, value: ScreenSeoDraft[K]): void
  reset(): void
  subscribe(listener: () => void): () => void
}

export function createScreenSeoDraftStore(): ScreenSeoDraftStore {
  let draft = UNTOUCHED
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const listener of listeners) listener()
  }
  return {
    get: () => draft,
    set(field, value) {
      if (draft[field] === value) return
      draft = { ...draft, [field]: value }
      emit()
    },
    reset() {
      if (draft === UNTOUCHED) return
      draft = UNTOUCHED
      emit()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** The staged draft as `buildScreenSeoUpdate` takes it. */
export function screenSeoDraftEdits(draft: ScreenSeoDraft): ScreenSeoEdits {
  return { title: draft.title, description: draft.description, image: draft.image }
}

export interface ScreenSeoDraftFieldsProps {
  store: ScreenSeoDraftStore
  /** Media-library scope for the social image. */
  hostId: string
  /** What the screen document holds at `seo`. */
  saved?: {
    title?: string | null
    description?: string | null
    image?: string | null
    imageAlt?: string | null
    imageWidth?: number | null
    imageHeight?: number | null
  } | null
  /** Writes the staged draft. Keep its identity stable across keystrokes. */
  onSave: () => void
}

/**
 * Search title, Search description, the social image and Save SEO, for the
 * Besigner's Screen Properties. Memoized, and fed only props that do not
 * change while typing, so a keystroke redraws these fields alone.
 */
export const ScreenSeoDraftFields = memo(function ScreenSeoDraftFields({
  store,
  hostId,
  saved,
  onSave,
}: ScreenSeoDraftFieldsProps) {
  const draft = useSyncExternalStore(store.subscribe, store.get, store.get)
  return (
    <>
      <TextField
        size="small"
        label="Search title"
        value={draft.title ?? saved?.title ?? ''}
        onChange={(e) => store.set('title', e.target.value)}
        helperText={`The whole tab/search title, published verbatim (≤${SCREEN_SEO_TEXT_GUIDANCE.title} chars works best)`}
      />
      <TextField
        size="small"
        label="Search description"
        multiline
        minRows={2}
        value={draft.description ?? saved?.description ?? ''}
        onChange={(e) => store.set('description', e.target.value)}
        helperText={`Search snippet / social share text (≤${SCREEN_SEO_TEXT_GUIDANCE.description} chars works best)`}
      />
      {/* Social image (AGL-1337), shared with the screen detail page's SEO
          card so the two surfaces cannot drift (AGL-1368). */}
      <ScreenSocialImageField
        hostId={hostId}
        saved={saved?.image}
        // See the twin on the screen detail page (AGL-2417).
        savedAlt={saved?.imageAlt}
        savedWidth={saved?.imageWidth}
        savedHeight={saved?.imageHeight}
        value={draft.image}
        onChange={(image) => store.set('image', image)}
      />
      <Button
        size="small"
        variant="outlined"
        onClick={onSave}
        disabled={draft.title == null && draft.description == null && draft.image == null}
        sx={{ alignSelf: 'flex-start' }}
      >
        {'Save SEO'}
      </Button>
    </>
  )
})

export default ScreenSeoDraftFields
