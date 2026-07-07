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
  onPickMedia?: (onPick: (url: string) => void) => void
}

export const MediaPickerContext = createContext<MediaPickerContextValue>({})
MediaPickerContext.displayName = 'MediaPickerContext'

export default MediaPickerContext
