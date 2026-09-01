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
import type { PlacementKind } from './compose-reusable-components'

/**
 * The `componentId` of the node that RENDERS a form, and of the node that
 * renders one of its fields.
 *
 * Persisted in screen, layout, component and form documents — never rename.
 * Restated as constants because the walkers below, the promotion route and the
 * graft all have to name the same two ids, and a copy that drifted would read
 * as "this page has no form" rather than as an error.
 */
export const FORM_COMPONENT_ID = 'form'
export const FORM_FIELD_COMPONENT_ID = 'formField'

/**
 * The prop on a `form` node naming the entity it is a placement OF.
 *
 * Persisted in screen documents — never rename.
 */
export const FORM_ID_PROP = 'formId'

/**
 * How many forms one query for a site's catalog reads.
 *
 * ⛔ **NOT the allowance.** How many forms a site may hold is
 * `PLAN_ENTITLEMENTS[plan].formsPerHost`, enforced at creation through
 * `checkQuota` in `/api/hosts/resources`. A surface that shows a customer
 * their ceiling MUST read that entitlement — this number is larger, so
 * reading it instead overstates the cap on every plan.
 *
 * What this bounds is a READ. `hosts/{hostId}/forms` is small enough to list
 * in one page, and the listing surfaces (the submissions filter, the entity
 * picker) say so — but a bound below the allowance would make them silently
 * drop forms the customer made and can see elsewhere, which is the invisible
 * half of a wrong limit and the expensive one to discover.
 *
 * So it sits at or above every per-plan allowance, with headroom for the
 * catalogs that legitimately exceed one: a per-org contract override, and any
 * site that built past a ceiling before it was lowered. `forms.spec.ts` pins
 * that relationship rather than trusting the two numbers to be moved
 * together. A catalog past even this needs real pagination, not a larger
 * constant.
 */
export const FORMS_MAX_PER_HOST = 1000

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
export interface FormDocument<N = AglynNodeSchema> {
  displayName: string
  slug: string
  fields: FormFieldDecl[]
  /** Names the entry in `fields` that IS the marketing opt-in. */
  consentFieldName?: string
  routing?: FormRouting
  legacyMatch?: FormLegacyMatch
  stats?: FormStats
  archivedAt?: unknown
  /*
   * ── THE DESIGN ───────────────────────────────────────────────────────────
   *
   * A form is authored in the besigner, so it carries a node tree and version
   * history exactly as `AglynHostComponent` does, and for the same reason it
   * is stored the same way: `rootId` and `nodes` here are the PUBLISHED
   * snapshot, while the working draft lives compressed in
   * `hosts/{hostId}/forms/{formId}/versions/{versionId}`.
   *
   * The asymmetry is deliberate and copied rather than reinvented. Every
   * placed form has to resolve on the hot path of a published page render, so
   * the published tree stays on the parent document where one collection
   * query reaches all of them; moving it into the version docs would turn
   * that query into N+1 (AGL-679).
   */
  rootId?: NodeId
  nodes?: Record<NodeId, N>
  /**
   * Which version is published.
   *
   * The same pointer `AglynHostComponent.versionId` is, including the rule
   * that only a publisher may move it — the rules block denies an author the
   * `versionId` key for components and this document is governed the same way.
   */
  versionId?: string
}

/**
 * One entry in a form's `versions` subcollection.
 *
 * The draft the besigner writes on every save. `nodes` arrives compressed
 * through the client converter, exactly as a component version's does, so
 * this declares the decompressed shape the hook hands back.
 */
export interface FormVersion<N = AglynNodeSchema> {
  formId: string
  hostId?: string
  displayName?: string
  rootId?: NodeId
  nodes?: Record<NodeId, N>
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
  /**
   * Form views, counted by the beacon at `/api/analytics/collect` — one per
   * rendered form on a live page, the same shape and the same cost as an
   * overlay impression.
   *
   * ⚠️ A CLIENT-SIDE COUNT, and every rate over it inherits that. A blocked
   * beacon, a browser that never runs the script and a crawler that renders
   * nothing are all views this does not hold, while `submissions` is counted
   * on the server and holds every one. So a completion rate over this can
   * legitimately exceed 100%, and it is reported rather than clamped: a
   * number capped at a round 100% looks like a measurement of a full house.
   */
  views?: number
  /** Forms a visitor typed into: one per form instance, on the first edit. */
  starts?: number
  /**
   * The same four counters, per calendar month.
   *
   * The series the detail surface draws, and — more importantly — what makes
   * a rate over `views` honest. The lifetime totals cannot be divided into
   * each other: `submissions` has counted since the form entity existed and
   * `views` only since the beacon shipped, so a lifetime completion rate
   * would divide a long history by a short one. {@link formStatsWindow} takes
   * every rate over the months that carry BOTH counters.
   *
   * Bounded by the calendar: twelve keys a year on a document with a megabyte
   * to spend. Keys are `submissionMonthKey()` — the SAME function the
   * site-wide counter and the abuse ceiling are keyed by, imported rather
   * than restated, because a differently-derived month key reads zero on
   * exactly the months it disagrees about.
   */
  periods?: Record<string, FormPeriodStats>
}

/** One month of {@link FormStats}. Every field absent until first written. */
export interface FormPeriodStats {
  submissions?: number
  leads?: number
  views?: number
  starts?: number
}

/** The counters {@link FormPeriodStats} carries, in reading order. */
export type FormStatKind = 'views' | 'starts' | 'submissions' | 'leads'

export const FORM_STAT_KINDS: readonly FormStatKind[] = [
  'views',
  'starts',
  'submissions',
  'leads',
] as const

/** One month of a form's history, with every counter resolved to a number. */
export interface FormPeriodPoint extends Record<FormStatKind, number> {
  /** `YYYY-MM`. */
  period: string
}

/** The next month after `period`, or `null` for a key that is not one. */
function nextPeriod(period: string): string | null {
  const match = /^(\d{4})-(\d{2})$/.exec(period)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  return month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, '0')}`
}

/**
 * A form's history as a dense month series, from the first month anything was
 * recorded to the last.
 *
 * ⛔ THE SERIES NEVER STARTS BEFORE THE COUNTER DID. A month with no key is
 * two different facts — "nothing happened" and "nothing was counted yet" —
 * and they are told apart by WHERE the month falls: inside the recorded range
 * an absent key is a true zero, because the counter was live and wrote
 * nothing; before it, there is no measurement to draw and the series simply
 * does not extend there. Padding to a fixed twelve months would render the
 * form's pre-counter history as a row of confident zeros.
 *
 * Interior gaps ARE filled, at zero, so a quiet month reads as a quiet month
 * rather than closing up and making two distant months look adjacent.
 *
 * @param stats - the stored counters, or nothing.
 * @param maxPeriods - how many of the most recent months to return.
 * @returns oldest first, so a chart reads left to right. Empty when nothing
 *          has ever been recorded.
 */
export function formPeriodSeries(
  stats: FormStats | undefined | null,
  maxPeriods = 12,
): FormPeriodPoint[] {
  const periods = stats?.periods
  if (!periods) return []
  const keys = Object.keys(periods)
    .filter((key) => /^\d{4}-(0[1-9]|1[0-2])$/.test(key))
    .sort()
  if (!keys.length) return []
  const series: FormPeriodPoint[] = []
  const last = keys[keys.length - 1]
  let cursor: string | null = keys[0]
  // Bounded by the span rather than by a `while (true)`: a stored key far in
  // the future would otherwise walk the calendar forever.
  for (let step = 0; cursor && step <= 1200; step += 1) {
    const month = periods[cursor] ?? {}
    series.push({
      period: cursor,
      views: Number(month.views ?? 0),
      starts: Number(month.starts ?? 0),
      submissions: Number(month.submissions ?? 0),
      leads: Number(month.leads ?? 0),
    })
    if (cursor === last) break
    cursor = nextPeriod(cursor)
  }
  return maxPeriods > 0 && series.length > maxPeriods
    ? series.slice(series.length - maxPeriods)
    : series
}

/** Two counters summed over the months where the FIRST of them was recorded. */
export interface FormStatsWindow {
  /** Months the window covers. Zero means no rate can be taken. */
  periods: number
  /** The counter the window is defined by, summed over those months. */
  over: number
  /** The other counter, summed over the SAME months. */
  of: number
}

/**
 * Sum `of` and `over` across exactly the months in which `over` was recorded.
 *
 * This is what stops a rate being a lie of arithmetic. `views` began being
 * counted the day the beacon shipped and `submissions` has counted since the
 * form entity existed, so dividing the lifetime totals answers "submissions
 * ever, over views since Tuesday" — a number that is not wrong by a little.
 *
 * A month is IN the window when it carries a non-zero `over`, not merely a
 * key: a month the beacon never reported is not a month with no views, it is
 * a month with no measurement, and including it would deflate every rate
 * taken over the window by however long the counter was dark.
 *
 * @returns `periods: 0` when nothing qualifies, which every caller must
 *          render as a dash rather than as a zero rate.
 */
export function formStatsWindow(
  stats: FormStats | undefined | null,
  over: FormStatKind,
  of: FormStatKind,
): FormStatsWindow {
  const window: FormStatsWindow = { periods: 0, over: 0, of: 0 }
  for (const month of Object.values(stats?.periods ?? {})) {
    const denominator = Number(month?.[over] ?? 0)
    if (!Number.isFinite(denominator) || denominator <= 0) continue
    window.periods += 1
    window.over += denominator
    const numerator = Number(month?.[of] ?? 0)
    if (Number.isFinite(numerator)) window.of += numerator
  }
  return window
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
  formFieldComponentId = FORM_FIELD_COMPONENT_ID,
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
  formFieldComponentId = FORM_FIELD_COMPONENT_ID,
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
  const formComponentId = ids.form ?? FORM_COMPONENT_ID
  const formFieldComponentId = ids.formField ?? FORM_FIELD_COMPONENT_ID
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
 * A form entity's published design, in the shape the graft consumes: the
 * `rootId`/`nodes` snapshot that lives on `hosts/{hostId}/forms/{formId}`.
 *
 * Structurally a component definition minus the parts a form does not have —
 * no declared props, no icon — which is why the graft can take both. It is
 * `Pick`ed off {@link FormDocument} rather than restated so the storage
 * contract stays the single description of what is written there.
 */
export type PlacedFormDesign<N = AglynNodeSchema> = Required<
  Pick<FormDocument<N>, 'rootId' | 'nodes'>
>

/**
 * Whether any node in this map PLACES a form entity (as opposed to merely
 * drawing an unbound form inline).
 *
 * The cost gate in front of the forms read, and cheap on purpose: one scan of
 * a map the caller already holds, against a read that is a whole collection
 * query. Most pages carry no form at all, and a page whose form nodes are all
 * unbound has nothing an entity could contribute — either way there is nothing
 * for the graft to resolve, so the query buys nothing.
 *
 * Says nothing about whether the named form EXISTS or is published; that is
 * settled by the graft, against documents this cannot see.
 */
export function placesFormEntity(
  nodes: Record<NodeId, AglynNodeSchema | undefined> | undefined | null,
): boolean {
  for (const node of Object.values(nodes ?? {})) {
    if (node?.componentId !== FORM_COMPONENT_ID) continue
    const formId = (node.props as Record<string, unknown> | undefined)?.[
      FORM_ID_PROP
    ]
    if (typeof formId === 'string' && formId.trim()) return true
  }
  return false
}

/**
 * Whether any node in this map places THIS form.
 *
 * The per-id half of {@link placesFormEntity}, and the predicate a usage scan
 * asks of a screen, a layout or a component definition. Deliberately the same
 * reader the graft resolves against: a scan that disagreed about what counts
 * as a placement would drop the caches of the wrong pages, and the pages it
 * missed would serve the old form for the whole revalidate window with nothing
 * recording that they were skipped.
 */
export function nodesPlaceForm(
  nodes: Record<NodeId, AglynNodeSchema | undefined> | undefined | null,
  formId: string,
): boolean {
  if (!formId) return false
  for (const node of Object.values(nodes ?? {})) {
    if (node?.componentId !== FORM_COMPONENT_ID) continue
    const bound = (node.props as Record<string, unknown> | undefined)?.[
      FORM_ID_PROP
    ]
    if (typeof bound === 'string' && bound.trim() === formId) return true
  }
  return false
}

/**
 * The placement kind that makes a placed form render its ENTITY'S design.
 *
 * Until this existed the entity's tree was written on every publish and read
 * by nothing: a form's fields had to be redrawn on each page that placed it,
 * and editing the form propagated nowhere. The two documents disagreed the
 * moment either changed, and the page always won.
 *
 * `replacesAuthoredChildren` is what makes that propagation real, and it is
 * the reason the resolution rule is strict. The rule, stated once:
 *
 * - Entity has a published design → the entity's fields ARE the form. Whatever
 *   the page drew inside the form node is discarded, exactly as a reusable
 *   instance's child list is replaced by its definition's. This is what "edit
 *   the form once" means; a merge would render a page's stale copy of a field
 *   beside the entity's current one.
 * - Entity has no published design, is archived away, or the `formId` names
 *   nothing → the form node is left completely alone, inline fields included.
 *   Every form built before the entity existed is in this state, so this is
 *   the branch that keeps the live site rendering exactly what it renders
 *   today.
 *
 * A deleted or unpublished entity therefore degrades to the page's own copy
 * rather than to an empty form — the same fail-open posture the component
 * graft takes for an unresolvable `refId`, and for the same reason: a
 * document going missing must not take a published page's content with it.
 *
 * The discard is a COMPOSE-time one, so it takes nothing away permanently:
 * the page's fields stay in its document, and clearing the binding brings
 * them straight back. That is what makes binding an existing hand-built form
 * to an entity a reversible act rather than a destructive one.
 */
export function placedFormPlacement<N extends AglynNodeSchema = AglynNodeSchema>(
  formsById: Record<string, PlacedFormDesign<N> | undefined> | undefined,
): PlacementKind<N> {
  return {
    componentId: FORM_COMPONENT_ID,
    refProp: FORM_ID_PROP,
    definitionsById: formsById,
    replacesAuthoredChildren: true,
  }
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
