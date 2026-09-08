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

import type { ContactFieldDefinition, CrmCustomValue } from '@aglyn/aglyn'

/**
 * A custom-field DRAFT: the keys a person touched, over what is stored
 * (AGL-2661).
 *
 * Every surface that edits a `custom` map — the contact's card, the
 * company's and the deal's drawers — holds the same two things: the map
 * as it was read, and the keys the reader has changed since. What Save
 * writes is the difference, key by key, because a `custom` map written
 * whole would take every key the surface did not show out with it, and a
 * write of every key would turn a one-field edit into a write of ten.
 * Pure, so the three surfaces cannot drift on what "changed" means.
 */
export type CrmCustomDraft = Record<string, CrmCustomValue>

/** A stored `custom` map, as read — absent keys and `null` both read as nothing. */
export type CrmCustomStored = Readonly<Record<string, CrmCustomValue | undefined>>

/** The value a key shows: the draft's where touched, else the stored one. */
export function crmCustomDraftValue(
  stored: CrmCustomStored,
  draft: CrmCustomDraft,
  key: string,
): CrmCustomValue | undefined {
  return key in draft ? draft[key] : stored[key]
}

/**
 * The keys whose draft differs from what is stored, with the value to
 * write — `null` for a cleared one, the explicit "nothing" that keeps the
 * key present for a `where` clause to find.
 */
export function crmCustomDraftChanges(
  stored: CrmCustomStored,
  draft: CrmCustomDraft,
): Array<[key: string, value: CrmCustomValue]> {
  return Object.entries(draft)
    .filter(([key, value]) => (value ?? null) !== (stored[key] ?? null))
    .map(([key, value]) => [key, value ?? null])
}

/**
 * The changes as an `update()` payload: one dotted path per key, so the
 * map is merged rather than replaced. Empty when nothing changed, so a
 * caller can spread it into a larger write unconditionally.
 */
export function crmCustomDraftWrites(
  stored: CrmCustomStored,
  draft: CrmCustomDraft,
): Record<`custom.${string}`, CrmCustomValue> {
  return Object.fromEntries(
    crmCustomDraftChanges(stored, draft).map(([key, value]) => [`custom.${key}`, value]),
  ) as Record<`custom.${string}`, CrmCustomValue>
}

/**
 * The draft as the `custom` map a CREATE stores: every key with a value,
 * `null` and absent both left out because a fresh document has nothing to
 * clear. `undefined` when nothing would be stored, so a caller spreads
 * `{ custom }` only when there is one.
 */
export function crmCustomDraftDocument(
  draft: CrmCustomDraft,
): Record<string, CrmCustomValue> | undefined {
  const stored = Object.fromEntries(
    Object.entries(draft).filter(([, value]) => value !== null && value !== undefined),
  )
  return Object.keys(stored).length ? stored : undefined
}

/**
 * The required definitions the draft leaves empty — which Save refuses.
 *
 * On an EDIT only a key the reader cleared counts: a required field a
 * record has always lacked is not this save's to demand, or a rename
 * could be refused for a field added last week. On a CREATE every
 * required field counts, because the record is being made whole.
 */
export function crmCustomDraftMissingRequired(
  definitions: readonly Pick<ContactFieldDefinition, 'key' | 'required' | 'label'>[],
  stored: CrmCustomStored,
  draft: CrmCustomDraft,
  mode: 'create' | 'edit',
): string[] {
  return definitions
    .filter((definition) => {
      if (!definition.required) return false
      const value = crmCustomDraftValue(stored, draft, definition.key)
      const empty = value === null || value === undefined || value === ''
      return mode === 'create' ? empty : definition.key in draft && empty
    })
    .map((definition) => definition.label || definition.key)
}
