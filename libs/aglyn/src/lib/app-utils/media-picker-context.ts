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
// Same placement rationale as entity-picker-context.ts: lives in
// @aglyn/aglyn without a 'use client' banner so both the console app and
// relocated feature plugins share one context module.
import { createContext, useContext } from 'react'

export interface PickedMedia {
  /**
   * The chosen asset's URL — use for image `src` props.
   *
   * Already resolved by the provider, which prefers the media-id-keyed CDN
   * path over the raw storage download URL (AGL-1215): the raw form names
   * the object's current location and dies on a folder move.
   */
  url: string
  /** Original file name, when the source exposes it (e.g. digital files). */
  fileName?: string
  /** MIME type, when known. */
  contentType?: string
  /**
   * The asset's own alt text, as authored in the media library (AGL-1896).
   *
   * Carried so a placement can DEFAULT from the asset instead of asking the
   * author to retype it — the same logo on eight pages had its alt typed
   * eight times, and in practice shipped blank on published customer sites.
   * Absent for every asset whose alt has never been filled in; there is no
   * fallback to {@link fileName}, deliberately. A file name is not a
   * description, and "IMG_4021.jpg" read aloud by a screen reader is worse
   * than the silence it replaces.
   *
   * Consumers must not read this directly into a stored field. Pass it to
   * `inheritedMediaAlt` with whatever the placement already holds, so the
   * per-placement override keeps winning.
   */
  alt?: string
}

/**
 * Lets a relocated plugin console page open the console's media browser
 * without importing it. The console app provides `pickMedia` (it owns the
 * media library, which is coupled to the org/session context); plugin
 * components call it and receive the chosen asset — or `null` if cancelled.
 * Absent (undefined `pickMedia`) when no provider is mounted, so callers
 * fall back to a plain URL input.
 */
export interface MediaPickerContextValue {
  pickMedia?: () => Promise<PickedMedia | null>
}

export const MediaPickerContext = createContext<MediaPickerContextValue>({})
MediaPickerContext.displayName = 'MediaPickerContext'

/** Hook form of {@link MediaPickerContext}. */
export function useMediaPicker(): MediaPickerContextValue {
  return useContext(MediaPickerContext)
}
