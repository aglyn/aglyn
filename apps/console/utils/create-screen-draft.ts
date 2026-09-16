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

// Deep import, not the `@aglyn/aglyn` barrel: a value import off the barrel
// pins the whole of it into every bundle that reaches this module.
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'

/** What the drawer collected, plus the two ids the caller minted. */
export interface CreateScreenDraftInput {
  hostId: string
  /** Document id for the screen, minted by the caller. */
  screenId: string
  /** Document id for its first version, minted by the caller. */
  versionId: string
  /**
   * Authored fields off the drawer — display name, description and whatever
   * else the form collects. `versionId` is added here, not by the caller.
   */
  fields: Record<string, unknown>
  /**
   * The screen's own slug segment, already normalized. STORED on the screen
   * document and deliberately not registered anywhere: see above.
   */
  slug?: string
}

/**
 * Create a screen and its first version, and NOTHING that decides what the
 * live site serves (AGL-3021).
 *
 * `Screens ▸ CREATE NEW SCREEN` used to create the screen, create its first
 * version, and then publish the route in the same `.then` chain — measured
 * 2026-09-03 as `Updated 1:16:07 PM` / `Published 1:16:08 PM`. So a blank page
 * was live on the public site from the moment of creation, and the only way
 * back was `View details ▸ UNPUBLISH`, which nobody visits on the way to
 * building a page. A page became public because somebody clicked *create*.
 *
 * ## Why this is a module rather than two lines in the handler
 *
 * The guarantee is STRUCTURAL, which is the only kind that survives a
 * refactor. This function takes the two resource APIs and nothing else — no
 * `Firestore`, no signed-in `user` — so it cannot reach `publishScreenRoute`,
 * cannot write the host's `screens` routing map, and cannot stamp
 * `publishedAt`. Not "does not"; cannot. That is exactly how the AI draft
 * writer earns its drafts-only promise (`ai-job-drafts.ts`): it writes the
 * screen document and its `versions` doc directly and never touches the one
 * document that decides what resolves. `create-screen-draft.spec.ts` is what
 * holds the property in place.
 *
 * Contrast `createPageFromTemplate`, whose docstring says "Create one
 * live page" and means it: installing a starter is a deliberate act of
 * putting a site up, and AGL-1575 pins that a template-started site answers
 * at its own root. Two creates, two intents; they are not the same door.
 *
 * ## The slug is stored, not routed
 *
 * An author who typed an address keeps it — it rides the screen document like
 * any other authored field, so the Publish control opens with it filled in.
 * What it does not get is an entry in the host's `screens` map, which is the
 * only thing the tenant matches request paths against. A screen with a slug
 * and no entry is a screen with an address nobody can reach yet, which is
 * what a draft is.
 */
export async function createScreenDraft(
  createHostResource: (options: {
    hostId: string
    resource: 'screen'
    id?: string
    data: Record<string, unknown>
  }) => Promise<unknown>,
  createHostVersion: (options: {
    hostId: string
    kind: 'screen'
    parentId: string
    id?: string
    data?: Record<string, unknown>
  }) => Promise<unknown>,
  input: CreateScreenDraftInput,
): Promise<{ screenId: string; versionId: string }> {
  const { hostId, screenId, versionId, fields, slug } = input

  // No createdAt/updatedAt on either write: /api/hosts/resources (AGL-473)
  // and /api/hosts/versions (AGL-1369) stamp both server-side, and a client
  // Timestamp does not survive the JSON hop.
  //
  // Screen doc rides the quota-enforcing resources API; the first version
  // rides the versions route. Rules deny a client `create` under a screen's
  // `versions`, because that create is what the `versioning` entitlement
  // sells — the route allows a resource's FIRST version on every plan and
  // charges only for retaining more.
  await createHostResource({
    hostId,
    resource: 'screen',
    id: screenId,
    data: { ...fields, ...(slug ? { slug } : {}), versionId },
  })
  await createHostVersion({
    hostId,
    kind: 'screen',
    parentId: screenId,
    id: versionId,
    // The empty canvas the besigner opens into. A first version has to exist
    // for the editor to have something to open; an UNPUBLISHED one is all
    // that takes, so `Date published` stays empty and the chip reads Draft.
    data: {
      screenId,
      nodes: {
        [CANVAS_ROOT_ELEMENT_ID]: {
          $id: CANVAS_ROOT_ELEMENT_ID,
          componentId: 'div',
          nodes: [],
        },
      },
    },
  })

  return { screenId, versionId }
}

export default createScreenDraft
