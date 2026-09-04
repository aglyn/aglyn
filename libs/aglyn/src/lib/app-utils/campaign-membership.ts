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
 * WHAT ELSE IS IN A CAMPAIGN: the edge between a campaign and the forms,
 * screens and people a push is coordinated across.
 *
 * ## The edge is a field on the RESOURCE, not a list on the campaign
 *
 * A campaign container lives at `hosts/{hostId}/emailCampaigns/{campaignId}`
 * and names nothing outside itself. A send joins one by carrying
 * `emailCampaignId`; every other member joins the same way, through
 * {@link CAMPAIGN_MEMBERSHIP_FIELD} on its own document.
 *
 * Three properties decide it, and all three point the same way:
 *
 *  - **Reading is free where it is asked.** A form's own page reads the form
 *    document to draw anything at all, so the campaign comes with it. A
 *    membership collection under the campaign would make "which campaign is
 *    this in" a query issued on mount by every resource page, for a fact one
 *    field already carries.
 *  - **The reduction is already gated this way.** `campaign-manage.ts` clears
 *    `emailCampaignId` from every send before it removes a container, so no
 *    send is left naming one that is gone. Extending that pass to the
 *    membership field is the SAME mechanism; a membership collection would be
 *    a second, different deletion story beside it.
 *  - **Deleting a MEMBER can leave nothing behind.** The campaign holds no
 *    list, so a deleted form takes its own edge with it. This matters most on
 *    a contact: an erasure removes the document, and a membership row stored
 *    anywhere else would survive it holding the id of a person who asked to
 *    be forgotten.
 *
 * ## Plural, because a landing page outlives one campaign
 *
 * The field is an ARRAY. A signup form built for the spring push is the same
 * form the summer push places, and a single-valued field would make the
 * second assignment silently erase the first — a campaign losing a member
 * with nothing on screen to say so. The automation step that has always
 * written this edge (`assignCampaign`) already used `arrayUnion`, so the
 * product has treated it as many-to-many from the start.
 *
 * ## Ids, never names
 *
 * A campaign's name is editable, and every reader here resolves the name from
 * the campaign document at read time. Renaming a campaign therefore moves no
 * membership: the stored value is the container's document id, which nothing
 * rewrites.
 */

import { contactFacetPath, readContactFacet } from './contacts'

/**
 * The field naming the campaigns a resource belongs to.
 *
 * Not `emailCampaignId`, which is the SEND's field: on a send document the
 * word `campaignId` already means the send's own id — it is what `cid`
 * carries into every unsubscribe footer — so that collection needed a
 * different word. A form, a screen and a contact have no second meaning for
 * it, and the plural says the resource may be in more than one.
 */
export const CAMPAIGN_MEMBERSHIP_FIELD = 'campaignIds'

/**
 * How many campaigns one resource may name.
 *
 * A ceiling on the FIELD, not on the product: an array Firestore has to index
 * on every write is not the place to discover that a script has been adding
 * an id a day for a year. Twenty is far past what a person assigns by hand
 * and far short of anything that costs a write.
 */
export const CAMPAIGN_MEMBERSHIP_CAP = 20

/**
 * A stored membership array as a clean list of ids.
 *
 * Deduped, trimmed, non-strings dropped, capped. Every reader goes through
 * this because the field is written by three consoles and one automation
 * step, and a surface that trusted the raw value would render `undefined` as
 * a chip the first time one of them wrote a blank.
 */
export function normalizeCampaignIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen: string[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    const id = entry.trim()
    if (!id || seen.includes(id)) continue
    seen.push(id)
    if (seen.length >= CAMPAIGN_MEMBERSHIP_CAP) break
  }
  return seen
}

/**
 * The campaigns a HOST resource — a form, a screen — belongs to.
 *
 * Host resources carry the field at the top of the document: they belong to
 * one site, which is the same site the campaign belongs to, so there is no
 * second holder to keep the edge away from.
 */
export function readCampaignIds(
  resource: Record<string, unknown> | null | undefined,
): string[] {
  return normalizeCampaignIds((resource ?? {})[CAMPAIGN_MEMBERSHIP_FIELD])
}

/**
 * The dotted path to a contact's membership, inside ONE holder's facet.
 *
 * A contact document is shared by every site in the org — one human who
 * touched two sites is one row — and almost nothing on it is legitimately
 * shared. Which campaigns a merchant has filed a person under is that
 * merchant's business record on exactly the footing their notes and tags are,
 * so it lives at `facets.{groupId}.campaignIds` and not at the top of the
 * document, where every other site in an agency's account could read it.
 */
export function contactCampaignFieldPath(groupId: string): string {
  return contactFacetPath(groupId, CAMPAIGN_MEMBERSHIP_FIELD)
}

/** The campaigns ONE holder has filed this contact under. */
export function readContactCampaignIds(
  contact: Record<string, unknown> | null | undefined,
  groupId: string,
): string[] {
  return normalizeCampaignIds(readContactFacet(contact, groupId).campaignIds)
}

/**
 * The membership a save should write, given what is on screen.
 *
 * Pure, and shared by the three consoles that offer the picker, because the
 * decision each of them makes is identical and is not obvious: an EMPTY
 * selection has to be stored as an empty array rather than as a removed
 * field.
 *
 * Removing the field would read the same to every surface here — the readers
 * above answer `[]` either way — and would be wrong for the one reader that
 * is not a surface. `campaign-manage.ts` finds a campaign's members with
 * `array-contains`, which matches on the automatic single-field index; that
 * index has an entry only while the array does, so the two shapes are the
 * same to a reader and different to a writer only in cost. Storing `[]` keeps
 * one shape for "belongs to no campaign" across every writer, which is the
 * property the send collection's own detach comment argues for one field
 * over.
 *
 * @returns the value to store under {@link CAMPAIGN_MEMBERSHIP_FIELD}.
 */
export function campaignMembershipValue(selected: readonly string[]): string[] {
  return normalizeCampaignIds(selected)
}

/**
 * Whether a document's stored membership already says what a save would.
 *
 * Order-insensitive: a picker hands back its options' order and the stored
 * array is in the order it was written, so comparing them literally would
 * report a change on every open and leave Save permanently enabled.
 */
export function campaignMembershipUnchanged(
  stored: readonly string[],
  selected: readonly string[],
): boolean {
  if (stored.length !== selected.length) return false
  const sortedStored = [...stored].sort()
  const sortedSelected = [...selected].sort()
  return sortedStored.every((id, index) => id === sortedSelected[index])
}

/**
 * The host subcollections whose documents may name a campaign.
 *
 * The list a campaign's deletion walks, and the list this feature's coverage
 * spec reads — so a collection that grows the picker without growing the
 * detach fails the build rather than shipping a campaign whose removal leaves
 * that collection pointing at nothing.
 *
 * Contacts are deliberately NOT here. They live on the org
 * (`orgs/{orgId}/contacts`), not the host, and carry the field inside a
 * per-holder facet — so they are detached by their own pass, against a field
 * path that names the group.
 */
export const CAMPAIGN_MEMBER_HOST_COLLECTIONS = ['forms', 'screens'] as const

export type CampaignMemberHostCollection =
  (typeof CAMPAIGN_MEMBER_HOST_COLLECTIONS)[number]
