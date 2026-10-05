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

// Every DECISION the CRM picklists backfill makes (AGL-3511), with no
// Firestore in sight so the test can drive them directly.
// `tools/scripts/backfill-crm-picklists.mjs` reads, prints and writes; nothing here touches
// a database. See `docs/CRM_PICKLISTS_BACKFILL.md`.
//
// ## Lists, never records
//
// Records store a picklist's LABEL, and the engine (`app-utils/picklists`)
// merges every standard value into each org's list on read. So nothing a
// record holds has to change for the standard values to arrive: a stored
// value whose id is a standard id IS that standard value, overridden, and
// stays as it is. What the standard set does NOT cover is the labels an org
// already holds on its records that are neither standard nor stored — those
// would read "(not in the list)" in every select. The backfill writes each of
// them down as the org's own value, and never rewrites a record.
//
// ## Lead source groups
//
// An org-added lead source is filed under a direction by its label: one
// starting "Outbound" is Outbound, one naming a website form is Inbound, and
// anything else is left in no group for an admin to place. A group an admin
// already set is never moved.
//
// ## The registry is read from the source
//
// The definitions live in `libs/aglyn/src/lib/app-utils/crm.ts`. This module
// reads them from that file's text (`readPicklistDefinitions`) rather than
// restating them, so a picklist another change registers — Industry — is
// backfilled when it exists and skipped when it does not. Its test holds the
// reader to the Lead source definition as `crm.ts` spells it.

/** The most values one list holds — `PICKLIST_VALUES_MAX`. */
export const PICKLIST_VALUES_MAX = 200
/** The longest label a value carries — `PICKLIST_LABEL_MAX`. */
export const PICKLIST_LABEL_MAX = 120

/** `normalizePicklistLabel`: trimmed, single-spaced, capped. */
export function normalizeLabel(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, PICKLIST_LABEL_MAX)
}

/** `picklistLabelKey`: case and spacing never make a new value. */
export function labelKey(value) {
  return normalizeLabel(value).toLowerCase()
}

/** `mintPicklistValueId`: the label as a slug, suffixed until it is not taken. */
export function mintValueId(label, taken) {
  const used = new Set(taken)
  const base =
    normalizeLabel(label)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'value'
  let id = base
  for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`
  return id
}

/*==========================================
 * THE REGISTRY, READ FROM crm.ts
 *=========================================*/

const QUOTED = String.raw`'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"`

/** The text inside the array literal `key: [ … ]` in `body`, brackets balanced and quotes skipped. */
function arrayAfter(body, key) {
  const found = new RegExp(String.raw`\b${key}:\s*\[`).exec(body)
  if (!found) return null
  const open = found.index + found[0].length
  let depth = 1
  for (let at = open; at < body.length; at += 1) {
    const char = body[at]
    if (char === "'" || char === '"') {
      for (at += 1; at < body.length && body[at] !== char; at += 1) if (body[at] === '\\') at += 1
      continue
    }
    if (char === '[') depth += 1
    else if (char === ']' && (depth -= 1) === 0) return body.slice(open, at)
  }
  return null
}

function unquote(match, at) {
  const raw = match[at] ?? match[at + 1]
  return raw === undefined ? undefined : raw.replace(/\\(.)/g, '$1')
}

/**
 * Every `… as const satisfies CrmPicklistDefinition` object in `source`, as
 * `{ id, standardValues: [{ id, label, group?, meaning? }], groups: [ids], meanings: [...],
 * targets: [{ object, field, facet? }] }`.
 * The objects are read by their own keys, so a definition this module has
 * never heard of is read the same way.
 */
export function readPicklistDefinitions(source) {
  const definitions = []
  const marker = /as const satisfies CrmPicklistDefinition\b/g
  for (let found = marker.exec(source); found; found = marker.exec(source)) {
    // The object literal that ends right before the marker.
    const end = source.lastIndexOf('}', found.index)
    let depth = 0
    let start = -1
    for (let at = end; at >= 0; at -= 1) {
      if (source[at] === '}') depth += 1
      else if (source[at] === '{') {
        depth -= 1
        if (depth === 0) {
          start = at
          break
        }
      }
    }
    if (start < 0) continue
    // Comments read as code to the scan below — an apostrophe in one opens a quote.
    const body = source
      .slice(start, end + 1)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    const id = new RegExp(String.raw`^\{\s*id:\s*(?:${QUOTED})`).exec(body)
    if (!id) continue
    const definition = { id: unquote(id, 1), standardValues: [], groups: [], meanings: [], targets: [] }
    const values = arrayAfter(body, 'standardValues')
    if (values) {
      const entry = /\{([^{}]*)\}/g
      for (let row = entry.exec(values); row; row = entry.exec(values)) {
        const field = (name) => {
          const match = new RegExp(String.raw`\b${name}:\s*(?:${QUOTED})`).exec(row[1])
          return match ? unquote(match, 1) : undefined
        }
        const valueId = field('id')
        const label = field('label')
        if (!valueId || !label) continue
        definition.standardValues.push({
          id: valueId,
          label,
          ...(field('group') ? { group: field('group') } : {}),
          ...(field('meaning') ? { meaning: field('meaning') } : {}),
        })
      }
    }
    const groups = arrayAfter(body, 'groups')
    if (groups) {
      const groupId = new RegExp(String.raw`\bid:\s*(?:${QUOTED})`, 'g')
      for (let row = groupId.exec(groups); row; row = groupId.exec(groups)) {
        definition.groups.push(unquote(row, 1))
      }
    }
    const targets = arrayAfter(body, 'targets')
    if (targets) {
      const entry = /\{([^{}]*)\}/g
      for (let row = entry.exec(targets); row; row = entry.exec(targets)) {
        const field = (name) => {
          const match = new RegExp(String.raw`\b${name}:\s*(?:${QUOTED})`).exec(row[1])
          return match ? unquote(match, 1) : undefined
        }
        const object = field('object')
        const name = field('field')
        if (!object || !name) continue
        definition.targets.push({ object, field: name, ...(/\bfacet:\s*true\b/.test(row[1]) ? { facet: true } : {}) })
      }
    }
    const meanings = arrayAfter(body, 'meanings')
    if (meanings) {
      const word = new RegExp(QUOTED, 'g')
      for (let row = word.exec(meanings); row; row = word.exec(meanings)) {
        definition.meanings.push(unquote(row, 1))
      }
    }
    definitions.push(definition)
  }
  return definitions
}

/*==========================================
 * THE EFFECTIVE LIST — the engine's merge, restated
 *=========================================*/

/**
 * A stored document's values as the engine reads them: tolerant of a value
 * with no label, a repeated label or id, and `active` true unless `false`.
 * `null` for a document that holds no list.
 */
export function storedValues(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.values)) return null
  const values = []
  const labels = new Set()
  const ids = new Set()
  for (const entry of raw.values) {
    if (!entry || typeof entry !== 'object') continue
    const label = normalizeLabel(entry.label)
    if (!label || labels.has(labelKey(label))) continue
    const id = String(entry.id ?? '').trim().slice(0, 64)
    if (!id || id.includes('/') || ids.has(id)) continue
    labels.add(labelKey(label))
    ids.add(id)
    values.push({ ...entry, id, label, active: entry.active !== false })
  }
  return values
}

/** Every label the org's list answers to: its stored values and every standard value. */
export function effectiveLabelKeys(definition, stored) {
  const keys = new Set((stored ?? []).map((value) => labelKey(value.label)))
  for (const value of definition.standardValues) keys.add(labelKey(value.label))
  return keys
}

/*==========================================
 * THE PLAN FOR ONE LIST
 *=========================================*/

/** The direction an org-added lead source is filed under by its label, or `null`. */
export function leadSourceGroupFor(label) {
  const text = normalizeLabel(label)
  if (/^outbound\b/i.test(text)) return 'outbound'
  if (/website form/i.test(text)) return 'inbound'
  return null
}

/**
 * What one org's list for `definition` needs. `raw` is the stored document
 * (or `undefined`), `held` every label the org's records hold for it, and
 * `groupFor` — a lead source's — the group an org-added value is filed
 * under by its label, or nothing for a list without groups.
 *
 * Answers `{ write, values, defaultValueId, kept, regrouped, added, skipped }`:
 * `write` false when the list needs nothing. `values` is the list to store —
 * the stored values as they are, regrouped where `groupFor` places an
 * ungrouped org-added one, then every held label the list does not answer
 * to, as an org-added value. An org that stored no list is written the
 * effective list it reads today — every standard value in order — with the
 * added values after, as the Fields page writes one on its first edit.
 */
export function planPicklist({ definition, raw, held, groupFor = () => null }) {
  const stored = storedValues(raw)
  const standardIds = new Set(definition.standardValues.map((value) => value.id))
  const hasGroups = definition.groups.length > 0
  const values = stored
    ? stored.map((value) => ({ ...value }))
    : definition.standardValues.map((value) => ({
        id: value.id,
        label: normalizeLabel(value.label),
        active: true,
        ...(hasGroups ? { group: value.group ?? null } : {}),
        ...(definition.meanings.length ? { meaning: value.meaning ?? null } : {}),
      }))
  const kept = []
  const regrouped = []
  for (const value of values) {
    if (standardIds.has(value.id)) {
      if (stored) kept.push(value.label)
      continue
    }
    if (!hasGroups || value.group) continue
    const group = groupFor(value.label)
    if (group && definition.groups.includes(group)) {
      value.group = group
      regrouped.push({ label: value.label, group })
    }
  }
  const known = effectiveLabelKeys(definition, values)
  const added = []
  const skipped = []
  const seen = new Set()
  for (const raw of held) {
    const label = normalizeLabel(raw)
    const key = labelKey(label)
    if (!label || known.has(key) || seen.has(key)) continue
    seen.add(key)
    // A semantic list's added value must name a meaning, which the backfill
    // cannot know, so it never adds to one; and a full list takes no more.
    if (definition.meanings.length || values.length >= PICKLIST_VALUES_MAX) {
      skipped.push(label)
      continue
    }
    const group = hasGroups ? groupFor(label) : null
    const value = {
      id: mintValueId(label, [...values.map((entry) => entry.id), ...standardIds]),
      label,
      active: true,
      ...(hasGroups ? { group: group && definition.groups.includes(group) ? group : null } : {}),
    }
    values.push(value)
    added.push({ label, group: value.group ?? null })
  }
  const defaultValueId =
    raw && typeof raw === 'object' && values.some((value) => value.id === raw.defaultValueId)
      ? raw.defaultValueId
      : null
  return {
    write: regrouped.length > 0 || added.length > 0,
    created: !stored,
    values,
    defaultValueId,
    kept,
    regrouped,
    added,
    skipped,
  }
}

/** The labels a set of records holds in `field`, top-level or in any holder's facet. */
export function heldLabels(records, field, { facet = false } = {}) {
  const labels = []
  for (const record of records) {
    const data = record?.data ?? record ?? {}
    if (facet) {
      const facets = data.facets
      if (!facets || typeof facets !== 'object' || Array.isArray(facets)) continue
      for (const holder of Object.values(facets)) {
        if (holder && typeof holder === 'object' && typeof holder[field] === 'string') {
          labels.push(holder[field])
        }
      }
    } else if (typeof data[field] === 'string') {
      labels.push(data[field])
    }
  }
  return labels
}

/** How one plan reads in the per-org report. */
export function describePlan(id, plan) {
  const lines = []
  for (const value of plan.regrouped) lines.push(`${value.label} → ${value.group}`)
  for (const value of plan.added) {
    lines.push(`${value.label} → added${value.group ? `, ${value.group}` : ', no group'}`)
  }
  for (const label of plan.skipped) lines.push(`${label} → NOT added (list full, or a meaning is required)`)
  if (!lines.length) return [`${id}: nothing to do${plan.kept.length ? ` (${plan.kept.length} standard override(s) kept)` : ''}`]
  return [`${id}${plan.created ? ' (no list stored yet — writing the effective list)' : ''}:`, ...lines.map((line) => `    ${line}`)]
}

/** The CRM object a target names → the org collection its records live in. */
export const TARGET_COLLECTIONS = {
  contact: 'contacts',
  lead: 'leads',
  company: 'companies',
  deal: 'deals',
  task: 'crmTasks',
}

/**
 * The picklists this backfill writes: Lead source (AGL-3511), and Industry
 * when the registry holds it (AGL-3514). Any other definition is left to the
 * change that registers it.
 */
export const BACKFILLED_PICKLISTS = ['leadSource', 'industry']

/**
 * The definitions to backfill out of everything the registry holds: the
 * ones named above that are registered, each read whole. A definition whose
 * standard values could not be read is refused rather than planned — with
 * none, every label any record holds would look like the org's own.
 */
export function backfilledDefinitions(definitions) {
  const chosen = []
  const refused = []
  for (const id of BACKFILLED_PICKLISTS) {
    const definition = definitions.find((entry) => entry.id === id)
    if (!definition) continue
    if (!definition.standardValues.length || !definition.targets.length) refused.push(id)
    else chosen.push(definition)
  }
  return { chosen, refused }
}
