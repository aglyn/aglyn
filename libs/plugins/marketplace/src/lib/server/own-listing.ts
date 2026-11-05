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

import {
  isOwnListingInstall,
  isPublisherMemberElsewhere,
  landsInPublisherWorkspace,
} from '../model/own-listing'
import { isPublisherMember } from './publisher-profile'

/**
 * Whether this install is the publisher's own (AGL-2484, AGL-4047): the
 * person belongs to the workspace that publishes the listing AND the install
 * lands in that workspace. The one answer every install door, `update-artifact`
 * and the site starter source give to "is this free because it is theirs".
 *
 * `targetOrgId` is the workspace the install lands in, as the door resolved
 * it from the site (or the org it installs into), and the same workspace a
 * licence has to cover. Off the publisher's own sites the membership cannot
 * change the answer, so it is not read.
 */
export async function ownsListingHere(
  firestore: FirebaseFirestore.Firestore,
  facts: {
    /** The authenticated caller, never a value from the request body. */
    uid: string
    /** The listing's `profileId`: the workspace that publishes it. */
    publisherOrgId: unknown
    targetOrgId: unknown
  },
): Promise<boolean> {
  const { uid, publisherOrgId, targetOrgId } = facts
  if (!landsInPublisherWorkspace(publisherOrgId, targetOrgId)) return false
  return isOwnListingInstall({
    publisherOrgId,
    targetOrgId,
    publisherMember: await isPublisherMember(firestore, uid, String(publisherOrgId)),
  })
}

/**
 * Whether the sale would refuse this person because they belong to the
 * publisher (AGL-3365, AGL-4047), asked before they press Buy so a surface can
 * say so. The refusal itself stays with `sale.ts`. On the publisher's own sites
 * the listing is free instead, so the membership is not read.
 */
export async function memberOfPublisherElsewhere(
  firestore: FirebaseFirestore.Firestore,
  facts: {
    /** The authenticated caller, never a value from the request body. */
    uid: string
    publisherOrgId: unknown
    targetOrgId: unknown
  },
): Promise<boolean> {
  const { uid, publisherOrgId, targetOrgId } = facts
  if (landsInPublisherWorkspace(publisherOrgId, targetOrgId)) return false
  return isPublisherMemberElsewhere({
    publisherOrgId,
    targetOrgId,
    publisherMember: await isPublisherMember(firestore, uid, String(publisherOrgId ?? '')),
  })
}
