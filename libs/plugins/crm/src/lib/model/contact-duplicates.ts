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

import { nameSearchKey, readContactFacet, readContactCompanyLink } from '@aglyn/aglyn'

/**
 * LIKELY DUPLICATES (AGL-2625): the rule, with no Firestore attached.
 *
 * Two records are likely one person when they share a name AND a phone
 * number, or a name AND a company. A name alone is two people called Sam
 * Lee; a phone alone is a household; either beside the same name is a
 * person who filled in two forms from two addresses. The card runs ONE
 * bounded query — same normalized name, among the contacts this viewer may
 * list, on the index the list's own search uses — and applies this rule to
 * the page, so no index has to be added for it.
 *
 * Read through the VIEWING group's facet, the way the record page reads
 * everything: the phone and company another holder keeps on the same row
 * are theirs, and matching on them would tell this holder what another
 * business knows. The top-level search echoes stand in only where this
 * holder's facet has nothing, since those are what the global search
 * already shows this reader.
 */

/** Why a candidate reads as the same person. */
export type DuplicateReason = 'phone' | 'company'

/** How many same-name rows the card reads before applying the rule. */
export const CONTACT_DUPLICATES_LIMIT = 25

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** This holder's phone for the person, or the echo the last writer left. */
function phoneOf(doc: Record<string, unknown>, groupId: string): string {
  return text(readContactFacet(doc, groupId).phone) || text(doc['phone'])
}

/** The company keys a record answers to: its linked ids and its typed name. */
function companyKeysOf(doc: Record<string, unknown>, groupId: string): string[] {
  const facet = readContactFacet(doc, groupId)
  const link = readContactCompanyLink(doc, groupId)
  const name = nameSearchKey(facet.companyName || text(doc['companyName']))
  return [
    ...(link.companyId ? [`id:${link.companyId}`] : []),
    ...link.companyIds.map((id) => `id:${id}`),
    ...(name ? [`name:${name}`] : []),
  ]
}

/**
 * The name two records are compared on: this holder's own name for the
 * person, else the canonical one — normalized the way the search key is,
 * so "Jane  Doe" and "jane doe" are one name.
 */
export function duplicateNameKey(
  doc: Record<string, unknown>,
  groupId: string,
): string {
  return nameSearchKey(text(readContactFacet(doc, groupId).name) || text(doc['name']))
}

/**
 * Every reason `candidate` reads as the same person as `current` — empty
 * when it does not. A candidate with a different name, or the record
 * itself, never matches.
 */
export function likelyDuplicateReasons(
  current: { id: string; doc: Record<string, unknown> },
  candidate: { id: string; doc: Record<string, unknown> },
  groupId: string,
): DuplicateReason[] {
  if (current.id === candidate.id) return []
  const name = duplicateNameKey(current.doc, groupId)
  if (!name || name !== duplicateNameKey(candidate.doc, groupId)) return []
  const reasons: DuplicateReason[] = []
  const phone = phoneOf(current.doc, groupId)
  if (phone && phone === phoneOf(candidate.doc, groupId)) reasons.push('phone')
  const keys = new Set(companyKeysOf(current.doc, groupId))
  if (companyKeysOf(candidate.doc, groupId).some((key) => keys.has(key))) {
    reasons.push('company')
  }
  return reasons
}

/** How a reason reads on the card. */
export const DUPLICATE_REASON_LABELS: Record<DuplicateReason, string> = {
  phone: 'Same name and phone',
  company: 'Same name and company',
}
