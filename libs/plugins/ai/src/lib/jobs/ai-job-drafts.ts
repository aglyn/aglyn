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
import { nameSearchKey } from '@aglyn/aglyn/app-utils/name-search'
import { checkQuota } from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  billableScreenIds,
  normalizeScreenSlug,
  reservedScreenRouteSegment,
  SCREEN_ROOT_PATH,
} from '@aglyn/aglyn/app-utils/screen-route'
import { decodeStoredNodes, encodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import { resolveOrgIdForHost } from '@aglyn/tenant-data-admin/server/organizations'
import type { AiJobAdmissionRefusal } from './ai-job-admission'

/**
 * Where a generation job's layout, page template or page lands (AGL-2909,
 * AGL-2907): a new draft, made as the console's host resources route makes
 * one.
 *
 * ── The document the create route makes ─────────────────────────────────
 *
 * `AI_DRAFT_FIELDS` is that route's allow-list for each kind, and a spec
 * reads the route's source to hold the two together. Nothing outside the
 * list is written except the route's own stamps: `createdAt`, `updatedAt`,
 * `createdBy`, a screen's `nameLower`, and a template's `source`, which is
 * `authored` — a template a member's job generated is theirs, never a starter
 * or a listing. A layout's or a screen's first version carries the keys the
 * versions route seeds one with.
 *
 * ── Counted like a create ────────────────────────────────────────────────
 *
 * The band is met INSIDE the transaction that writes (AGL-2231), with the
 * route's arithmetic: every layout document counts against
 * `sharedLayoutsPerHost`; a template counts against `templatesPerHost` when it
 * records a source other than a platform starter — the route's `!=` query,
 * which never matches a document with no `source.type` at all; and a screen
 * counts against `screensPerHost` by `billableScreenIds`, over the screens and
 * the host's routing map, which counts an unrouted screen too (AGL-1445).
 *
 * ── Applied to nothing ───────────────────────────────────────────────────
 *
 * A layout renders only around a screen or layout that names it, or as the
 * built-in page layout the host document names; a template is inert until a
 * member uses it; and a screen serves nothing until the host's routing map
 * names it, which is what publishing writes (`publishScreenRoute`). So the
 * writer touches the new documents and nothing else — no host document, no
 * routing map, no collection, store setting or other layout — and never a
 * `publishedAt` or a publish schedule. What the job hands back is a link to
 * the draft, never a binding.
 *
 * ── One draft per job ────────────────────────────────────────────────────
 *
 * The caller names the document id, one per job. A step run again after its
 * draft was written — a process cut off before the machine recorded the step
 * — finds that draft and reports it, rather than writing a second.
 */

type Firestore = FirebaseFirestore.Firestore

export type AiDraftKind = 'layout' | 'template' | 'screen'

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

interface DraftBand {
  collection: 'layouts' | 'templates' | 'screens'
  quotaKey: 'sharedLayoutsPerHost' | 'templatesPerHost' | 'screensPerHost'
  /** The route's plural label, in the refusal it gives. */
  label: string
}

const DRAFT_BANDS: Readonly<Record<AiDraftKind, DraftBand>> = {
  layout: { collection: 'layouts', quotaKey: 'sharedLayoutsPerHost', label: 'shared layouts' },
  template: { collection: 'templates', quotaKey: 'templatesPerHost', label: 'templates' },
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
  return firestore.collection('hosts').doc(hostId).collection(DRAFT_BANDS[kind].collection)
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

/** The route's refusal when the site's plan holds no more of the kind; `null` while it does. */
export function aiDraftBandRefusal(
  kind: AiDraftKind,
  rows: ReadonlyArray<Pick<SiblingRow, 'id' | 'kind' | 'sourceType' | 'deletedAt'>>,
  org: Partial<AglynOrgBilling> | null,
  routingMap?: RoutingMap,
): string | null {
  const band = DRAFT_BANDS[kind]
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
  /** A layout's or a screen's first version; `null` for a template, which has none. */
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
  /** The draft's document id: one per job. */
  id: string
  /** Whose work the draft is: the job's creator, whose brief it built. */
  uid: string
  org: Partial<AglynOrgBilling> | null
  /** The name asked for; a live sibling already called that gets a number. */
  name: string
  nodes: NodesMap
  /** A page template's suggested address, or a screen's one-segment address. */
  slug?: string | null
  /** A screen's layout, for its first version to render inside; a layout the site has. */
  layoutId?: string | null
  now: Date
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

/**
 * Write one draft: the band met, the name made unique among the live
 * siblings, the node map stored as msgpack, all in one transaction. A
 * refusal is returned, never thrown; a Firestore failure propagates, so the
 * machine's retry applies.
 */
export async function writeAiDraft(firestore: Firestore, input: AiDraftInput): Promise<AiDraftWrite> {
  const packed = encodeStoredNodes(input.nodes)
  if (!packed) throw new Error('an AI draft needs a node map')
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
    } else {
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
