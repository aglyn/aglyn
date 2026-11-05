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
 * A publisher's own listing, on its own sites (AGL-2484, AGL-4047).
 *
 * The members of the workspace that publishes a listing install it free on
 * that workspace's own sites, for every listing type, and only there. The
 * same people installing it into another workspace are buyers in that
 * workspace like anyone else: it needs a licence there, or a purchase.
 *
 * Two facts make the waiver, and both are needed:
 *
 *  - the person belongs to the publishing workspace (a fact about who
 *    published it, read by `isPublisherMember`, never a permission); and
 *  - the install lands in that same workspace.
 *
 * Plugins and site starters have asked both since AGL-2484. The other
 * install doors asked only the first, so a member could put the
 * workspace's paid listing on a client's site for free. Every door now
 * decides through this one definition (`server/own-listing.ts`), and the
 * console asks the same "lands in the publisher's workspace" half before it
 * offers an install without a purchase.
 *
 * Context-free: no Firestore, so the console can ask it too.
 */

/** A workspace id as stored, or the empty string for anything else. */
const workspaceIdOf = (value: unknown): string =>
  typeof value === 'string' ? value : ''

/**
 * Whether an install lands in the workspace that publishes the listing.
 *
 * `publisherOrgId` is the listing's `profileId` (listings are org-owned,
 * AGL-652). `targetOrgId` is the workspace the install lands in, resolved
 * server-side from the site, never from a request body. A listing with no
 * publisher is nobody's, so it lands in nobody's workspace.
 */
export function landsInPublisherWorkspace(
  publisherOrgId: unknown,
  targetOrgId: unknown,
): boolean {
  const publisher = workspaceIdOf(publisherOrgId)
  return publisher !== '' && workspaceIdOf(targetOrgId) === publisher
}

/**
 * The own-listing waiver: a member of the publishing workspace, installing
 * into that workspace. It waives the payment, and lets the publisher install
 * its own private listing (and, for plugins and starters, a version still
 * in review). Anything else is an install by a buyer.
 */
export function isOwnListingInstall(facts: {
  publisherOrgId: unknown
  targetOrgId: unknown
  /** `isPublisherMember` for the person asking, in the publishing workspace. */
  publisherMember: boolean
}): boolean {
  return (
    facts.publisherMember === true &&
    landsInPublisherWorkspace(facts.publisherOrgId, facts.targetOrgId)
  )
}

/**
 * A member of the publishing workspace, buying for any other workspace: the
 * sale refuses them whichever workspace it is for (`server/sale.ts`, AGL-3365),
 * so the console switches Buy off for them rather than let them find out
 * afterward. On the publisher's own sites there is nothing to buy: the waiver
 * above makes it free, so this is false there.
 */
export function isPublisherMemberElsewhere(facts: {
  publisherOrgId: unknown
  targetOrgId: unknown
  /** `isPublisherMember` for the person asking, in the publishing workspace. */
  publisherMember: boolean
}): boolean {
  return (
    facts.publisherMember === true &&
    !landsInPublisherWorkspace(facts.publisherOrgId, facts.targetOrgId)
  )
}

/** Why Buy is off for a member of the publishing workspace, in one sentence. */
export function publisherMemberBuyReason(publisherName: unknown): string {
  const name = typeof publisherName === 'string' ? publisherName.trim() : ''
  return `Someone in this workspace who isn't in ${name || 'the publishing workspace'} needs to buy it.`
}
