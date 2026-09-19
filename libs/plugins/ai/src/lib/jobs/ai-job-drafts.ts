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

import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { uniqueDuplicateName } from '@aglyn/aglyn/app-utils/duplicate-resource'
import {
  FORM_COMPONENT_ID,
  normalizeFormSlug,
  type FormFieldDecl,
  type FormRouting,
} from '@aglyn/aglyn/app-utils/forms'
import { nameSearchKey } from '@aglyn/aglyn/app-utils/name-search'
import {
  checkDatasetQuota,
  checkEntitlement,
  checkQuota,
  resolveEffectivePlan,
  resolveOrgEntitlements,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  billableScreenIds,
  normalizeScreenSlug,
  reservedScreenRouteSegment,
  SCREEN_ROOT_PATH,
} from '@aglyn/aglyn/app-utils/screen-route'
import { decodeStoredNodes, encodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import type {
  AglynOrgBilling,
  OrgFeatureFlags,
} from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import type { ReusableComponentProp } from '@aglyn/aglyn/foundation/definitions/platform.types'
import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import { resolveOrgIdForHost } from '@aglyn/tenant-data-admin/server/organizations'
import {
  aiUnrestrictedPlanCapabilities,
  type AiPlanCapabilities,
  type AiPlanCreation,
} from '../model/ai-plan-capabilities'
import type { AiJobAdmissionRefusal } from './ai-job-admission'

/**
 * Where a generation job's layout, page template, form, reusable component
 * or page lands (AGL-2909, AGL-2913, AGL-2908, AGL-2907): a new draft, made
 * as the console's host resources route makes one.
 *
 * ── The document the create route makes ─────────────────────────────────
 *
 * `AI_DRAFT_FIELDS` is that route's allow-list for each kind, and a spec
 * reads the route's source to hold the two together. Nothing outside the
 * list is written except the route's own stamps: `createdAt`, `updatedAt`,
 * `createdBy`, a screen's `nameLower`, and a template's `source`, which is
 * `authored` — a template a member's job generated is theirs, never a starter
 * or a listing. A layout's or a screen's first version carries the keys the
 * versions route seeds one with. A form is the document the Forms page's
 * Create sends: its design canvas-shaped under `rootId` with the form node
 * bound to the form's id and captioned with its name, a slug read from that
 * name, and no version — the form's page mints the first one when someone
 * opens it. Where Create sends an empty `fields`, a generated form sends the
 * declaration read off its own design, so the two agree from the start. A
 * component carries its tree and the props it declares on its own document,
 * as Use template writes one, and gets its first version where every
 * component does: when a member opens it.
 *
 * ── Counted like a create ────────────────────────────────────────────────
 *
 * The band is met INSIDE the transaction that writes (AGL-2231), with the
 * route's arithmetic: every layout document counts against
 * `sharedLayoutsPerHost`; a template counts against `templatesPerHost` when it
 * records a source other than a platform starter — the route's `!=` query,
 * which never matches a document with no `source.type` at all; a screen counts
 * against `screensPerHost` by `billableScreenIds`, over the screens and the
 * host's routing map, which counts an unrouted screen too (AGL-1445); and a
 * form needs the plan to include the route's `entitlement` first, refused in
 * the route's own words, after which every form document counts against
 * `formsPerHost`. A reusable component counts against no allowance at all:
 * the route admits one on a plan with the `reusableComponents` entitlement
 * and refuses it otherwise, and so does the writer.
 *
 * ── Applied to nothing ───────────────────────────────────────────────────
 *
 * A layout renders only around a screen or layout that names it, or as the
 * built-in page layout the host document names; a template is inert until a
 * member uses it; a form renders only where a page places it; a component
 * renders only where an instance places it, and a new one has no instance;
 * and a screen serves nothing until the host's routing map names it, which is
 * what publishing writes (`publishScreenRoute`). So the writer touches the new
 * documents and nothing else — no host document, no routing map, no
 * collection, store setting, other layout or component — and never a
 * `publishedAt` or a publish schedule. What the job hands back is a link to
 * the draft, never a binding.
 *
 * ── One draft per recorded id ────────────────────────────────────────────
 *
 * The caller names the document id: the console resource id the job recorded
 * for the draft before its first write (`ai-job-draft-ids.ts`). A step run
 * again after its draft was written — a process cut off before the machine
 * recorded the step — reads the same id, finds that draft and reports it,
 * rather than writing a second.
 */

type Firestore = FirebaseFirestore.Firestore

export type AiDraftKind = 'layout' | 'template' | 'form' | 'component' | 'screen'

/** The draft kinds that keep their tree in versions, as the besigner opens them. */
export type AiVersionedDraftKind = Extract<AiDraftKind, 'layout' | 'screen'>

/** The console host resources route's allow-list for each kind. */
export const AI_DRAFT_FIELDS: Readonly<Record<AiDraftKind, readonly string[]>> = {
  layout: ['displayName', 'description', 'versionId'],
  template: [
    'kind',
    'displayName',
    'description',
    'placeholders',
    'nodes',
    'rootId',
    'props',
    'slug',
    'seo',
  ],
  form: [
    'displayName',
    'slug',
    'fields',
    'consentFieldName',
    'routing',
    'legacyMatch',
    'rootId',
    'nodes',
  ],
  component: ['displayName', 'description', 'rootId', 'nodes', 'props'],
  // `kind` is on the route's list for the email composer; a page has none, and
  // the writer never sends one.
  screen: ['displayName', 'description', 'slug', 'seo', 'kind', 'versionId'],
}

/** The keys a layout's first version is seeded with, all on the versions route's list. */
export const AI_DRAFT_VERSION_FIELDS: readonly string[] = ['layoutId', 'hostId', 'displayName', 'nodes']

/**
 * The keys a screen's first version is seeded with, all on the versions
 * route's list: the screen it belongs to, the site, the label, the tree, and
 * the layout it renders inside when the plan names one the site has.
 */
export const AI_DRAFT_SCREEN_VERSION_FIELDS: readonly string[] = [
  'screenId',
  'hostId',
  'displayName',
  'nodes',
  'layoutId',
]

/** The label on a generated draft's first version, as on one Use template makes. */
export const AI_DRAFT_VERSION_NAME = 'Initial version'

/** The route's refusal when the site's plan does not include the kind at all. */
export const AI_DRAFT_ENTITLEMENT_REFUSAL = 'This feature is not included in your plan — see Billing'

export interface AiDraftBand {
  collection: 'layouts' | 'templates' | 'forms' | 'components' | 'screens'
  /** The allowance the route counts the kind against, where it counts one. */
  quotaKey?:
    | 'sharedLayoutsPerHost'
    | 'templatesPerHost'
    | 'formsPerHost'
    | 'screensPerHost'
  /** The feature the plan must include before any document of the kind counts. */
  entitlement?: keyof OrgFeatureFlags
  /** The route's plural label, in the refusal it gives. */
  label: string
}

/** Each kind's collection, counter, feature and label, as the create route declares them. */
export const AI_DRAFT_BANDS: Readonly<Record<AiDraftKind, AiDraftBand>> = {
  layout: { collection: 'layouts', quotaKey: 'sharedLayoutsPerHost', label: 'shared layouts' },
  template: { collection: 'templates', quotaKey: 'templatesPerHost', label: 'templates' },
  form: {
    collection: 'forms',
    quotaKey: 'formsPerHost',
    entitlement: 'reusableComponents',
    label: 'forms',
  },
  component: {
    collection: 'components',
    entitlement: 'reusableComponents',
    label: 'reusable components',
  },
  screen: { collection: 'screens', quotaKey: 'screensPerHost', label: 'screens' },
}

interface SiblingRow {
  id: string
  name: string
  slug: string
  kind: unknown
  sourceType: unknown
  deletedAt: unknown
  deleted: boolean
}

/** A host's routing map: screen id → the path it is published at. */
type RoutingMap = Record<string, unknown> | null | undefined

function draftCollection(firestore: Firestore, hostId: string, kind: AiDraftKind) {
  return firestore.collection('hosts').doc(hostId).collection(AI_DRAFT_BANDS[kind].collection)
}

/** The fields the band, the name, the address and a deletion are read from. */
function siblingsOf(collection: FirebaseFirestore.CollectionReference) {
  return collection.select('displayName', 'slug', 'kind', 'source.type', 'deletedAt')
}

function siblingRows(snapshot: FirebaseFirestore.QuerySnapshot): SiblingRow[] {
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    name: String(doc.get('displayName') ?? ''),
    slug: String(doc.get('slug') ?? ''),
    kind: doc.get('kind'),
    sourceType: doc.get('source.type'),
    deletedAt: doc.get('deletedAt'),
    deleted: doc.get('deletedAt') != null,
  }))
}

function subdomainOf(host: FirebaseFirestore.DocumentSnapshot): string | null {
  const subdomain = host.get('subdomain')
  return typeof subdomain === 'string' && subdomain ? subdomain : null
}

/**
 * The route's refusal when the site's plan does not include the kind, or
 * holds no more of it; `null` while it does. The feature is asked first, as
 * the route asks it before it counts.
 */
export function aiDraftBandRefusal(
  kind: AiDraftKind,
  rows: ReadonlyArray<Pick<SiblingRow, 'id' | 'kind' | 'sourceType' | 'deletedAt'>>,
  org: Partial<AglynOrgBilling> | null,
  routingMap?: RoutingMap,
): string | null {
  const band = AI_DRAFT_BANDS[kind]
  if (band.entitlement && !checkEntitlement(org, band.entitlement)) {
    return AI_DRAFT_ENTITLEMENT_REFUSAL
  }
  if (!band.quotaKey) return null
  const used =
    kind === 'template'
      ? rows.filter((row) => row.sourceType !== undefined && row.sourceType !== 'starter').length
      : kind === 'screen'
        ? billableScreenIds(
            rows.map((row) => ({ id: row.id, kind: row.kind, deletedAt: row.deletedAt })),
            (routingMap ?? undefined) as never,
          ).size
        : rows.length
  const quota = checkQuota(org, band.quotaKey, used)
  return quota.allowed
    ? null
    : `Your plan includes ${quota.limit} ${band.label} — upgrade in Billing for more`
}

/** The draft kinds a plan's creations land as, whose band a plan is told about (AGL-3030). */
const AI_PLAN_DRAFT_KINDS = ['component', 'form', 'layout', 'template'] as const

type AiPlanDraftKind = (typeof AI_PLAN_DRAFT_KINDS)[number]

/** Every draft kind's plural label made singular, for a band of one. */
function bandLabel(label: string, count: number): string {
  return count === 1 ? label.replace(/s$/, '') : label
}

/**
 * Whether the site may take `used + 1` of a kind, in the create route's
 * arithmetic: the feature first, then the allowance. `null` for a kind whose
 * allowance is unlimited or counts nothing, which needs no rows read.
 */
function planCreation(
  kind: AiPlanDraftKind,
  org: Partial<AglynOrgBilling> | null,
  rows: ReadonlyArray<Pick<SiblingRow, 'id' | 'kind' | 'sourceType' | 'deletedAt'>> | null,
): AiPlanCreation {
  const band = AI_DRAFT_BANDS[kind]
  if (band.entitlement && !checkEntitlement(org, band.entitlement)) {
    return {
      allowed: false,
      left: 0,
      reason: `this workspace's plan does not include ${kind === 'form' ? 'saved forms' : band.label}`,
    }
  }
  const limit = band.quotaKey ? resolveOrgEntitlements(org)[band.quotaKey] : Number.POSITIVE_INFINITY
  if (!rows || !Number.isFinite(limit)) return { allowed: true, left: null, reason: null }
  // The route's own arithmetic decides; the count beside it is what is left.
  const refusal = aiDraftBandRefusal(kind, rows, org)
  const used =
    kind === 'template'
      ? rows.filter((row) => row.sourceType !== undefined && row.sourceType !== 'starter').length
      : rows.length
  return refusal
    ? {
        allowed: false,
        left: 0,
        reason: `this site already holds the ${limit} ${bandLabel(band.label, limit)} its plan includes`,
      }
    : { allowed: true, left: Math.max(0, limit - used), reason: null }
}

/** Whether a kind's rows are counted at all on this plan: included, and under a finite allowance. */
function countsRows(kind: AiPlanDraftKind, org: Partial<AglynOrgBilling> | null): boolean {
  const band = AI_DRAFT_BANDS[kind]
  if (!band.quotaKey) return false
  if (band.entitlement && !checkEntitlement(org, band.entitlement)) return false
  return Number.isFinite(resolveOrgEntitlements(org)[band.quotaKey])
}

/**
 * What a plan may create on this site (AGL-3030), from the workspace's plan
 * and the rows each counted kind already holds — pure, so the specs and the
 * eval harness hold the arithmetic without a Firestore. A kind whose rows
 * are not given is counted as having room, which is what an unlimited
 * allowance means.
 *
 * A theme change is a proposal a member applies, never a draft, so it counts
 * against nothing. A dataset is org data that no job writes; a plan may name
 * one only where the workspace's plan includes datasets at all. An email
 * design is written by the email plugin, whose own gate decides.
 *
 * A workspace on the Free plan spends the Free taste, a wall of monthly
 * credits, so its plan is held to the sections that wall pays for (AGL-3070).
 * The effective plan decides, as it decides the taste's own allowance: a
 * workspace whose subscription died is Free again.
 */
export function aiPlanCapabilitiesFrom(
  org: Partial<AglynOrgBilling> | null,
  rows: Partial<Record<AiPlanDraftKind, ReadonlyArray<Pick<SiblingRow, 'id' | 'kind' | 'sourceType' | 'deletedAt'>>>> = {},
): AiPlanCapabilities {
  const unrestricted = aiUnrestrictedPlanCapabilities()
  const datasets = checkDatasetQuota(org, 0).limit > 0
  return {
    reusableComponents: checkEntitlement(org, 'reusableComponents'),
    create: {
      ...unrestricted.create,
      component: planCreation('component', org, rows.component ?? null),
      form: planCreation('form', org, rows.form ?? null),
      layout: planCreation('layout', org, rows.layout ?? null),
      template: planCreation('template', org, rows.template ?? null),
      dataset: datasets
        ? unrestricted.create.dataset
        : { allowed: false, left: 0, reason: "this workspace's plan does not include datasets" },
    },
    ...(resolveEffectivePlan(org) === 'free' ? { freeTaste: true } : {}),
  }
}

/**
 * What a plan may create on this site, read: the rows of each kind whose
 * allowance the workspace's plan counts, as the draft writer reads them, and
 * nothing for a kind the plan leaves out or leaves unlimited.
 */
export async function readAiPlanCapabilities(
  firestore: Firestore,
  input: { hostId: string; org: Partial<AglynOrgBilling> | null },
): Promise<AiPlanCapabilities> {
  const counted = AI_PLAN_DRAFT_KINDS.filter((kind) => countsRows(kind, input.org))
  const snapshots = await Promise.all(
    counted.map((kind) => siblingsOf(draftCollection(firestore, input.hostId, kind)).get()),
  )
  return aiPlanCapabilitiesFrom(
    input.org,
    Object.fromEntries(counted.map((kind, index) => [kind, siblingRows(snapshots[index])])),
  )
}

/**
 * Whether the site can take one more draft of the kind: a read, for a door
 * that asks before it spends. The write asks again inside its transaction.
 */
export async function aiDraftAllowanceRefusal(
  firestore: Firestore,
  input: { kind: AiDraftKind; hostId: string; org: Partial<AglynOrgBilling> | null },
): Promise<string | null> {
  const [snapshot, host] = await Promise.all([
    siblingsOf(draftCollection(firestore, input.hostId, input.kind)).get(),
    input.kind === 'screen'
      ? firestore.collection('hosts').doc(input.hostId).get()
      : Promise.resolve(null),
  ])
  return aiDraftBandRefusal(
    input.kind,
    siblingRows(snapshot),
    input.org,
    host?.get('screens') as RoutingMap,
  )
}

/**
 * A draft screen's one-segment address: the one asked for, else one from its
 * name, never a reserved segment, and never an address a live screen keeps
 * or the routing map already serves — so the member's publish at it later
 * takes nothing from a live page. The root is asked for only while no screen
 * holds it.
 */
export function aiDraftScreenSlug(
  requested: string | null | undefined,
  name: string,
  rows: ReadonlyArray<Pick<SiblingRow, 'slug' | 'deleted'>>,
  routingMap: RoutingMap,
): string {
  const taken = new Set<string>([
    ...rows.filter((row) => !row.deleted && row.slug).map((row) => row.slug),
    ...Object.values(routingMap ?? {}).filter((path): path is string => typeof path === 'string'),
  ])
  const usable = (value: string | undefined) =>
    value && !reservedScreenRouteSegment(value) && !(value === SCREEN_ROOT_PATH && taken.has(value))
      ? value
      : undefined
  const base = usable(normalizeScreenSlug(requested ?? undefined)) ?? usable(normalizeScreenSlug(name)) ?? 'page'
  if (base === SCREEN_ROOT_PATH) return base
  let slug = base
  let attempt = 2
  while (taken.has(slug)) slug = `${base}-${attempt++}`
  return slug
}

export interface AiDraftRecord {
  id: string
  /** A layout's or a screen's first version; `null` for every other kind, which the writer gives none. */
  versionId: string | null
  name: string
  hostSubdomain: string | null
  /** A screen's search listing as the draft holds it now; absent on other kinds. */
  seo?: { title?: string; description?: string } | null
  /** Whether a member deleted the draft since it was written. */
  deleted?: boolean
}

function recordOf(
  id: string,
  draft: FirebaseFirestore.DocumentSnapshot,
  host: FirebaseFirestore.DocumentSnapshot,
): AiDraftRecord {
  const versionId = draft.get('versionId')
  const seo = draft.get('seo')
  return {
    id,
    versionId: typeof versionId === 'string' && versionId ? versionId : null,
    name: String(draft.get('displayName') ?? ''),
    hostSubdomain: subdomainOf(host),
    ...(seo && typeof seo === 'object' ? { seo: seo as AiDraftRecord['seo'] } : {}),
    ...(draft.get('deletedAt') != null ? { deleted: true } : {}),
  }
}

/** The draft a job already wrote under `id`, when a run of its step got that far. */
export async function readAiDraft(
  firestore: Firestore,
  input: { kind: AiDraftKind; hostId: string; id: string },
): Promise<AiDraftRecord | null> {
  const draft = await draftCollection(firestore, input.hostId, input.kind).doc(input.id).get()
  if (!draft.exists) return null
  return recordOf(input.id, draft, await firestore.collection('hosts').doc(input.hostId).get())
}

/** The tree a versioned draft's first version holds now, decoded; `null` when there is none. */
export async function readAiDraftNodes(
  firestore: Firestore,
  input: { kind: AiVersionedDraftKind; hostId: string; id: string },
): Promise<{ versionId: string; nodes: NodesMap } | null> {
  const draftRef = draftCollection(firestore, input.hostId, input.kind).doc(input.id)
  const draft = await draftRef.get()
  const versionId = draft.exists ? draft.get('versionId') : null
  if (typeof versionId !== 'string' || !versionId) return null
  const version = await draftRef.collection('versions').doc(versionId).get()
  const nodes = version.exists ? decodeStoredNodes<NodesMap>(version.get('nodes')) : null
  return nodes ? { versionId, nodes } : null
}

export interface AiDraftInput {
  kind: AiDraftKind
  hostId: string
  /** The draft's document id: the id the job recorded for this draft. */
  id: string
  /** Whose work the draft is: the job's creator, whose brief it built. */
  uid: string
  org: Partial<AglynOrgBilling> | null
  /** The name asked for; a live sibling already called that gets a number. */
  name: string
  nodes: NodesMap
  /** A page template's suggested address, or a screen's one-segment address. */
  slug?: string | null
  /** A form's declaration and the ids its design hangs from; required for a form. */
  form?: AiFormDraftDeclaration
  /** A component's root, which the node map holds; required for a component. */
  rootId?: string
  /** The properties a component declares, which its tree binds. */
  props?: readonly ReusableComponentProp[]
  /** A screen's layout, for its first version to render inside; a layout the site has. */
  layoutId?: string | null
  now: Date
}

/** What a form draft declares beside its design, read off that design. */
export interface AiFormDraftDeclaration {
  /** The canvas root `nodes` is stored under, as the Forms page's Create stores it. */
  rootId: string
  /** The form node, which carries the form's id and is captioned with the draft's name. */
  formNodeId: string
  fields: FormFieldDecl[]
  consentFieldName: string | null
  routing: FormRouting | null
}

export type AiDraftWrite =
  | (AiDraftRecord & { ok: true; replayed: boolean })
  | { ok: false; status: 403 | 404; error: string }

/** Keep only the keys the create route admits for the kind. */
function allowListed(kind: AiDraftKind, data: Record<string, unknown>): Record<string, unknown> {
  const allowed = new Set(AI_DRAFT_FIELDS[kind])
  return Object.fromEntries(
    Object.entries(data).filter(([key, value]) => allowed.has(key) && value !== undefined),
  )
}

/** The node map with its form node captioned with `name`, as Create captions a new form. */
function withFormCaption(nodes: NodesMap, formNodeId: string, name: string): NodesMap {
  const node = nodes[formNodeId]
  if (!node || node.componentId !== FORM_COMPONENT_ID) return nodes
  return { ...nodes, [formNodeId]: { ...node, props: { ...(node.props ?? {}), formName: name } } }
}

/**
 * Write one draft: the band met, the name made unique among the live
 * siblings, the node map stored as msgpack, all in one transaction. A
 * refusal is returned, never thrown; a Firestore failure propagates, so the
 * machine's retry applies.
 */
export async function writeAiDraft(firestore: Firestore, input: AiDraftInput): Promise<AiDraftWrite> {
  const packed = encodeStoredNodes(input.nodes)
  if (!packed) throw new Error('an AI draft needs a node map')
  if (input.kind === 'form' && !input.form) throw new Error('an AI form draft needs its declaration')
  if (input.kind === 'component' && !(input.rootId && input.nodes[input.rootId])) {
    throw new Error('a component draft needs a root its node map holds')
  }
  const hostRef = firestore.collection('hosts').doc(input.hostId)
  const collection = draftCollection(firestore, input.hostId, input.kind)
  const draftRef = collection.doc(input.id)
  return firestore.runTransaction(async (tx): Promise<AiDraftWrite> => {
    // Every read before any write, which Firestore requires.
    const [host, existing, siblings] = await Promise.all([
      tx.get(hostRef),
      tx.get(draftRef),
      tx.get(siblingsOf(collection)),
    ])
    if (!host.exists) return { ok: false, status: 404, error: 'Unknown site' }
    if (existing.exists) {
      return { ok: true, replayed: true, ...recordOf(input.id, existing, host) }
    }
    const rows = siblingRows(siblings)
    // Read, never written: the routing map decides which screens count.
    const routingMap = host.get('screens') as RoutingMap
    const refusal = aiDraftBandRefusal(input.kind, rows, input.org, routingMap)
    if (refusal) return { ok: false, status: 403, error: refusal }
    const name = uniqueDuplicateName(
      input.name,
      rows.filter((row) => !row.deleted).map((row) => row.name),
    )
    const stamps = { createdAt: input.now, updatedAt: input.now, createdBy: input.uid }
    const nodes = Buffer.from(packed)
    let versionId: string | null = null
    if (input.kind === 'layout') {
      versionId = createResourceUid()
      tx.create(draftRef, { ...allowListed('layout', { displayName: name, versionId }), ...stamps })
      tx.create(draftRef.collection('versions').doc(versionId), {
        layoutId: input.id,
        hostId: input.hostId,
        displayName: AI_DRAFT_VERSION_NAME,
        nodes,
        ...stamps,
      })
    } else if (input.kind === 'screen') {
      versionId = createResourceUid()
      const slug = aiDraftScreenSlug(input.slug, name, rows, routingMap)
      tx.create(draftRef, {
        ...allowListed('screen', { displayName: name, slug, versionId }),
        nameLower: nameSearchKey(name),
        ...stamps,
      })
      tx.create(draftRef.collection('versions').doc(versionId), {
        screenId: input.id,
        hostId: input.hostId,
        displayName: AI_DRAFT_VERSION_NAME,
        nodes,
        ...(input.layoutId ? { layoutId: input.layoutId } : {}),
        ...stamps,
      })
    } else if (input.kind === 'template') {
      tx.create(draftRef, {
        ...allowListed('template', {
          kind: 'page',
          displayName: name,
          nodes,
          slug: input.slug || undefined,
        }),
        source: { type: 'authored' },
        ...stamps,
      })
    } else if (input.kind === 'component') {
      tx.create(draftRef, {
        ...allowListed('component', {
          displayName: name,
          rootId: input.rootId,
          nodes,
          props: input.props?.length ? [...input.props] : undefined,
        }),
        ...stamps,
      })
    } else {
      const form = input.form as AiFormDraftDeclaration
      const captioned = encodeStoredNodes(withFormCaption(input.nodes, form.formNodeId, name)) ?? packed
      tx.create(draftRef, {
        ...allowListed('form', {
          displayName: name,
          slug: normalizeFormSlug(name) || input.id,
          fields: form.fields,
          consentFieldName: form.consentFieldName || undefined,
          routing: form.routing ?? undefined,
          rootId: form.rootId,
          nodes: Buffer.from(captioned),
        }),
        ...stamps,
      })
    }
    return {
      ok: true,
      replayed: false,
      id: input.id,
      versionId,
      name,
      hostSubdomain: subdomainOf(host),
    }
  })
}

export type AiDraftNodesUpdate =
  | { ok: true; changed: boolean }
  | { ok: false; status: 404; error: string }

/**
 * Change the tree of a versioned draft the job wrote, in one transaction:
 * read the first version as it is stored NOW — a member may have opened and
 * saved it — hand it to `update`, and store what comes back with a fresh
 * `updatedAt`, which is what the besigner's save guard compares. `update`
 * answering `null` changes nothing: a pass run again after its write.
 */
export async function updateAiDraftNodes(
  firestore: Firestore,
  input: {
    kind: AiVersionedDraftKind
    hostId: string
    id: string
    now: Date
    update: (nodes: NodesMap) => NodesMap | null
  },
): Promise<AiDraftNodesUpdate> {
  const draftRef = draftCollection(firestore, input.hostId, input.kind).doc(input.id)
  return firestore.runTransaction(async (tx): Promise<AiDraftNodesUpdate> => {
    const draft = await tx.get(draftRef)
    const versionId = draft.exists && draft.get('deletedAt') == null ? draft.get('versionId') : null
    if (typeof versionId !== 'string' || !versionId) {
      return { ok: false, status: 404, error: 'The draft is no longer on the site' }
    }
    const versionRef = draftRef.collection('versions').doc(versionId)
    const version = await tx.get(versionRef)
    const nodes = version.exists ? decodeStoredNodes<NodesMap>(version.get('nodes')) : null
    if (!nodes) return { ok: false, status: 404, error: 'The draft is no longer on the site' }
    const next = input.update(nodes)
    if (!next) return { ok: true, changed: false }
    const packed = encodeStoredNodes(next)
    if (!packed) throw new Error('an AI draft needs a node map')
    tx.update(versionRef, { nodes: Buffer.from(packed), updatedAt: input.now })
    return { ok: true, changed: true }
  })
}

/**
 * Put a search title and description on a draft screen the job wrote, each
 * only where the draft has none: a value a member typed since is theirs.
 */
export async function writeAiDraftScreenSeo(
  firestore: Firestore,
  input: {
    hostId: string
    id: string
    seo: { title?: string | null; description?: string | null }
    now: Date
  },
): Promise<void> {
  const ref = draftCollection(firestore, input.hostId, 'screen').doc(input.id)
  await firestore.runTransaction(async (tx) => {
    const screen = await tx.get(ref)
    if (!screen.exists || screen.get('deletedAt') != null) return
    const patch: Record<string, unknown> = {}
    for (const key of ['title', 'description'] as const) {
      const value = String(input.seo[key] ?? '').trim()
      if (value && !String(screen.get(`seo.${key}`) ?? '').trim()) patch[`seo.${key}`] = value
    }
    if (Object.keys(patch).length) tx.update(ref, { ...patch, updatedAt: input.now })
  })
}

/** The site's subdomain, which a console link names the site by. */
export async function aiSiteSubdomain(firestore: Firestore, hostId: string): Promise<string | null> {
  return subdomainOf(await firestore.collection('hosts').doc(hostId).get())
}

/**
 * What a door says before a job that writes a draft of this kind exists: a
 * site is named, and it is the job's own org's; whatever the kind checks of
 * its own; then the allowance. `null` admits the job.
 */
export async function aiDraftAdmissionRefusal(
  firestore: Firestore,
  input: {
    orgId: string
    hostId: string | null
    kind: AiDraftKind
    /** What the refusal calls the job's output; the kind when absent. */
    noun?: string
    org: object | null
    /** The kind's own check, asked once the site is known to be the org's. */
    ownCheck?: (hostId: string) => Promise<AiJobAdmissionRefusal | null>
  },
): Promise<AiJobAdmissionRefusal | null> {
  if (!input.hostId) {
    return {
      status: 400,
      error: `Open the site the ${input.noun ?? input.kind} is for before starting the job`,
    }
  }
  const owner = await resolveOrgIdForHost(input.hostId)
  if (!owner || owner !== input.orgId) return { status: 404, error: 'Unknown site' }
  const own = await input.ownCheck?.(input.hostId)
  if (own) return own
  const refusal = await aiDraftAllowanceRefusal(firestore, {
    kind: input.kind,
    hostId: input.hostId,
    org: input.org as Partial<AglynOrgBilling> | null,
  })
  return refusal ? { status: 403, error: refusal } : null
}
