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

import { createContext } from 'react'

/**
 * Host-app-provided media browser (AGL-106): elements with a `src`
 * attribute get a "Browse media" action in the Attributes panel when the
 * host supplies this callback (the console opens its media-picker dialog);
 * the designer stays storage-agnostic and hides the control otherwise.
 */
export interface MediaPickerContextValue {
  /**
   * `onPick` receives the value the attribute should STORE, which is not
   * necessarily a URL: the console hands back a `media:{scope}/{mediaId}`
   * reference for library assets (AGL-1215) and a raw URL only for assets
   * that have no CDN path. The designer writes it through verbatim — what
   * the persisted form means is the host app's and the renderer's business,
   * which is the same reason this context exists at all.
   *
   * `asset` carries the chosen asset's own authored metadata (AGL-1896) so a
   * surface can DEFAULT a companion attribute from it — `alt`, which the DAM
   * has stored since AGL-173 and which nothing ever read back, and the pixel
   * `width`/`height` captured at upload. Structural and optional on purpose:
   * the designer stays storage-agnostic, a host that supplies no metadata is
   * unchanged, and this stays one extra argument rather than a second picker
   * mechanism. Use `Aglyn.inheritedMediaAlt` to decide what to do with the
   * alt — never inline the rule, or the override precedence drifts per
   * surface.
   *
   * The dimensions are copied at PICK TIME because no tenant render path ever
   * reads a media document (AGL-2486). Resolving them while rendering would
   * put a per-image Firestore read on the hottest cached path; carrying them
   * on the node costs two numbers and is read like any other prop. They are
   * best-effort at upload, so either may be absent.
   */
  onPickMedia?: (
    onPick: (
      value: string,
      asset?: { alt?: string; width?: number; height?: number },
    ) => void,
  ) => void
  /**
   * External image hosts this site's owner has approved (AGL-1152).
   *
   * Carried here rather than fetched by the field, because the designer must
   * not read Firestore: it renders inside a plugin sandbox and the host doc is
   * the console's to know. The provider that already takes `hostId` supplies
   * it.
   *
   * ABSENT means "not known", NOT "nothing approved" — a field that cannot see
   * the list must warn about nothing rather than warn about everything. The
   * warning exists to tell an author something true before they publish; one
   * that fires on every external URL because the list failed to load teaches
   * them to ignore it, which is worse than silence.
   */
  approvedImageHosts?: readonly string[]
}

export const MediaPickerContext = createContext<MediaPickerContextValue>({})
MediaPickerContext.displayName = 'MediaPickerContext'

export default MediaPickerContext
