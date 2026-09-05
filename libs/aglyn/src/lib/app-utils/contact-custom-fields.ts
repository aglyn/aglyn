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
 * Custom contact fields (AGL-2601): what a VALUE under a definition may be,
 * and the three doors a value comes in through.
 *
 * `crm.ts` declares the definition — `ContactFieldDefinition`, its key
 * grammar and its collection. This module is everything that happens between
 * a definition and a value: a form submission carrying a mapped field, an API
 * body carrying a `custom` map, and a publish that must not lose the mapping
 * an author drew. Each door coerces by the definition's TYPE, and the rule is
 * one function so a number typed into a form and a number sent over the API
 * cannot be stored as different things.
 *
 * Pure like the module it extends: no Firestore, no React. The bound on how
 * many definitions one org keeps is stated here because every reader of the
 * collection — the console hook, the submit route, the API — has to read it
 * whole, and a reader without a limit is a reader whose cost is somebody
 * else's decision.
 */

import type { ContactCustomValue, ContactFieldDefinition, ContactFieldType } from './crm'
import type { FormFieldDecl } from './forms'

/**
 * How many field definitions one organization may hold, and therefore the
 * `limit()` every reader of `orgs/{orgId}/contactFields` applies.
 *
 * The collection is read WHOLE — there is no index on it and the list is
 * sorted by `order` in memory — so this is the ceiling on that read. A
 * hundred is far past what a profile form can carry; an org that wants more
 * has outgrown a per-contact map and needs a dataset.
 */
export const CONTACT_FIELDS_MAX_PER_ORG = 100

/** Every value type a definition may declare, in the order a picker lists them. */
export const CONTACT_FIELD_TYPES: readonly ContactFieldType[] = [
  'text',
  'number',
  'date',
  'select',
  'checkbox',
  'url',
]

/** How a field type reads on screen — typed so a type cannot ship unlabeled. */
export const CONTACT_FIELD_TYPE_LABELS: Record<ContactFieldType, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  select: 'Choice',
  checkbox: 'Checkbox',
  url: 'Link',
}

export function isContactFieldType(value: unknown): value is ContactFieldType {
  return (
    typeof value === 'string' &&
    (CONTACT_FIELD_TYPES as readonly string[]).includes(value)
  )
}

/** The longest string a text or link field stores. */
const CONTACT_TEXT_VALUE_MAX = 2000

/**
 * Definitions in the order a form, a column set and an export show them.
 *
 * `order` first, then the key, so two definitions that were given the same
 * position — which a reorder in flight can produce for one write — still
 * come out in one stable order on every surface rather than flickering.
 */
export function sortContactFieldDefinitions<
  T extends Pick<ContactFieldDefinition, 'order' | 'key'>,
>(definitions: readonly T[]): T[] {
  return [...definitions].sort(
    (a, b) =>
      (Number(a.order) || 0) - (Number(b.order) || 0) ||
      a.key.localeCompare(b.key),
  )
}

/** The definitions a value may still be WRITTEN under — sorted, not retired. */
export function activeContactFieldDefinitions<
  T extends Pick<ContactFieldDefinition, 'order' | 'key' | 'retiredAt'>,
>(definitions: readonly T[]): T[] {
  return sortContactFieldDefinitions(
    definitions.filter((definition) => !definition.retiredAt),
  )
}

/** Checkbox values a browser form actually posts for a ticked box. */
const AFFIRMATIVE = new Set(['true', 'on', 'yes', '1', 'checked'])
/** And what it posts, or what a client sends, for an unticked one. */
const NEGATIVE = new Set(['false', 'off', 'no', '0', 'unchecked'])

/**
 * One raw value, as the definition's type stores it — or `undefined` when
 * nothing usable was given.
 *
 * `undefined` and `null` are different answers on purpose. `null` is the
 * explicit "cleared" that keeps the key present for a `where` clause to find;
 * it is what a console save or an API body writes when it MEANS to clear.
 * `undefined` is "there is no value here", which a form submission produces
 * for a field left blank — and a blank field on a form must not clear a
 * value the merchant set by hand, so the caller drops the key rather than
 * writing it.
 *
 *  - `text` and `url` store the trimmed string, capped. A link has to parse
 *    as an `http(s)` URL, because the column renders it as one and a bare
 *    word would be a broken anchor on every row.
 *  - `number` stores a finite number. A numeric STRING is accepted because a
 *    form posts every field as text, but anything that is not one number is
 *    dropped rather than stored as `NaN`, which Firestore would refuse.
 *  - `checkbox` stores a boolean, reading the strings a browser posts for a
 *    ticked or an unticked box.
 *  - `date` stores an ISO 8601 string, so a date filter compares as text and
 *    an export reads as a date, whichever locale typed it.
 *  - `select` stores one of the declared options, exactly, or nothing: a
 *    choice outside the list would be a value the picker could never show.
 */
export function coerceContactCustomValue(
  definition: Pick<ContactFieldDefinition, 'type' | 'options'>,
  raw: unknown,
): ContactCustomValue | undefined {
  if (raw === undefined || raw === null) return undefined
  switch (definition.type) {
    case 'text': {
      const text = String(raw).trim().slice(0, CONTACT_TEXT_VALUE_MAX)
      return text ? text : undefined
    }
    case 'url': {
      const text = String(raw).trim().slice(0, CONTACT_TEXT_VALUE_MAX)
      if (!text) return undefined
      try {
        const url = new URL(text)
        return url.protocol === 'http:' || url.protocol === 'https:'
          ? text
          : undefined
      } catch {
        return undefined
      }
    }
    case 'number': {
      if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined
      if (typeof raw === 'boolean') return undefined
      const text = String(raw).trim()
      if (!text) return undefined
      const parsed = Number(text)
      return Number.isFinite(parsed) ? parsed : undefined
    }
    case 'checkbox': {
      if (typeof raw === 'boolean') return raw
      const text = String(raw).trim().toLowerCase()
      if (AFFIRMATIVE.has(text)) return true
      if (NEGATIVE.has(text)) return false
      return undefined
    }
    case 'date': {
      if (typeof raw === 'boolean') return undefined
      const ms =
        typeof raw === 'number'
          ? raw
          : raw instanceof Date
            ? raw.getTime()
            : Date.parse(String(raw).trim())
      return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined
    }
    case 'select': {
      const text = String(raw).trim()
      const options = Array.isArray(definition.options) ? definition.options : []
      return text && options.includes(text) ? text : undefined
    }
    default:
      return undefined
  }
}

/**
 * What a form submission writes into the contact's `custom`: one entry per
 * declared field that names a contact field, coerced by that field's type.
 *
 * Only ACTIVE definitions receive a value — a mapping onto a retired field
 * is a mapping the author has not yet removed, and writing under a retired
 * key would put a value where no surface offers to show it. A field the
 * visitor left blank contributes nothing (see `coerceContactCustomValue`),
 * so a submission never clears a value a merchant set by hand.
 *
 * Two declared fields mapped onto one key is an authoring mistake this
 * function does not refuse; the FIRST declared field to yield a value wins,
 * in declaration order, so the answer is at least stable.
 */
export function collectMappedContactCustom(options: {
  /** The submitted values, keyed by the declared `fieldName`. */
  fields: Record<string, unknown>
  /** The form's declaration, as stored on its document. */
  decls: readonly FormFieldDecl[] | null | undefined
  /** The org's definitions, retired ones included — they are filtered here. */
  definitions: readonly ContactFieldDefinition[]
}): Record<string, ContactCustomValue> {
  const active = new Map(
    activeContactFieldDefinitions(options.definitions).map((definition) => [
      definition.key,
      definition,
    ]),
  )
  const custom: Record<string, ContactCustomValue> = {}
  for (const decl of options.decls ?? []) {
    const key = decl.contactFieldKey
    if (!key || key in custom) continue
    const definition = active.get(key)
    if (!definition) continue
    const value = coerceContactCustomValue(definition, options.fields[decl.fieldName])
    if (value !== undefined) custom[key] = value
  }
  return custom
}

/**
 * The declaration a publish writes, with the mappings the author drew on the
 * previous one carried across.
 *
 * `formFieldDeclsFromNodes` reads a declaration off the DESIGN — the names,
 * types and options the nodes carry — and knows nothing about where a field
 * saves to, because that is edited on the form's own page rather than drawn
 * on the canvas. A publish that replaced the stored `fields` wholesale would
 * therefore drop every mapping on every publish, and the author would find
 * their profile fields silently empty after the next design change.
 *
 * Carried BY FIELD NAME, which is the submission key and the identity a
 * declared field has. A field renamed on the canvas is a new field and starts
 * unmapped; a field removed takes its mapping with it. Nothing else on the
 * previous declaration survives — the design is still the source of truth
 * for everything it draws.
 */
export function carryContactFieldMappings(
  previous: readonly FormFieldDecl[] | null | undefined,
  next: readonly FormFieldDecl[],
): FormFieldDecl[] {
  const carried = new Map<string, string>()
  for (const decl of previous ?? []) {
    if (decl?.fieldName && decl.contactFieldKey) {
      carried.set(decl.fieldName, decl.contactFieldKey)
    }
  }
  return next.map((decl) => {
    const key = carried.get(decl.fieldName)
    return key ? { ...decl, contactFieldKey: key } : decl
  })
}

/** What one coercion refusal tells an API caller, per type. */
function customValueExpectation(
  definition: Pick<ContactFieldDefinition, 'type' | 'options'>,
): string {
  switch (definition.type) {
    case 'number':
      return 'Must be a number'
    case 'checkbox':
      return 'Must be true or false'
    case 'date':
      return 'Must be an ISO 8601 date'
    case 'url':
      return 'Must be an http(s) URL'
    case 'select':
      return `Must be one of: ${(definition.options ?? []).join(', ')}`
    default:
      return 'Must be text'
  }
}

/**
 * A `custom` map sent to the API, validated against the org's definitions.
 *
 * Unknown keys are REFUSED rather than dropped, following the contact
 * resource's own rule for its top-level keys: a silent drop reads as "we
 * stored your value" when nothing was stored, and an integration pushing a
 * field it spelled wrong would never learn. Each refusal is named
 * `custom.<key>` so a client can match it to the entry it sent.
 *
 * A retired field is refused too. Its values are still READ — an export has
 * to show what was written under it — but nothing writes under a key the
 * console no longer offers, or the field could never actually go away.
 *
 * `null` is accepted for every type and means "clear": the key stays present
 * with an explicit nothing, which is the shape the console writes and the
 * shape a `where` clause can find.
 */
export function readContactCustomInput(
  raw: unknown,
  definitions: readonly ContactFieldDefinition[],
): { values: Record<string, ContactCustomValue> } | { errors: Record<string, string> } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { errors: { custom: 'Must be an object of field values keyed by field key' } }
  }
  const byKey = new Map(
    sortContactFieldDefinitions(definitions).map((definition) => [
      definition.key,
      definition,
    ]),
  )
  const values: Record<string, ContactCustomValue> = {}
  const errors: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const definition = byKey.get(key)
    if (!definition) {
      errors[`custom.${key}`] = 'No such contact field'
      continue
    }
    if (definition.retiredAt) {
      errors[`custom.${key}`] = 'Retired contact field — restore it to write it'
      continue
    }
    if (value === null) {
      values[key] = null
      continue
    }
    const coerced = coerceContactCustomValue(definition, value)
    if (coerced === undefined) {
      errors[`custom.${key}`] = customValueExpectation(definition)
      continue
    }
    values[key] = coerced
  }
  return Object.keys(errors).length ? { errors } : { values }
}
