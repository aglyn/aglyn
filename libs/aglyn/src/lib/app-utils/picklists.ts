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

/*==========================================
 * PICKLISTS — a field whose choices an admin keeps.
 *
 * The engine under every standard picklist a plugin declares (AGL-3510).
 * It knows nothing of the records that hold the values; a plugin names its
 * picklists in a registry of its own, each one a {@link PicklistSpec}, and
 * asks this module what the effective list is, whether a write may store a
 * value, and what a select offers.
 *
 * ## Standard values are built in
 *
 * A spec ships STANDARD values that every organization has whether or not
 * it ever stored a list. An admin may relabel, reorder, deactivate, regroup
 * or make one the default — all of which is stored under the standard
 * value's own id — but never delete it, and the organization ADDS its own
 * values beside them. Whether a value is standard is computed from its id
 * every time it is asked (see {@link isStandardPicklistValueId}); nothing a
 * stored document says about it is believed.
 *
 * ## The effective list
 *
 * The stored values in their stored order, then every standard value the
 * document does not hold, appended active in the spec's order. A stored
 * value whose id is a standard id IS that standard value, overridden. A
 * stored value that is not standard but carries a missing standard value's
 * label is adopted as it — it takes the standard id — so two values never
 * share a label. A missing standard value whose label a stored STANDARD
 * value has taken (one standard renamed onto another's name) stays out until
 * that rename is undone; labels are unique before anything else.
 *
 * ## Records store the LABEL
 *
 * Every reader compares labels by {@link picklistLabelKey} — case and
 * spacing never make a new value — and a write stores the label as the list
 * spells it. Ids key the list itself: the default, a reorder, a row.
 *=========================================*/

/** The most values one list holds — a menu, not a table. */
export const PICKLIST_VALUES_MAX = 200

/** The longest label a value carries. */
export const PICKLIST_LABEL_MAX = 120

/** One value of a list. `id` never changes; `label` is what records store. */
export interface PicklistValue {
  id: string
  label: string
  active: boolean
  /**
   * The group the value is listed under, by group id; `null` for none.
   * Present only on a list whose spec has groups.
   */
  group?: string | null
  /**
   * What the value MEANS to the platform, from the spec's `meanings`;
   * `null` for an added value that names none. Present only on a list whose
   * spec has meanings, and fixed by the spec for a standard value.
   */
  meaning?: string | null
}

/** A list as stored and as every reader takes it. */
export interface PicklistValueSet {
  /** In the order every picker lists them. */
  values: PicklistValue[]
  /** The value a new record starts with, by id — `null` for none. */
  defaultValueId: string | null
}

/** One value a spec ships to every organization. */
export interface PicklistStandardValue {
  id: string
  label: string
  group?: string
  meaning?: string
}

/** One heading values may be listed under. */
export interface PicklistGroup {
  id: string
  label: string
}

/** What the engine needs to know of a picklist. */
export interface PicklistSpec {
  /**
   * A restricted list refuses a write naming a value it does not hold; an
   * unrestricted one stores it as typed.
   */
  restricted: boolean
  /** The values every organization has, in their starting order. */
  standardValues: readonly PicklistStandardValue[]
  /** The value a new record starts with while the organization has stored no list. */
  defaultValueId?: string
  /** The headings values are listed under, in order; ungrouped values come last. */
  groups?: readonly PicklistGroup[]
  /**
   * The platform's own vocabulary for what a value means, when it has one.
   * Every value carries one of these or `null`, and a value deleted with a
   * replacement moves its records only to a value of the SAME meaning.
   */
  meanings?: readonly string[]
}

/** A label as a list stores it: trimmed, single-spaced, capped. */
export function normalizePicklistLabel(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, PICKLIST_LABEL_MAX)
}

/** The key two labels are compared by: case and spacing do not make a new value. */
export function picklistLabelKey(label: unknown): string {
  return normalizePicklistLabel(label).toLowerCase()
}

/**
 * A new value's id: the label as a slug, suffixed until it is not one of
 * `taken`. Derived rather than random so a list reads the same in every
 * organization, and never reused, because a default names a value by it.
 * A caller minting an ADDED value counts every standard id as taken, so an
 * added value can never be mistaken for a standard one.
 */
export function mintPicklistValueId(label: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const base =
    normalizePicklistLabel(label)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'value'
  let id = base
  for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`
  return id
}

/** A list of active values from labels, in order, with no default. */
export function picklistFromLabels(labels: readonly string[]): PicklistValueSet {
  const values: PicklistValue[] = []
  const seen = new Set<string>()
  for (const raw of labels) {
    const label = normalizePicklistLabel(raw)
    if (!label || seen.has(picklistLabelKey(label))) continue
    seen.add(picklistLabelKey(label))
    values.push({ id: mintPicklistValueId(label, values.map((value) => value.id)), label, active: true })
  }
  return { values: values.slice(0, PICKLIST_VALUES_MAX), defaultValueId: null }
}

/** The standard value an id names under `spec`, or `null`. */
export function picklistStandardValue(
  spec: PicklistSpec,
  id: string | null | undefined,
): PicklistStandardValue | null {
  return spec.standardValues.find((value) => value.id === id) ?? null
}

/** Whether `id` is one of the spec's standard values — computed, never stored. */
export function isStandardPicklistValueId(spec: PicklistSpec, id: string | null | undefined): boolean {
  return picklistStandardValue(spec, id) !== null
}

/** A group id the spec knows, or `null`. */
function knownGroup(spec: PicklistSpec, value: unknown): string | null {
  return typeof value === 'string' && spec.groups?.some((group) => group.id === value)
    ? value
    : null
}

/** A meaning the spec knows, or `null`. */
function knownMeaning(spec: PicklistSpec, value: unknown): string | null {
  return typeof value === 'string' && spec.meanings?.includes(value) ? value : null
}

/**
 * The spec-dependent fields of one value: its group and its meaning, each
 * present only when the spec has them. A standard value's meaning is the
 * spec's whatever was stored; its group is the stored one when the document
 * names one (`null` included — an admin may ungroup it), else the spec's.
 */
function specFields(
  spec: PicklistSpec | undefined,
  id: string,
  entry: Record<string, unknown>,
): Pick<PicklistValue, 'group' | 'meaning'> {
  if (!spec) return {}
  const standard = picklistStandardValue(spec, id)
  const fields: Pick<PicklistValue, 'group' | 'meaning'> = {}
  if (spec.groups?.length) {
    fields.group =
      'group' in entry ? knownGroup(spec, entry['group']) : knownGroup(spec, standard?.group)
  }
  if (spec.meanings?.length) {
    fields.meaning = standard ? knownMeaning(spec, standard.meaning) : knownMeaning(spec, entry['meaning'])
  }
  return fields
}

/**
 * A stored document as a list, or `null` for one that holds none.
 *
 * Tolerant, because the document is client-written: a value with no label
 * is dropped, a second value with the same label (in any case) or the same
 * id is dropped, `active` is true unless it is `false`, and a default that
 * names no value is no default. With a `spec`, each value's group and
 * meaning are read against it as well.
 */
export function normalizePicklistValueSet(
  raw: unknown,
  spec?: PicklistSpec,
): PicklistValueSet | null {
  if (!raw || typeof raw !== 'object') return null
  const stored = raw as Record<string, unknown>
  if (!Array.isArray(stored['values'])) return null
  const values: PicklistValue[] = []
  const labels = new Set<string>()
  const ids = new Set<string>()
  for (const entry of stored['values']) {
    if (!entry || typeof entry !== 'object') continue
    const value = entry as Record<string, unknown>
    const label = normalizePicklistLabel(value['label'])
    if (!label || labels.has(picklistLabelKey(label))) continue
    let id = String(value['id'] ?? '').trim().slice(0, 64)
    if (!id || id.includes('/') || ids.has(id)) {
      id = mintPicklistValueId(label, [...ids, ...(spec?.standardValues.map((entry) => entry.id) ?? [])])
    }
    labels.add(picklistLabelKey(label))
    ids.add(id)
    values.push({ id, label, active: value['active'] !== false, ...specFields(spec, id, value) })
    if (values.length >= PICKLIST_VALUES_MAX) break
  }
  const defaultId = String(stored['defaultValueId'] ?? '')
  return {
    values,
    defaultValueId: ids.has(defaultId) ? defaultId : null,
  }
}

/**
 * The effective list: `stored` (already normalized against `spec`) with
 * every standard value it lacks — see the block header. `null` for an
 * organization that stored nothing answers the standard values in order,
 * with the spec's default.
 */
export function mergePicklistStandard(
  spec: PicklistSpec,
  stored: PicklistValueSet | null,
): PicklistValueSet {
  const values: PicklistValue[] = stored ? stored.values.map((value) => ({ ...value })) : []
  let defaultValueId = stored ? stored.defaultValueId : (spec.defaultValueId ?? null)
  for (const standard of spec.standardValues) {
    if (values.some((value) => value.id === standard.id)) continue
    const key = picklistLabelKey(standard.label)
    const holder = values.find((value) => picklistLabelKey(value.label) === key)
    if (holder) {
      if (isStandardPicklistValueId(spec, holder.id)) continue
      if (defaultValueId === holder.id) defaultValueId = standard.id
      holder.id = standard.id
      if (spec.meanings?.length) holder.meaning = knownMeaning(spec, standard.meaning)
      continue
    }
    values.push({
      id: standard.id,
      label: normalizePicklistLabel(standard.label),
      active: true,
      ...specFields(spec, standard.id, {}),
    })
  }
  return {
    values,
    defaultValueId: values.some((value) => value.id === defaultValueId) ? defaultValueId : null,
  }
}

/** A stored document as every reader should take it under `spec`. */
export function effectivePicklistValueSet(spec: PicklistSpec, raw: unknown): PicklistValueSet {
  return mergePicklistStandard(spec, normalizePicklistValueSet(raw, spec))
}

/** The value a label names, in any case or spacing — `null` for none. */
export function picklistValueByLabel(set: PicklistValueSet, label: unknown): PicklistValue | null {
  const key = picklistLabelKey(label)
  if (!key) return null
  return set.values.find((value) => picklistLabelKey(value.label) === key) ?? null
}

/** The values a picker offers. */
export function picklistActiveValues(set: PicklistValueSet): PicklistValue[] {
  return set.values.filter((value) => value.active)
}

/** The label a new record starts with — only while the default value is active. */
export function picklistDefaultLabel(set: PicklistValueSet): string | null {
  const value = set.values.find((entry) => entry.id === set.defaultValueId)
  return value?.active ? value.label : null
}

/**
 * The sentence a value outside a restricted list is refused with, naming
 * what the list allows: `{field} must be one of: …`. A long list is cut at
 * twenty names so the sentence stays one a person can read; `empty` is the
 * sentence for a list with no active value at all.
 */
export function picklistRefusalSentence(
  set: PicklistValueSet,
  words: { field: string; empty: string },
): string {
  const active = picklistActiveValues(set).map((value) => value.label)
  if (!active.length) return words.empty
  const shown = active.slice(0, 20).join(', ')
  const more = active.length > 20 ? `, and ${active.length - 20} more` : ''
  return `${words.field} must be one of: ${shown}${more}.`
}

/** What a judged write stores, or why it is refused. */
export type PicklistJudgement = { ok: true; value: string | null } | { ok: false; error: string }

/**
 * Whether a write may store `value` on a record, and the label it stores.
 *
 *  - Blank or `null` clears the field.
 *  - An ACTIVE value, in any case or spacing, stores that value's label.
 *  - The record's `current` value is kept even when it is inactive or no
 *    longer listed: re-saving a record must never be refused for a value
 *    somebody else deactivated.
 *  - On an unrestricted list anything else is stored — as the list spells
 *    it when the list holds it, else as typed.
 *  - On a restricted list anything else is refused with `refusal()`.
 */
export function judgePicklistValue(
  set: PicklistValueSet,
  value: unknown,
  options: { restricted: boolean; current?: unknown; refusal: () => string },
): PicklistJudgement {
  const label = normalizePicklistLabel(value)
  if (!label) return { ok: true, value: null }
  const held = normalizePicklistLabel(options.current)
  if (held && picklistLabelKey(held) === picklistLabelKey(label)) return { ok: true, value: held }
  const match = picklistValueByLabel(set, label)
  if (match?.active) return { ok: true, value: match.label }
  if (!options.restricted) return { ok: true, value: match?.label ?? label }
  return { ok: false, error: options.refusal() }
}

/** One option of a select over a list. */
export interface PicklistOption {
  label: string
  /** Listed but deactivated — shown with an "(inactive)" hint. */
  inactive: boolean
  /** Not in the list at all — a value written before the list held it. */
  unlisted: boolean
  /** The group it is listed under, when the list has groups; `null` for none. */
  group?: string | null
}

/**
 * What a select offers for a record holding `current`: every active value
 * in order, then the record's own value when the list would not otherwise
 * show it, so the select keeps what the record holds until it is changed.
 */
export function picklistOptions(set: PicklistValueSet, current?: unknown): PicklistOption[] {
  const option = (value: PicklistValue, inactive: boolean): PicklistOption => ({
    label: value.label,
    inactive,
    unlisted: false,
    ...(value.group !== undefined ? { group: value.group } : {}),
  })
  const options = picklistActiveValues(set).map((value) => option(value, false))
  const held = normalizePicklistLabel(current)
  if (held && !options.some((entry) => picklistLabelKey(entry.label) === picklistLabelKey(held))) {
    const listed = picklistValueByLabel(set, held)
    // The record's own spelling, so the select finds the option it holds.
    options.push(
      listed
        ? { ...option(listed, true), label: held }
        : { label: held, inactive: false, unlisted: true },
    )
  }
  return options
}

/** One heading of a grouped select and the options under it; `group` null is the ungrouped tail. */
export interface PicklistOptionGroup {
  group: PicklistGroup | null
  options: PicklistOption[]
}

/**
 * Options under their headings: each group in the spec's order, then every
 * option with no group (or an unknown one) last. A heading with no option
 * is left out, and the list's own order holds within each.
 */
export function groupPicklistOptions(
  options: readonly PicklistOption[],
  groups: readonly PicklistGroup[],
): PicklistOptionGroup[] {
  const known = new Set(groups.map((group) => group.id))
  const sections: PicklistOptionGroup[] = groups.map((group) => ({
    group,
    options: options.filter((option) => option.group === group.id),
  }))
  sections.push({
    group: null,
    options: options.filter((option) => !option.group || !known.has(option.group)),
  })
  return sections.filter((section) => section.options.length > 0)
}

/**
 * Where a label sorts: its value's position in the list, unlisted values
 * after every listed one, and a record with none last. The order the admin
 * chose is the order a sort by the field reads in.
 */
export function picklistRank(set: PicklistValueSet, label: unknown): number {
  const key = picklistLabelKey(label)
  if (!key) return Number.MAX_SAFE_INTEGER
  const at = set.values.findIndex((value) => picklistLabelKey(value.label) === key)
  return at < 0 ? PICKLIST_VALUES_MAX : at
}
