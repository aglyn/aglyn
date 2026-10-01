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
 * WHAT A RECORD IS FILED UNDER: the edge between a container and the forms,
 * screens and people it gathers.
 *
 * A container is a document of a kind some plugin keeps and declares
 * (`plugin-manager/plugin-containers.ts`) — a campaign is the first. Records
 * of other kinds, kept by other plugins or by the core, are filed under one.
 *
 * ## The edge is a field on the MEMBER, not a list on the container
 *
 * A container names nothing outside itself. A member joins one by carrying
 * the container's id in {@link containerMembershipField} — `<kind>Ids` — on
 * its own document.
 *
 * Three properties decide it, and all three point the same way:
 *
 *  - **Reading is free where it is asked.** A form's own page reads the form
 *    document to draw anything at all, so its containers come with it. A
 *    membership collection under the container would make "what is this
 *    filed under" a query issued on mount by every record page, for a fact
 *    one field already carries.
 *  - **The removal is one mechanism.** The container's owner clears its id
 *    from every member before it removes the container, and a plugin whose
 *    members the owner cannot name registers a detacher for them
 *    (`plugin-manager/plugin-membership-detach.ts`). A membership collection
 *    would be a second, different deletion story beside it.
 *  - **Deleting a MEMBER can leave nothing behind.** The container holds no
 *    list, so a deleted form takes its own edge with it. This matters most on
 *    a contact: an erasure removes the document, and a membership row stored
 *    anywhere else would survive it holding the id of a person who asked to
 *    be forgotten.
 *
 * ## Plural, because a landing page outlives one push
 *
 * The field is an ARRAY. A signup form built for the spring campaign is the
 * same form the summer one places, and a single-valued field would make the
 * second filing silently erase the first — a container losing a member with
 * nothing on screen to say so.
 *
 * ## Ids, never names
 *
 * A container's name is editable, and every reader resolves the name from the
 * container document at read time. Renaming one therefore moves no
 * membership: the stored value is the container's document id, which nothing
 * rewrites.
 */

import { contactFacetPath, readContactFacet } from './contacts'

/**
 * The field a member holds its containers of one kind in: `<kind>Ids`.
 *
 * Derived rather than declared, so a record page in one plugin can file
 * itself under a kind another plugin keeps by the kind's name alone, and so
 * two plugins cannot store one kind's membership under two names. The owner
 * declares the kind; the field follows from it.
 */
export function containerMembershipField(kind: string): string {
  const key = String(kind ?? '').trim()
  if (!key) throw new Error('a container membership needs a kind')
  return `${key}Ids`
}

/**
 * How many containers of one kind a record may name.
 *
 * A ceiling on the FIELD, not on the product: an array Firestore has to index
 * on every write is not the place to discover that a script has been adding
 * an id a day for a year. Twenty is far past what a person assigns by hand
 * and far short of anything that costs a write.
 */
export const CONTAINER_MEMBERSHIP_CAP = 20

/**
 * A stored membership array as a clean list of ids.
 *
 * Deduped, trimmed, non-strings dropped, capped. Every reader goes through
 * this because the field is written by several consoles and automation
 * steps, and a surface that trusted the raw value would render `undefined` as
 * a chip the first time one of them wrote a blank.
 */
export function normalizeContainerIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen: string[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    const id = entry.trim()
    if (!id || seen.includes(id)) continue
    seen.push(id)
    if (seen.length >= CONTAINER_MEMBERSHIP_CAP) break
  }
  return seen
}

/**
 * The containers of one kind a HOST record — a form, a screen — is filed
 * under.
 *
 * Host records carry the field at the top of the document: they belong to
 * one site, and whoever may read the record may read what it is filed under,
 * so there is no second holder to keep the edge away from.
 */
export function readContainerIds(
  resource: Record<string, unknown> | null | undefined,
  kind: string,
): string[] {
  return normalizeContainerIds((resource ?? {})[containerMembershipField(kind)])
}

/**
 * The dotted path to a contact's membership of one kind, inside ONE holder's
 * facet.
 *
 * A contact document is shared by every site in the org — one human who
 * touched two sites is one row — and almost nothing on it is legitimately
 * shared. What a merchant has filed a person under is that merchant's
 * business record on exactly the footing their notes and tags are, so it
 * lives at `facets.{groupId}.<kind>Ids` and not at the top of the document,
 * where every other site in an agency's account could read it.
 */
export function contactContainerFieldPath(groupId: string, kind: string): string {
  return contactFacetPath(groupId, containerMembershipField(kind))
}

/** The containers of one kind ONE holder has filed this contact under. */
export function readContactContainerIds(
  contact: Record<string, unknown> | null | undefined,
  groupId: string,
  kind: string,
): string[] {
  const facet = readContactFacet(contact, groupId) as unknown as Record<string, unknown>
  return normalizeContainerIds(facet[containerMembershipField(kind)])
}

/**
 * The membership a save should write, given what is on screen.
 *
 * Pure, and shared by every console that offers a picker, because the
 * decision each of them makes is identical and is not obvious: an EMPTY
 * selection has to be stored as an empty array rather than as a removed
 * field.
 *
 * Removing the field would read the same to every surface here — the readers
 * above answer `[]` either way — and would be wrong for the one reader that
 * is not a surface. A container's owner finds its members with
 * `array-contains`, which matches on the automatic single-field index; that
 * index has an entry only while the array does, so the two shapes are the
 * same to a reader and different to a writer only in cost. Storing `[]` keeps
 * one shape for "filed under nothing" across every writer.
 *
 * @returns the value to store under {@link containerMembershipField}.
 */
export function containerMembershipValue(selected: readonly string[]): string[] {
  return normalizeContainerIds(selected)
}

/**
 * Whether a document's stored membership already says what a save would.
 *
 * Order-insensitive: a picker hands back its options' order and the stored
 * array is in the order it was written, so comparing them literally would
 * report a change on every open and leave Save permanently enabled.
 */
export function containerMembershipUnchanged(
  stored: readonly string[],
  selected: readonly string[],
): boolean {
  if (stored.length !== selected.length) return false
  const sortedStored = [...stored].sort()
  const sortedSelected = [...selected].sort()
  return sortedStored.every((id, index) => id === sortedSelected[index])
}
