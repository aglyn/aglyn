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
 * The form entity: what a form IS, separately from the shape an author drew.
 *
 * `docs/specs/reusable-forms.md` §2. Before this module a form's whole
 * identity was `formName` — the free-text caption an author typed into an
 * inspector field, copied onto each submission at write time and reconciled
 * with nothing. Renaming a form split its history; two pages sharing a label
 * were one list. A document at `hosts/{hostId}/forms/{formId}` is the identity
 * those surfaces were reading a caption in place of.
 *
 * Pure and dependency-free on purpose. This barrel reaches client bundles
 * through `app-utils/index`, so nothing here may import a Node builtin — the
 * constraint that holds `personKey` in its own module one directory over.
 * Everything that needs Firestore or `node:crypto` lives at the call sites.
 */

import type { AglynNodeSchema, NodeId } from '../foundation/definitions/components.types'

/**
 * How many forms one site may hold.
 *
 * A FLAT platform ceiling, not a plan dimension, and deliberately so.
 * `docs/DECISION_LOG.md`'s 2026-08-23 entry settled this instrument for the
 * member/lead ceilings in the account owner's own words — an abuse control is
 * not something we sell — and a numeric `formsPerHost` would instead be a
 * six-place packaging move under the Sept-1 price lock, carrying a Decision
 * Log entry, a feature-matrix row and a console odometer with it.
 *
 * Access to forms rides the `reusableComponents` entitlement, which is already
 * Starter-and-above, already server-enforced at `/api/hosts/resources`, and
 * already on the published feature matrix. This number is only the bound that
 * stops one site holding an unreasonable number of them.
 *
 * Generous against the real shape of the artifact: a site with fifty distinct
 * forms has fifty distinct intake purposes, which is far past the point where
 * the reuse engine is the answer instead.
 */
export const FORMS_MAX_PER_HOST = 50

/** Field types a `FormField` node offers; the form declares the same set. */
export type FormFieldType =
  | 'text'
  | 'email'
  | 'textarea'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'rating'

/**
 * What a declared field MEANS, where the meaning is one the platform reads.
 *
 * The Inbox guesses today: `submission-presenter.ts` matches reduced field
 * keys against a convention list, which is why a survey whose fields are
 * `q1`…`q9` renders "Someone" on every row. A declared role is the author
 * saying which field is the address instead of the platform inferring it from
 * a name that was never a contract.
 */
export type FormFieldRole = 'name' | 'email' | 'phone' | 'consent'

/** One field of a form, as the form declares it. */
export interface FormFieldDecl {
  /** THE submission key — matches the node's `fieldName` prop, not `label`. */
  fieldName: string
  label?: string
  fieldType: FormFieldType
  required?: boolean
  options?: string[]
  /** Stable dataset model fieldId this value is stored under (AGL-556). */
  datasetFieldId?: string
  role?: FormFieldRole
}

/** Where a submission goes beyond the Inbox. */
export interface FormRouting {
  datasetId?: string
  /** Whether a submission carrying an address also becomes a lead. */
  lead?: boolean
}

/**
 * What an adopted form claims of the history that predates it.
 *
 * Recorded at adoption from what was ACTUALLY written on the submissions —
 * the caption and the page path — because those two fields are the whole of
 * what a pre-entity submission carries. Read only by the backfill, and never
 * by a live query: the live filter is an equality on `formId`.
 */
export interface FormLegacyMatch {
  formName: string
  paths: string[]
}

/** The stored form document, minus the timestamps Firestore stamps. */
export interface FormDocument {
  displayName: string
  slug: string
  fields: FormFieldDecl[]
  /** Names the entry in `fields` that IS the marketing opt-in. */
  consentFieldName?: string
  routing?: FormRouting
  legacyMatch?: FormLegacyMatch
  stats?: FormStats
  archivedAt?: unknown
}

/**
 * Counters carried ON the form document, incremented on writes that were
 * happening anyway.
 *
 * Never derived by counting `formSubmissions`. That collection grows without
 * bound and is the one the customer is billed on; a console surface that
 * counted it on render would be the expensive-read shape this product has
 * created repeatedly. `hosts/{hostId}/overlays/{overlayId}.stats` is the same
 * pattern with the same reasoning.
 */
export interface FormStats {
  submissions?: number
  leads?: number
  lastSubmissionAtMs?: number
}

export const FORM_SLUG_MAX_LENGTH = 64
export const FORM_DISPLAY_NAME_MAX_LENGTH = 100

/**
 * A stable, url-safe handle for a form, derived from its display name.
 *
 * The slug is NOT the identity — `formId` is, and the slug is free to be
 * regenerated. It exists so a console URL and an export filename can name a
 * form in something a human recognizes without either becoming a second
 * identity the way `formName` did.
 *
 * @returns the slug, or `''` when the input reduces to nothing — a caller
 *          must fall back to the document id rather than store an empty slug.
 */
export function normalizeFormSlug(input: unknown): string {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, FORM_SLUG_MAX_LENGTH)
    .replace(/-+$/g, '')
}

const FORM_FIELD_TYPES = new Set<FormFieldType>([
  'text',
  'email',
  'textarea',
  'select',
  'radio',
  'checkbox',
  'rating',
])

/**
 * Splits a `FormField` node's newline- or comma-separated choice list.
 *
 * Restated rather than imported from `libs/plugins/mui`: this module is in the
 * foundation layer and a plugin may not be a dependency of it. The two must
 * agree, and `forms.spec.ts` asserts they do against the same inputs
 * `parseFieldOptions` is specified on.
 */
function parseDeclaredOptions(options: unknown): string[] {
  return String(options ?? '')
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

/** Child ids of a node in the stored map form, in the author's order. */
function childIdsOf(node: AglynNodeSchema | undefined): NodeId[] {
  return Array.isArray(node?.nodes) ? (node.nodes as NodeId[]) : []
}

/**
 * Every `formField` descendant of `formNodeId`, in the order the author
 * placed them.
 *
 * Depth-first pre-order, because that IS the reading order of the rendered
 * form and the order a per-form submission list wants its columns in. A
 * breadth-first walk would interleave the fields of two adjacent groups.
 *
 * Nesting between the form and its fields is arbitrary — the `Form` runtime
 * makes a point of riding the DOM precisely so it needs no React context — so
 * the walk cannot assume fields are direct children.
 *
 * Repeated and unknown ids are skipped, which bounds a cyclic document.
 */
export function collectFormFieldNodeIds(
  nodes: Record<NodeId, AglynNodeSchema | undefined> | undefined | null,
  formNodeId: NodeId,
  formFieldComponentId = 'formField',
): NodeId[] {
  if (!nodes?.[formNodeId]) return []
  const found: NodeId[] = []
  const seen = new Set<NodeId>([formNodeId])
  const stack: NodeId[] = [...childIdsOf(nodes[formNodeId])].reverse()
  while (stack.length) {
    const id = stack.pop() as NodeId
    if (seen.has(id) || !nodes[id]) continue
    seen.add(id)
    if (nodes[id]?.componentId === formFieldComponentId) found.push(id)
    // Pushed reversed so the first child is popped first — the walk is
    // pre-order, and a nested field must not overtake its own siblings.
    const children = childIdsOf(nodes[id])
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index] as NodeId)
    }
  }
  return found
}

/**
 * Reads a form's declared field list off the nodes an author already drew.
 *
 * This is the whole of what adoption has to invent, and it invents nothing:
 * `fieldName`, `fieldType`, `label`, `required`, `options` and
 * `datasetFieldId` are all already props on the `formField` nodes. A form
 * adopted from a page therefore declares exactly the form that page was
 * already submitting.
 *
 * A field with no `fieldName` is DROPPED rather than defaulted. The runtime
 * falls back to `name = fieldName || 'field'`, so several unnamed fields
 * collapse onto one submission key — declaring them would put a key in the
 * schema that does not identify a value.
 *
 * A duplicate `fieldName` keeps its FIRST occurrence, matching the submission
 * the runtime produces: `FormData` entries under one key are joined into that
 * one key, so the second node contributes no separate value.
 */
export function formFieldDeclsFromNodes(
  nodes: Record<NodeId, AglynNodeSchema | undefined> | undefined | null,
  formNodeId: NodeId,
  formFieldComponentId = 'formField',
): FormFieldDecl[] {
  const declarations: FormFieldDecl[] = []
  const claimed = new Set<string>()
  for (const id of collectFormFieldNodeIds(nodes, formNodeId, formFieldComponentId)) {
    const props = (nodes?.[id]?.props ?? {}) as Record<string, unknown>
    const fieldName = String(props['fieldName'] ?? '').trim()
    if (!fieldName || claimed.has(fieldName)) continue
    claimed.add(fieldName)
    const rawType = String(props['fieldType'] ?? 'text') as FormFieldType
    const options = parseDeclaredOptions(props['options'])
    const label = String(props['label'] ?? '').trim()
    const datasetFieldId = String(props['datasetFieldId'] ?? '').trim()
    declarations.push({
      fieldName,
      fieldType: FORM_FIELD_TYPES.has(rawType) ? rawType : 'text',
      ...(label ? { label } : {}),
      ...(props['required'] === true ? { required: true } : {}),
      ...(options.length ? { options } : {}),
      ...(datasetFieldId ? { datasetFieldId } : {}),
    })
  }
  return declarations
}

/** One `form` node found by the discovery scan, with where it was found. */
export interface DiscoveredFormNode {
  /** `screen` / `layout` / `component` — what kind of document holds it. */
  sourceKind: 'screen' | 'layout' | 'component'
  sourceId: string
  sourceName?: string
  nodeId: NodeId
  /** The caption the node carries today, normalized the way the route is. */
  formName: string
  /** Already bound, when the node carries a `formId`. */
  formId?: string
  fields: FormFieldDecl[]
}

/**
 * Finds every `form` node in one document's node map.
 *
 * The corpus and the shape are the *Used by* scan's: a flat
 * `Record<NodeId, AglynNodeSchema>` per screen, layout and component
 * definition. That scan is idle until asked, for the reason its card states
 * in full — reading every screen and every layout on mount is the
 * expensive-read shape this codebase has a standing rule against — and this
 * one inherits that posture rather than re-arguing it.
 */
export function discoverFormNodes(
  nodes: Record<NodeId, AglynNodeSchema | undefined> | undefined | null,
  source: { kind: DiscoveredFormNode['sourceKind']; id: string; name?: string },
  ids: { form?: string; formField?: string } = {},
): DiscoveredFormNode[] {
  const formComponentId = ids.form ?? 'form'
  const formFieldComponentId = ids.formField ?? 'formField'
  const found: DiscoveredFormNode[] = []
  for (const [nodeId, node] of Object.entries(nodes ?? {})) {
    if (node?.componentId !== formComponentId) continue
    const props = (node.props ?? {}) as Record<string, unknown>
    const boundId = String(props['formId'] ?? '').trim()
    found.push({
      sourceKind: source.kind,
      sourceId: source.id,
      ...(source.name ? { sourceName: source.name } : {}),
      nodeId,
      // Mirrors the runtime default: an unnamed form submits as `Form`, so
      // that is the caption its history is filed under and the one an
      // adoption has to claim.
      formName: normalizeSubmissionFormName(props['formName']),
      ...(boundId ? { formId: boundId } : {}),
      fields: formFieldDeclsFromNodes(nodes, nodeId, formFieldComponentId),
    })
  }
  return found
}

/**
 * The caption as the submit route stores it.
 *
 * Restated here so discovery and the backfill compare the same string the
 * route wrote: `String(formName ?? 'Form').slice(0, 100)`. A differently
 * derived caption on either side would make every legacy match miss, silently
 * and in the safe direction — which is the failure that looks like success.
 */
export function normalizeSubmissionFormName(value: unknown): string {
  return String(value ?? '').trim()
    ? String(value).slice(0, FORM_DISPLAY_NAME_MAX_LENGTH)
    : 'Form'
}

/** The page path as the submit route stores it. */
export function normalizeSubmissionPath(value: unknown): string {
  return String(value ?? '').slice(0, 500)
}

/** A form as the backfill sees it: an id and what it claims of the past. */
export interface LegacyMatchCandidate {
  formId: string
  legacyMatch?: FormLegacyMatch | null
}

/**
 * Which adopted form, if any, a pre-entity submission belongs to.
 *
 * ⛔ **An ambiguous submission is left UNSTAMPED, always.** The two failure
 * modes are not symmetric and the asymmetry is the whole rule:
 *
 *  - An unmatched row is still in the Inbox, still readable, still exportable
 *    over `/v1`. It is missing from ONE form's list, the Forms page says how
 *    many rows are in that state, and a later adoption can still claim it.
 *  - A wrongly stamped row is filed under a form it was never sent to. It
 *    leaves the Inbox's *Unassigned* view, joins a stranger's submission list,
 *    and nothing on any screen says it moved. It is invisible, and invisible
 *    is not recoverable.
 *
 * So the match is on the PAIR. `formName` alone is a caption two pages may
 * legitimately share — that shared caption is the defect the form entity
 * exists to fix, and using it as the migration key would carry the defect into
 * the migration. `path` is what tells two same-named forms apart, and it only
 * does so when it was distinct, so both must agree and exactly one form may
 * claim the pair.
 *
 * @returns the form id to stamp, or `null` to leave the row alone. Never a
 *          best guess.
 */
export function matchSubmissionToForm(
  submission: { formName?: unknown; path?: unknown },
  candidates: readonly LegacyMatchCandidate[],
): string | null {
  const formName = normalizeSubmissionFormName(submission.formName)
  const path = normalizeSubmissionPath(submission.path)
  // A submission that recorded no path cannot be disambiguated by one, and
  // the pair rule has nothing to stand on. Older rows genuinely predate the
  // field; they stay unstamped rather than falling back to the caption.
  if (!path) return null
  const matched = candidates.filter(
    (candidate) =>
      candidate.legacyMatch?.formName === formName &&
      Array.isArray(candidate.legacyMatch?.paths) &&
      candidate.legacyMatch.paths.includes(path),
  )
  return matched.length === 1 ? (matched[0] as LegacyMatchCandidate).formId : null
}

/**
 * The value of the declared consent field, as a marketing opt-in.
 *
 * ⛔ THE FACT OF SUBMISSION IS NOT AN OPT-IN, and a form that declares no
 * consent field produces no consent record — on any plan, at any time. This
 * reads ONE field, named by the form's own `consentFieldName`, and asks
 * whether the visitor ticked it.
 *
 * That is not in tension with the standing rule that consent is never
 * inferred: a checkbox the visitor ticked IS an explicit checkbox. What the
 * entity adds is a declared place to look, in place of the closed name list
 * the route has to fall back on when no form is bound.
 *
 * Returns `false`, never `undefined`: every writer downstream stores consent
 * absent-or-true and must never write `false` over an opt-in captured
 * elsewhere.
 */
export function readFormDeclaredConsent(
  form: { consentFieldName?: string } | null | undefined,
  fields: Record<string, unknown> | null | undefined,
): boolean {
  const fieldName = String(form?.consentFieldName ?? '').trim()
  if (!fieldName || !fields) return false
  const value = fields[fieldName]
  if (value === true) return true
  return AFFIRMATIVE_CHECKBOX_VALUES.has(
    String(value ?? '')
      .trim()
      .toLowerCase(),
  )
}

/** Checkbox values a browser form actually posts for a ticked box. */
export const AFFIRMATIVE_CHECKBOX_VALUES = new Set([
  'true',
  'on',
  'yes',
  '1',
  'checked',
])
