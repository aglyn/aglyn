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
import { checkEntitlement, checkQuota } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { encodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import type {
  AglynOrgBilling,
  OrgFeatureFlags,
} from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import type { ReusableComponentProp } from '@aglyn/aglyn/foundation/definitions/platform.types'
import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import { resolveOrgIdForHost } from '@aglyn/tenant-data-admin/server/organizations'
import type { AiJobAdmissionRefusal } from './ai-job-admission'

/**
 * Where a generation job's layout, page template, form or reusable
 * component lands (AGL-2909, AGL-2913, AGL-2908): a new draft, made as the
 * console's host resources route makes one.
 *
 * ── The document the create route makes ─────────────────────────────────
 *
 * `AI_DRAFT_FIELDS` is that route's allow-list for each kind, and a spec
 * reads the route's source to hold the two together. Nothing outside the
 * list is written except the route's own stamps: `createdAt`, `updatedAt`,
 * `createdBy`, and a template's `source`, which is `authored` — a template a
 * member's job generated is theirs, never a starter or a listing. A layout's
 * first version carries the keys the versions route seeds one with. A form is
 * the document the Forms page's Create sends: its design canvas-shaped under
 * `rootId` with the form node bound to the form's id and captioned with its
 * name, a slug read from that name, and no version — the form's page mints the
 * first one when someone opens it. Where Create sends an empty `fields`, a
 * generated form sends the declaration read off its own design, so the two
 * agree from the start. A component carries its tree and the props it
 * declares on its own document, as Use template writes one, and gets its
 * first version where every component does: when a member opens it.
 *
 * ── Counted like a create ────────────────────────────────────────────────
 *
 * The band is met INSIDE the transaction that writes (AGL-2231), with the
 * route's arithmetic: every layout document counts against
 * `sharedLayoutsPerHost`, and a template counts against `templatesPerHost`
 * when it records a source other than a platform starter — the route's `!=`
 * query, which never matches a document with no `source.type` at all. A form
 * needs the plan to include the route's `entitlement` first, refused in the
 * route's own words, and then every form document counts against
 * `formsPerHost`. A reusable component counts against no allowance at all:
 * the route admits one on a plan with the `reusableComponents` entitlement
 * and refuses it otherwise, and so does the writer.
 *
 * ── Applied to nothing ───────────────────────────────────────────────────
 *
 * A layout renders only around a screen or layout that names it, or as the
 * built-in page layout the host document names; a template is inert until a
 * member uses it; a form renders only where a page places it; a component
 * renders only where an instance places it, and a new one has no instance.
 * So the writer touches the new documents and nothing else — no screen,
 * collection, store setting, other layout, component or host document — and
 * what the job hands back is a link to the draft, never a binding.
 *
 * ── One draft per job ────────────────────────────────────────────────────
 *
 * The caller names the document id, one per job. A step run again after its
 * draft was written — a process cut off before the machine recorded the step
 * — finds that draft and reports it, rather than writing a second.
 */

type Firestore = FirebaseFirestore.Firestore

export type AiDraftKind = 'layout' | 'template' | 'form' | 'component'

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
}

/** The keys a layout's first version is seeded with, all on the versions route's list. */
export const AI_DRAFT_VERSION_FIELDS: readonly string[] = ['layoutId', 'hostId', 'displayName', 'nodes']

/** The label on a generated layout's first version, as on one Use template makes. */
export const AI_DRAFT_VERSION_NAME = 'Initial version'

/** The route's refusal when the site's plan does not include the kind at all. */
export const AI_DRAFT_ENTITLEMENT_REFUSAL = 'This feature is not included in your plan — see Billing'

export interface AiDraftBand {
  collection: 'layouts' | 'templates' | 'forms' | 'components'
  /** The allowance the route counts the kind against, where it counts one. */
  quotaKey?: 'sharedLayoutsPerHost' | 'templatesPerHost' | 'formsPerHost'
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
}

interface SiblingRow {
  name: string
  sourceType: unknown
  deleted: boolean
}

function draftCollection(firestore: Firestore, hostId: string, kind: AiDraftKind) {
  return firestore.collection('hosts').doc(hostId).collection(AI_DRAFT_BANDS[kind].collection)
}

/** The three fields the band, the name and a deletion are read from. */
function siblingsOf(collection: FirebaseFirestore.CollectionReference) {
  return collection.select('displayName', 'source.type', 'deletedAt')
}

function siblingRows(snapshot: FirebaseFirestore.QuerySnapshot): SiblingRow[] {
  return snapshot.docs.map((doc) => ({
    name: String(doc.get('displayName') ?? ''),
    sourceType: doc.get('source.type'),
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
  rows: ReadonlyArray<Pick<SiblingRow, 'sourceType'>>,
  org: Partial<AglynOrgBilling> | null,
): string | null {
  const band = AI_DRAFT_BANDS[kind]
  if (band.entitlement && !checkEntitlement(org, band.entitlement)) {
    return AI_DRAFT_ENTITLEMENT_REFUSAL
  }
  if (!band.quotaKey) return null
  const used =
    kind === 'template'
      ? rows.filter((row) => row.sourceType !== undefined && row.sourceType !== 'starter').length
      : rows.length
  const quota = checkQuota(org, band.quotaKey, used)
  return quota.allowed
    ? null
    : `Your plan includes ${quota.limit} ${band.label} — upgrade in Billing for more`
}

/**
 * Whether the site can take one more draft of the kind: a read, for a door
 * that asks before it spends. The write asks again inside its transaction.
 */
export async function aiDraftAllowanceRefusal(
  firestore: Firestore,
  input: { kind: AiDraftKind; hostId: string; org: Partial<AglynOrgBilling> | null },
): Promise<string | null> {
  const snapshot = await siblingsOf(draftCollection(firestore, input.hostId, input.kind)).get()
  return aiDraftBandRefusal(input.kind, siblingRows(snapshot), input.org)
}

export interface AiDraftRecord {
  id: string
  /** A layout's first version; `null` for every other kind, which the writer gives none. */
  versionId: string | null
  name: string
  hostSubdomain: string | null
}

function recordOf(
  id: string,
  draft: FirebaseFirestore.DocumentSnapshot,
  host: FirebaseFirestore.DocumentSnapshot,
): AiDraftRecord {
  const versionId = draft.get('versionId')
  return {
    id,
    versionId: typeof versionId === 'string' && versionId ? versionId : null,
    name: String(draft.get('displayName') ?? ''),
    hostSubdomain: subdomainOf(host),
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

export interface AiDraftInput {
  kind: AiDraftKind
  hostId: string
  /** The draft's document id: one per job. */
  id: string
  /** Whose work the draft is: the job's creator, whose brief it built. */
  uid: string
  org: Partial<AglynOrgBilling> | null
  /** The name asked for; a live sibling already called that gets a number. */
  name: string
  nodes: NodesMap
  /** A page template's suggested address, which Use template offers. */
  slug?: string | null
  /** A form's declaration and the ids its design hangs from; required for a form. */
  form?: AiFormDraftDeclaration
  /** A component's root, which the node map holds; required for a component. */
  rootId?: string
  /** The properties a component declares, which its tree binds. */
  props?: readonly ReusableComponentProp[]
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
    const refusal = aiDraftBandRefusal(input.kind, rows, input.org)
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
    org: object | null
    /** The kind's own check, asked once the site is known to be the org's. */
    ownCheck?: (hostId: string) => Promise<AiJobAdmissionRefusal | null>
  },
): Promise<AiJobAdmissionRefusal | null> {
  if (!input.hostId) {
    return { status: 400, error: `Open the site the ${input.kind} is for before starting the job` }
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
