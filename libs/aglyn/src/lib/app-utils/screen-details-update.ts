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

import { artifactRenameListKeys } from './artifact-list-keys'

/*
 * A PAGE'S NAME AND DESCRIPTION, AS SAVED (AGL-4235).
 *
 * The page details card in the console (`handleEditSave`) and the public
 * API's page update write the same fields for the same edit, from here: the
 * trimmed name with the list keys that find the page under it (AGL-835,
 * AGL-3321), and the trimmed description. The caller stamps `updatedAt`
 * with its own clock.
 */

/** The activity row the details card writes for this save. */
export const SCREEN_DETAILS_ACTIVITY = 'Updated screen details'

/** The edit: a member left out is not written. */
export interface ScreenDetailsEdits {
  displayName?: string
  description?: string | null
}

/**
 * The fields a page's details save writes. A name that trims to nothing is
 * not a name, and answers `null`: the card refuses to save one.
 */
export function buildScreenDetailsUpdate(edits: ScreenDetailsEdits): Record<string, unknown> | null {
  const fields: Record<string, unknown> = {}
  if (edits.displayName !== undefined) {
    const displayName = String(edits.displayName).trim()
    if (!displayName) return null
    fields['displayName'] = displayName
    Object.assign(fields, artifactRenameListKeys('screens', displayName))
  }
  if (edits.description !== undefined) fields['description'] = String(edits.description ?? '').trim()
  return fields
}
