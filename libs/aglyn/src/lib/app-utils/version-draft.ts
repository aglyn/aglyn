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

/**
 * Where a version's WORKING DRAFT lives (AGL-1152): one document per version,
 * `…/versions/{versionId}/draft/current`, on every plan. The Besigner saves
 * to it as an author works and offers it with Open draft when the page is
 * opened; publishing moves it into the version and clears it.
 *
 * Held here, in the core, because two writers must agree on it to the
 * letter: the Besigner (`besigner-server-draft.ts`) and an AI edit job, which
 * saves its change into the same draft so the author reviews and publishes
 * it in the Besigner exactly as they would their own (AGL-4116).
 */

/** The subcollection under a version that holds its draft. */
export const VERSION_DRAFT_COLLECTION = 'draft'

/** The only id a draft may have. One per version, by construction. */
export const VERSION_DRAFT_DOC_ID = 'current'

/** The version segment of a document with no versions of its own, as the mirror writes it. */
export const COEDIT_MIRROR_CURRENT_VERSION = 'current'

/**
 * The co-edit mirror room of one version (AGL-677): the unsaved canvas work
 * a Besigner tab publishes for the others in the room, replayed to whoever
 * joins until a save clears it. `apps/console/hooks/use-coediting.ts` builds
 * the same path, and `presence-version-scope.spec.ts` holds the two together.
 *
 * Saving makes the stored document authoritative, so a save clears the
 * room; an AI edit job that saves into a version's draft clears it too
 * (AGL-4116), or the older unsaved work replays over the draft it just wrote.
 */
export function coeditMirrorRoomPath(input: {
  orgId: string
  hostId: string
  docType: string
  docId: string
  versionId?: string | null
}): string {
  return `coedit/${input.orgId}/${input.hostId}/${input.docType}/${input.docId}/${input.versionId ?? COEDIT_MIRROR_CURRENT_VERSION}/nodes`
}
