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

import { hostRoleCanPublish, hostRoleCanWrite, pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  ACTIONS_MAX_PER_HOST,
  AUTHORS_MAX_PER_HOST,
  checkEntitlement,
  checkHostRegisterQuota,
  checkQuota,
  createResourceUid,
  ENTRIES_MAX_PER_COLLECTION,
  FORMS_MAX_PER_HOST,
  nameSearchKey,
  NON_PAGE_SCREEN_MAX_PER_HOST,
  type OrgEntitlements,
  type OrgFeatureFlags,
  SCREEN_KIND_EMAIL,
  screenClaimsToBeAPage,
  WEBHOOK_MAX_PER_HOST,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getLockdownVerdict,
  getOrgForHost,
  type HostActivityTarget,
  isImpersonationSession,
  lockdownJsonResponse,
  logHostActivity,
} from '@aglyn/tenant-data-admin'
import { Timestamp } from 'firebase-admin/firestore'
import {
  billableScreenIds,
  nonPageScreenIds,
  readScreenSources,
} from './count-billable-screens'

/**
 * Is a redirect destination an INTERNAL path? (AGL-1881.)
 *
 * The negation of `isExternalRedirectDestination` in the redirects model, and
 * that file is the definition of record — restated here only because
 * `@nx/enforce-module-boundaries` forbids an app from statically importing an
 * `aglyn:addons` library.
 *
 * Written to answer FALSE for anything that is not plainly a path, including
 * `undefined`, so a create that omits `destination` is treated as external and
 * takes the stamp rather than skipping it. `strictNullChecks` is off, so the
 * `typeof` test is what keeps a missing value out of `.startsWith`.
 */
function isInternalRedirectDestination(destination: unknown): boolean {
  if (typeof destination !== 'string') return false
  const value = destination.trim()
  return value.startsWith('/') && !value.startsWith('//')
}

/**
 * Quota-governed host subcollections (AGL-473): each entry maps a create
 * action to its collection, per-plan quota key, and (when the feature
 * itself is paid) the entitlement flag. Firestore rules deny client-side
 * `create` on these collections, so this route is the only creation path
 * — updates and deletes stay client-direct (they don't consume quota).
 *
 * Every entry carries `fields`: the keys the client may set, and nothing
 * else is stored (AGL-1377). This was a deny-list — everything persisted
 * unless a `serverManagedFields` entry named it — which is the bet this
 * repo lost three times in one night: AGL-1354 (four entitlement-bearing
 * org fields client-writable because the rules deny-list never learned
 * them), AGL-1364 (two more, each the sibling of a field somebody DID
 * remember), and AGL-1355/AGL-1361 filed to stop the recurrence. A
 * deny-list is only correct while somebody keeps it current; an
 * allow-list makes the next field fail until it is classified, which is
 * the property the sibling route /api/hosts/collections already has.
 *
 * `createdAt`/`updatedAt` appear in no list: they are stamped below on
 * every create, so a client clock is never a fact about the document.
 * Nor does any list carry `deletedAt` — soft-delete state is what the
 * caps count, and a client that could create an already-deleted doc
 * could create any number of them.
 */
const RESOURCES: Record<string, {
  collection: string
  /**
   * The host subcollection whose DOCUMENT owns `collection`, for a resource
   * that does not sit directly under the host (AGL-2266).
   *
   * Only `entry` needs it — `hosts/{h}/collections/{cid}/entries/{eid}` — and
   * the parent id arrives as `body.parentId`. Declared rather than special-
   * cased at the one call site because the cap, the count and the create all
   * have to address the same reference: a nested resource whose cap counted
   * the wrong collection would be a cap that never says no.
   */
  parentCollection?: string
  /** Numeric per-plan cap; omit for entitlement-only (boolean) features. */
  quotaKey?: keyof OrgEntitlements & string
  /**
   * Flat platform cap that does NOT vary by plan, so it has no
   * `OrgEntitlements` key to look up (AGL-1360). Enforced the same way a
   * quota is — counted from a server read — because the alternative is
   * trusting a number the client computed.
   */
  maxPerHost?: number
  /**
   * Set when the collection soft-deletes (delete stamps `deletedAt` rather
   * than removing the doc). The cap must then count LIVE docs only, or
   * deleting never frees a slot — the AGL-1173 screens bug, one cap over.
   */
  softDeletes?: boolean
  entitlement?: keyof OrgFeatureFlags
  /**
   * Require the PUBLISH role rather than the write role (AGL-1881).
   *
   * The default below is `hostRoleCanWrite`, which admits `author`, and for
   * every other resource here that is correct: creating a screen, layout or
   * component is authoring, and nothing it creates is reachable until a
   * publish act registers it. A redirect has no such second step — it decides
   * what the live site serves the moment it exists — so it asks the narrower
   * question, and asks it on the same axis the rules do.
   */
  requiresPublishRole?: boolean
  /** Human label for quota error messages. */
  label: string
  /**
   * How a create of this resource appears in the site activity log.
   *
   * Declared per resource rather than derived from `label`, which is
   * PLURAL for quota copy ("this site can run 5 screens") and reads wrong
   * as an audit line. `type` is the `HostActivityTarget` union, so a row
   * filters and deep-links exactly like one the console used to write;
   * `content` is the honest fallback for the resources that union has no
   * member for, rather than inventing one per collection.
   */
  activity: { type: HostActivityTarget['type']; noun: string }
  /**
   * Keys the client may set. Anything else in `data` is dropped rather
   * than stored — including the fields the UI later presents as
   * trustworthy (provenance, counts, review verdicts), which the client
   * must never be the one writing. Derived from what the console's
   * creation paths actually send, not guessed: a list narrower than its
   * callers loses authoring input silently, which is the worse failure.
   */
  fields: Array<string>
}> = {
  // Sent by the screens page (displayName/description/slug), the template
  // installers (adds `seo`) and the email composer (`kind: 'email'`).
  // `versionId` points at the first version the caller is about to mint.
  screen: {
    collection: 'screens',
    quotaKey: 'screensPerHost',
    label: 'screens',
    activity: { type: 'screen', noun: 'screen' },
    fields: ['displayName', 'description', 'slug', 'seo', 'kind', 'versionId'],
  },
  // Templates (AGL-666) are inert until instantiated, so they carry no
  // entitlement of their own — the gate is on what you make FROM them
  // (screensPerHost, sharedLayoutsPerHost, reusableComponents). `source`
  // is stamped below and absent here, so a client cannot claim
  // marketplace provenance by sending it.
  template: {
    collection: 'templates',
    quotaKey: 'templatesPerHost',
    label: 'templates',
    activity: { type: 'template', noun: 'template' },
    fields: [
      'kind',
      'displayName',
      'description',
      'placeholders',
      'nodes',
      'rootId',
      'slug',
      'seo',
    ],
  },
  // `versions` used to sit here: an array the layouts page seeded alongside
  // `versionId` while every reader used the `versions` SUBCOLLECTION, and
  // nothing kept it in step as versions were added, so it was stale from the
  // second version onward. Removed at the caller first and then here
  // (AGL-1384) — the other order is the silent narrowing AGL-1377 warns
  // about, and it would have dropped the field while a live caller still
  // sent it.
  layout: {
    collection: 'layouts',
    quotaKey: 'sharedLayoutsPerHost',
    label: 'shared layouts',
    activity: { type: 'layout', noun: 'shared layout' },
    fields: ['displayName', 'description', 'versionId'],
  },
  variable: {
    collection: 'variables',
    quotaKey: 'variablesPerHost',
    label: 'variables',
    activity: { type: 'variable', noun: 'variable' },
    fields: ['name', 'type', 'value', 'workflowId', 'workflowName'],
  },
  function: {
    collection: 'functions',
    quotaKey: 'functionsPerHost',
    label: 'functions',
    activity: { type: 'function', noun: 'function' },
    fields: ['name', 'parameters', 'variables', 'operations', 'returnValue'],
  },
  workflow: {
    collection: 'workflows',
    quotaKey: 'workflowsPerHost',
    entitlement: 'workflows',
    label: 'workflows',
    activity: { type: 'workflow', noun: 'workflow' },
    fields: ['name', 'steps', 'returnValue', 'trigger'],
  },
  service: {
    collection: 'services',
    quotaKey: 'servicesPerHost',
    entitlement: 'bookings',
    label: 'services',
    activity: { type: 'content', noun: 'service' },
    fields: [
      'name',
      'description',
      'durationMinutes',
      'priceUsd',
      'timezone',
      'windows',
    ],
  },
  // A redirect is a ROUTING statement over the whole live site, not a draft
  // (AGL-1881) — hence `requiresPublishRole`, matching the redirects block in
  // `cloud/firebase-firestore.rules` that now owns update and delete.
  //
  // `externalDestinationApprovedBy` is NOT on this list and must not be: it is
  // the serve path's evidence that a publisher chose to send traffic off the
  // platform, so it is stamped below from the VERIFIED uid. A client able to
  // send it would be supplying its own provenance, which is the failure mode
  // the allow-list note above is about.
  redirect: {
    collection: 'redirects',
    quotaKey: 'redirectsPerHost',
    entitlement: 'redirects',
    requiresPublishRole: true,
    label: 'redirects',
    activity: { type: 'content', noun: 'redirect' },
    fields: [
      'source',
      'destination',
      'statusCode',
      'kind',
      'priority',
      'enabled',
    ],
  },
  location: {
    collection: 'locations',
    quotaKey: 'inventoryLocations',
    entitlement: 'commerce',
    label: 'inventory locations',
    activity: { type: 'content', noun: 'inventory location' },
    fields: ['name', 'isDefault', 'address'],
  },
  // The whole `HostProduct` model: the editor, the duplicate action and
  // the CSV importer each send a full product, so this list is the model
  // rather than one form's subset. `deletedAt` is excluded — duplicating
  // a product must not carry its predecessor's soft-delete state.
  product: {
    collection: 'products',
    quotaKey: 'productsPerHost',
    entitlement: 'commerce',
    label: 'products',
    activity: { type: 'content', noun: 'product' },
    fields: [
      'name',
      'slug',
      'description',
      'type',
      'status',
      'mediaUrls',
      'categoryIds',
      'tags',
      'options',
      'variants',
      'seo',
      'supplierId',
      'oversellPolicy',
      'taxExempt',
      'digitalFiles',
      'downloadLimit',
      'subscription',
      'subscriptionOptional',
      'gatedVideos',
      'relatedProductIds',
      'giftCard',
      'lowStockThreshold',
      'createdAtMs',
      'updatedAtMs',
      /*
       * Search keys, derived by the plugin that owns the catalog (AGL-2501).
       *
       * The console shell does not import the commerce plugin, so it cannot
       * flatten `variants[].sku` or normalize a name the way the products hub
       * queries them — `CommerceModel.productSearchFields` is the one place
       * that knows both, and it runs on the payload the caller builds. That
       * makes these allow-listed rather than stamped here like a screen's
       * `nameLower` below.
       *
       * They index a host's own catalog, so a caller writing its own values is
       * no worse than the same caller writing its own product names; the
       * failure that matters is the keys going MISSING, which is what
       * `product-search-keys-travel-with-the-name.spec` exists to catch.
       */
      'nameLower',
      'nameTokens',
      'nameReversed',
      'skus',
      'barcodes',
      // Legacy Commerce Starter fields, still written by every caller.
      'priceUsd',
      'inventory',
      'imageUrl',
    ],
  },
  // Entitlement-only (boolean feature, no numeric cap): reusable
  // components render on the live site, so a Starter+ gate must be
  // server-enforced, not just hidden in the console (AGL-473).
  //
  // `hostId` used to sit here: it duplicated the document's own path,
  // hosts/{hostId}/components/{id}, nothing read it, and the other two
  // component creators never sent it — so the collection was already
  // inconsistent about carrying it. Removed at the components page first and
  // then here (AGL-1384).
  reusableComponent: {
    collection: 'components',
    entitlement: 'reusableComponents',
    label: 'reusable components',
    activity: { type: 'component', noun: 'reusable component' },
    fields: ['displayName', 'description', 'rootId', 'nodes'],
  },
  /*
   * The form entity (`docs/specs/reusable-forms.md` §2b):
   * `hosts/{hostId}/forms/{formId}`, the thing a submission's `formId` points
   * at. Before it, a form's whole identity was the caption an author typed —
   * so renaming one split its submission history, and two pages sharing a
   * label had always been one list.
   *
   * Gated on `reusableComponents` rather than a `formsPerHost` plan
   * dimension. The reuse half of a reusable form is that entitlement's engine
   * already: a bound `Form` subtree is promoted and placed like any other
   * definition, and the `formId` travels inside it. Selling the entity
   * separately would price the half that was already sold.
   *
   * `FORMS_MAX_PER_HOST` is a flat platform cap in the `WEBHOOK_MAX_PER_HOST`
   * family — no `OrgEntitlements` key, the same number on every plan, nothing
   * on the price list to explain. The account owner approved that instrument
   * for the member/lead ceilings on the stated ground that an abuse control
   * is not something we sell.
   *
   * ⚠️ No `softDeletes`. That branch reads EVERY document to count live ones,
   * and a form is deleted outright — its submissions are not, and they keep
   * their `formId`, so the per-form list of a deleted form is still readable
   * and nothing a visitor sent is lost with the definition.
   */
  form: {
    collection: 'forms',
    entitlement: 'reusableComponents',
    maxPerHost: FORMS_MAX_PER_HOST,
    label: 'forms',
    activity: { type: 'content', noun: 'form' },
    fields: [
      'displayName',
      'slug',
      'fields',
      'consentFieldName',
      'routing',
      'legacyMatch',
    ],
  },
  // POS registers (AGL-472): the `posRegisters` cap becomes enforceable
  // by routing register creation here. `pos` gates access to POS at all
  // (Pro+); `posRegisters` caps how many named registers a host runs.
  //
  // `quotaKey` is kept for the label/shape, but the CAP is resolved by
  // `checkHostRegisterQuota` below, not by `checkQuota` on this key
  // (AGL-1775) — the purchased seats are an org pool allocated per site, so
  // the org-level value is the plan cap alone.
  register: {
    collection: 'registers',
    quotaKey: 'posRegisters',
    entitlement: 'pos',
    label: 'POS registers',
    activity: { type: 'content', noun: 'POS register' },
    fields: ['name', 'locationId'],
  },
  // Webhooks (AGL-1360): the cap used to be checked in the console by
  // counting the rows the card held from a Firestore LISTENER. The console
  // runs `persistentLocalCache`, so under a stale session that count could
  // be arbitrarily old and low, and a site could exceed the cap — the write
  // itself was legitimate, the count it was authorised against was not.
  // A client-side count is not an enforcement point regardless of freshness
  // (the same lesson as AGL-1354's `brandingProfile`), so the cap moved
  // here and the rules deny client `create` on `webhooks`.
  //
  // `deletedAt` is absent from `fields` BECAUSE the cap counts live docs: a
  // client allowed to create an already-soft-deleted webhook could create any
  // number of them (each one counting zero) and then clear the field with
  // the update that stays client-side, arriving at an uncapped set of live
  // webhooks through a cap that never said no.
  //
  // `secret` stays client-supplied: it is generated with `crypto`
  // `.getRandomValues` and the site's own editors can read it off the card
  // anyway, so nothing crosses a privilege boundary by their choosing it.
  webhook: {
    collection: 'webhooks',
    entitlement: 'webhooks',
    maxPerHost: WEBHOOK_MAX_PER_HOST,
    softDeletes: true,
    label: 'webhooks',
    activity: { type: 'content', noun: 'webhook' },
    fields: ['name', 'direction', 'url', 'workflowName', 'secret', 'enabled'],
  },
  /**
   * Actions (AGL-2266): the collection the import route's own table named as
   * having "no `RESOURCES` entry and no quota key anywhere". The rules granted
   * client `create` through the host catch-all, so a free org could mint
   * unbounded documents from the browser — the AGL-1360 shape, and the answer
   * is AGL-1360's: a flat platform cap counted from a server read.
   *
   * NO `entitlement`. `actions` is a Pro flag but `interactions` is free and
   * both write this collection — the besigner's preset wiring and the
   * interaction builder create the same document the Pro actions card does.
   * Gating creation on the paid flag would remove element interactions from
   * every free site, which is a pricing change and not a cap. The entitlement
   * is checked where it decides what RUNS (`run-event-actions.ts`).
   *
   * `softDeletes` because the interactions provider retires an action by
   * stamping `deletedAt`; counting tombstones would mean removing an
   * interaction never frees its slot.
   *
   * `fields` is the full `HostAction` model rather than one form's subset:
   * three creators send it — the actions card, the interaction builder dialog
   * and `onCreatePresetInteractions` — and a list narrower than its callers
   * loses authoring input silently (AGL-1377).
   */
  action: {
    collection: 'actions',
    maxPerHost: ACTIONS_MAX_PER_HOST,
    softDeletes: true,
    label: 'interactions and actions',
    activity: { type: 'content', noun: 'action' },
    fields: [
      'name',
      'description',
      'trigger',
      'steps',
      'enabled',
      'frequency',
      'cooldownMinutes',
      'audience',
      'nodeId',
      'screenId',
    ],
  },
  /**
   * Content-collection entries (AGL-2266) — the ONE resource here that does
   * not live directly under the host, hence `parentCollection`.
   *
   * Entries were the other client-direct writable class: a dedicated rules
   * block re-grants create/update/delete to any editor, on purpose, because
   * the catch-all's name-based exclusions must not reach them. That left the
   * only quota-governed content shape with no quota. CREATE moves here; update
   * and delete stay client-direct exactly as they are for every other resource
   * in this table, because neither consumes a slot.
   *
   * `fields` is the entry editor's whole payload minus the three publish keys.
   * `status`, `publishedAt` and `publishAt` are absent deliberately: the rules
   * admit an author's create only when it is a draft, and a create that
   * arrived already published would be a publish wearing a create's clothes —
   * the same sentence the entries rule block makes. `status: 'draft'` is
   * stamped below instead, so the server decides it rather than the client.
   */
  entry: {
    collection: 'entries',
    parentCollection: 'collections',
    maxPerHost: ENTRIES_MAX_PER_COLLECTION,
    label: 'entries',
    activity: { type: 'content', noun: 'entry' },
    fields: [
      'title',
      'slug',
      'excerpt',
      'body',
      'coverImage',
      'coverImageAlt',
      'seoTitle',
      'seoDescription',
      'authorName',
      'categoryId',
      'category',
      'tags',
      // The custom-author reference (AGL-2486). An allow-list narrower than
      // its caller loses authoring input silently, which is the failure this
      // table's own comment calls the worse one.
      'authorId',
    ],
  },
  /**
   * Custom content authors (AGL-2486): `hosts/{hostId}/authors/{authorId}`,
   * the byline a post is published under.
   *
   * Server-created for the AGL-2266 reason and no other — a new host
   * subcollection the client could create is unbounded Firestore documents
   * mintable from the browser against a $0 subscription. `AUTHORS_MAX_PER_HOST`
   * is a flat platform cap, not a plan dimension: no `OrgEntitlements` key,
   * every plan gets the same number, nothing here is priced.
   *
   * Update and delete stay client-direct, exactly like `action`: neither
   * creates a document, so neither can raise the count the cap is about, and
   * the authors tab edits a record in place.
   */
  author: {
    collection: 'authors',
    maxPerHost: AUTHORS_MAX_PER_HOST,
    label: 'authors',
    activity: { type: 'content', noun: 'author' },
    fields: [
      'type',
      'name',
      'url',
      'image',
      'jobTitle',
      'worksFor',
      'sameAs',
      'bio',
    ],
  },
}

/** Payload cap: none of these docs legitimately approach this size. */
const MAX_DATA_BYTES = 256 * 1024

/**
 * Generic quota-enforced creation for host resources (AGL-473). Body:
 * `{ hostId, resource, data, id?, count? }` — the permitted keys of `data`
 * are written as the doc (AGL-1377), with createdAt/updatedAt stamped
 * server-side, `id` lets the console pre-generate ids it needs to
 * reference immediately, and
 * batch creates pass `records: [data...]` via `resource` importers later.
 * Role model mirrors the rules' canWriteHostContent: host member role
 * admin/editor, owning org not suspended. Quotas/entitlements ride the
 * owning org's doc (AGL-238); a plan-less org resolves as `free`.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  const hostId = String(body?.hostId ?? '')
  const resourceKey = String(body?.resource ?? '')
  const resource = RESOURCES[resourceKey]
  if (!hostId || !resource) {
    return Response.json({ error: 'Missing hostId or unknown resource' }, { status: 400 })
  }
  const data = body?.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return Response.json({ error: 'Missing data' }, { status: 400 })
  }
  if (JSON.stringify(data).length > MAX_DATA_BYTES) {
    return Response.json({ error: 'Payload too large' }, { status: 413 })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    // `author` (AGL-2334): creating a screen, layout or component is
    // AUTHORING — the document is not reachable by anyone until a route is
    // registered for it, and registering a route is refused in the rules.
    //
    // Except where the resource says otherwise (AGL-1881). Both predicates
    // take `unknown` and answer by set membership, so an absent `memberRoles`
    // entry arrives as `undefined`, is in neither set, and fails CLOSED —
    // which matters here because `strictNullChecks` is off and the missing
    // role would otherwise just be falsy in whichever direction the
    // expression happened to lean.
    const roleOk = resource.requiresPublishRole
      ? hostRoleCanPublish(memberRole)
      : hostRoleCanWrite(memberRole)
    if (!roleOk) {
      return Response.json({
        error: resource.requiresPublishRole
          ? `Creating ${resource.label} requires a publishing role`
          : 'Editing requires the editor role',
      }, { status: 403 })
    }

    // Quota/entitlements ride the owning org's doc (AGL-238); suspension
    // mirrors the rules' hostOrgSuspended (fail-open for pre-org hosts).
    // Lockdown verdict (AGL-1501): subsumes the old bare `suspendedAt` check
    // — same org read, plus platform/host/user scopes and the distinct 423
    // body. Staff bypass is the un-panic invariant.
    const ownerOrg = await getOrgForHost(hostId)
    const org = (ownerOrg?.org ?? {}) as any
    //
    // Audited for read-only (AGL-1625) and left deriving from the method.
    // `resource` selects a COLLECTION, not an operation: every value in
    // RESOURCES lands on the same `create()` below, and the counting reads
    // in between exist only to gate that create. POST → `write` is exact.
    const lockdown = await getLockdownVerdict({
      request,
      staff: decoded['staff'] === true,
      uid: decoded.uid,
      org,
      host: hostSnapshot.data(),
    })
    if (lockdown) return lockdownJsonResponse(lockdown)
    if (resource.entitlement && !checkEntitlement(org, resource.entitlement)) {
      return Response.json({
        error: `This feature is not included in your plan — see Billing`,
      }, { status: 403 })
    }

    // `kind` is on the screen allow-list because the email composer must send
    // `kind: 'email'` on the create it owns. Since AGL-1400 that list carries a
    // second value the count subtracts on, and a client able to send it would
    // mint a screen the cap never saw — the exact create-time hole AGL-1383
    // described, one field over. A template is made by demoting a page
    // (/api/hosts/screens), which is free precisely because the page was paid
    // for; promoting it back meets this same gate.
    //
    // Keyed off the PREDICATE and not off `=== SCREEN_KIND_TEMPLATE` (AGL-2092).
    // The enumeration was correct for exactly as long as there were two
    // billing-excluding values, and `kind: 'error'` made it wrong the day it
    // landed: a create carrying it would have minted an unbilled screen here,
    // outside the four-slot bound that is the whole reason the assignment route
    // owns the stamp. Written as "not a page, and not the one exception", a
    // future non-page kind is refused by default — which is the same shape the
    // flat cap thirty lines below already uses, and for the same stated reason.
    const requestedKind = (data as Record<string, unknown>)['kind']
    if (
      resourceKey === 'screen' &&
      typeof requestedKind === 'string' &&
      requestedKind !== SCREEN_KIND_EMAIL &&
      !screenClaimsToBeAPage({ kind: requestedKind })
    ) {
      return Response.json({
        error:
          `Create the screen, then convert it — a screen cannot be created ` +
          `as '${requestedKind}'`,
      }, { status: 403 })
    }

    /**
     * The collection the create is addressed to (AGL-2266).
     *
     * For everything but `entry` that is a host subcollection. An entry hangs
     * off a content-collection DOCUMENT, so the parent id is required and
     * checked to exist: a create under a missing parent would land an orphan
     * in a collection nothing lists, and — because the cap counts the parent's
     * entries — every such orphan would be counted against a different, empty
     * collection. An unbounded store reached through a bounded route is the
     * failure this whole issue is about, so the parent is verified rather than
     * assumed.
     */
    let collectionRef = hostRef.collection(resource.collection)
    if (resource.parentCollection) {
      const parentId = String(body?.parentId ?? '').slice(0, 64)
      if (!parentId) {
        return Response.json({ error: 'Missing parentId' }, { status: 400 })
      }
      const parentRef = hostRef
        .collection(resource.parentCollection)
        .doc(parentId)
      if (!(await parentRef.get()).exists) {
        return Response.json(
          { error: `Unknown ${resource.parentCollection} document` },
          { status: 404 },
        )
      }
      collectionRef = parentRef.collection(resource.collection)
    }
    // The routing map decides which screens count (AGL-1383), and the host
    // snapshot above already holds it — no second read.
    const routingMap = hostSnapshot.get('screens')
    const id = typeof body?.id === 'string' && body.id
      ? String(body.id).slice(0, 64)
      : createResourceUid()
    // Allow-list, not deny-list (AGL-1377): a key nobody classified is not
    // stored, so the next field added to a model is inert here until it is
    // named — rather than persisted by default and noticed later.
    //
    // Dropped, not rejected: a client sending an unknown key is more likely
    // stale than hostile, and failing the create would be a worse experience
    // than ignoring a field it was never allowed to set. That is also why
    // the lists above are derived from what the console actually sends.
    const allowed = new Set(resource.fields)
    const doc: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (allowed.has(key) && value !== undefined) doc[key] = value
    }
    // Normalized search key for the name-prefix query (AGL-835). Only screens
    // are queried by name (the switcher loads the rest client-side), so only
    // screens carry the field — stamping it on every resource kind would be an
    // index field nothing reads.
    const nameLower =
      resourceKey === 'screen' && typeof doc['displayName'] === 'string'
        ? { nameLower: nameSearchKey(doc['displayName'] as string) }
        : {}

    /*
     * COUNT AND CREATE IN ONE TRANSACTION (AGL-2231).
     *
     * Every cap below used to be a read, then a decision, then a `create()`
     * outside any transaction — so N concurrent POSTs each read the same
     * pre-count, each found room, and each landed. A free plan's five screens
     * became fifty by sending fifty requests at once, and nothing re-counts
     * afterwards, so the extra slots were permanent. That is the
     * create-time-quota shape AGL-1383/1387/1390 chased through the COUNTING
     * RULE; this is the same defect in WHEN the rule is applied, and the
     * counting rule cannot fix it. `/api/hosts/create` already had the answer
     * for `hostLimit` (AGL-1738) and `assertCollaboratorSeats` for seats — this
     * is that treatment for the other eleven keys.
     *
     * Firestore's `Transaction.get(AggregateQuery)` takes a pessimistic lock on
     * every document the underlying query matches, so the count really is
     * serialized against a concurrent create into the same collection: the
     * loser retries, re-reads the higher count and is refused. Every read here
     * is one this route already paid for — the transaction adds contention on a
     * per-site collection, not reads.
     *
     * ALL READS BEFORE THE WRITE, which Firestore requires and which is also
     * why the document is assembled above: the transaction body must not do
     * anything between the last count and `tx.create`.
     *
     * A refusal is returned as data and rendered outside. Building a `Response`
     * inside a body that can run several times would allocate one per attempt,
     * and — worse — reads as if the transaction were a place effects happen.
     */
    const refusal = await firestore.runTransaction(async (tx) => {
      // ONE scan of the screens collection, two answers (AGL-1440): the plan's
      // allowance below and the flat non-page cap after it read the same rows.
      const screenRows =
        resourceKey === 'screen'
          ? await readScreenSources(hostRef, (query) => tx.get(query as any))
          : []
      if (resource.quotaKey) {
        // Platform-seeded starters (AGL-687) are excluded from the template
        // count: they are content WE put in the library, and charging a free
        // plan's ten-template allowance for them would leave no room for the
        // user's own work. Every other template carries source.type
        // 'authored' or 'marketplace', both of which still count.
        const used =
          resourceKey === 'template'
            ? (
                await tx.get(
                  collectionRef.where('source.type', '!=', 'starter').count(),
                )
              ).data().count
            : resourceKey === 'screen'
              ? billableScreenIds(screenRows, routingMap).size
              : (await tx.get(collectionRef.count())).data().count
        // Registers are the one quota whose cap is not the org-level value
        // (AGL-1775). `seatAddons.posRegisters` is an org POOL and
        // `org.registerAllocations` says which site holds each seat, so a
        // `checkQuota(org, 'posRegisters', …)` here would read the plan cap with
        // no pool in it and refuse a site the seats it is invoiced for. This is
        // the enforcement point the decision moved onto the allocation; it did
        // not move anywhere else.
        const quota =
          resourceKey === 'register'
            ? checkHostRegisterQuota(org, hostId, used)
            : checkQuota(org, resource.quotaKey as any, used)
        if (!quota.allowed) {
          return {
            error:
              resourceKey === 'register'
                ? `This site can run ${quota.limit} ${resource.label} — ` +
                  'assign another register seat to it in Billing, or buy one'
                : `Your plan includes ${quota.limit} ${resource.label} — ` +
                  'upgrade in Billing for more',
          }
        }
      }
      // Flat platform cap (AGL-1360), counted from a server read for the same
      // reason the quotas above are: the number the client believed is not a
      // fact about the collection. `softDeletes` collections count LIVE docs
      // only, so deleting one frees its slot.
      if (resource.maxPerHost != null) {
        const existing = resource.softDeletes
          ? (await tx.get(collectionRef.select('deletedAt'))).docs.filter(
              (entry) => entry.get('deletedAt') == null,
            ).length
          : (await tx.get(collectionRef.count())).data().count
        if (existing >= resource.maxPerHost) {
          return {
            error: resource.parentCollection
              ? `A collection holds at most ${resource.maxPerHost} ` +
                `${resource.label} — delete some to make room`
              : `${resource.label} are capped at ${resource.maxPerHost} per site`,
          }
        }
      }
      // The same flat shape for the screens that no plan cap counts (AGL-1399,
      // AGL-1439). `kind: 'email'` is on the allow-list above because the email
      // composer must send it, and `countBillableScreens` subtracts it — so this
      // create was a document nothing bounded, repeatable in a loop on a free
      // plan. Unbounded Firestore documents rather than a bypass of anything we
      // sell, so the answer is a platform cap and NOT a plan dimension: no
      // `OrgEntitlements` key, no variation by plan, nothing re-priced.
      //
      // Keyed off the PREDICATE (`screenClaimsToBeAPage`), never off the two kind
      // values: AGL-1439 is AGL-1399 one value over, and enumerating them would
      // leave the next non-page kind unbounded again. `kind: 'template'` cannot be
      // created here at all (refused above), but it fills the same bucket by
      // demotion and by import, so it is counted here.
      if (
        resourceKey === 'screen' &&
        !screenClaimsToBeAPage({ kind: requestedKind as string })
      ) {
        const existing = nonPageScreenIds(screenRows, routingMap).size
        if (existing >= NON_PAGE_SCREEN_MAX_PER_HOST) {
          return {
            error:
              'This site is at its limit of ' +
              `${NON_PAGE_SCREEN_MAX_PER_HOST} email and template screens — ` +
              'delete some to make room',
          }
        }
      }
      tx.create(collectionRef.doc(id), {
        ...doc,
        ...nameLower,
        ...(resourceKey === 'template' ? { source: { type: 'authored' } } : {}),
        // A redirect that leaves the platform carries the uid of the publisher
        // who chose that (AGL-1881). `matchRedirect` refuses to serve an
        // absolute destination without this stamp, which is what makes a rule
        // written before that issue — by a role the rules have since refused —
        // stop firing instead of being trusted.
        //
        // Stamped from `decoded.uid`, never from `data`: the field is off the
        // allow-list above precisely so a caller cannot supply its own
        // provenance. The role check has already run, so reaching this line
        // IS the approval.
        //
        // The predicate is "not an internal path" and is the same one
        // `isExternalRedirectDestination` states in
        // `libs/plugins/redirects/src/lib/model/redirects.ts`, which is the
        // definition of record. It is restated rather than imported because
        // `@nx/enforce-module-boundaries` forbids an app from depending on an
        // `aglyn:addons` library; the two must agree, and the direction of any
        // disagreement is a rule that does not fire, never one that fires
        // unapproved.
        ...(resourceKey === 'redirect' &&
        !isInternalRedirectDestination(doc['destination'])
          ? { externalDestinationApprovedBy: decoded.uid }
          : {}),
        // An entry is born a DRAFT, decided here rather than sent (AGL-2266).
        // The rules admit an author's client create only when it is a draft;
        // routing the create through this server does not get to be the way
        // that condition stops applying, so `status` is off the allow-list
        // above and stamped instead. Publishing stays the client `updateDoc`
        // the entries rule block already gates on `canPublishHostContent`.
        ...(resourceKey === 'entry' ? { status: 'draft' } : {}),
        // Unconditional now that no allow-list carries them: the client cannot
        // supply either, so there is no client value left to preserve. The
        // callers already relied on this — a Timestamp does not survive the
        // JSON hop, so what they used to be able to send was junk anyway.
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        // WHO MADE THIS (AGL-118). Every artifact under a host — screens,
        // layouts, components, templates — carried no author field of any
        // kind, so nothing in the stored data could say who built a site.
        // That is not a gap a later script can close: an artifact that never
        // recorded its creator cannot be attributed afterwards without
        // inferring a name from org ownership, which is a guess about a
        // person written into what is read as an audit record.
        //
        // Stamped from `decoded.uid` and absent from every allow-list above,
        // the `externalDestinationApprovedBy` discipline exactly: provenance
        // the caller supplies is provenance the caller chose.
        createdBy: decoded.uid,
      })
      return null
    })
    if (refusal) return Response.json(refusal, { status: 403 })
    // The audit entry, written HERE rather than by whoever called this route
    // (AGL-118). Three template surfaces created resources through this
    // endpoint and appended nothing, so the log reported sites nobody had
    // touched — a client-written audit trail is one the client can decline to
    // write, and declining is silent. A create that reaches this line has
    // committed, so the entry records something that demonstrably happened,
    // attributed to a uid this route verified rather than one it was handed.
    //
    // After the transaction on purpose: a refused or rolled-back create must
    // not leave a row claiming it succeeded.
    await logHostActivity(
      hostId,
      { uid: decoded.uid, email: decoded.email ? String(decoded.email) : null },
      `Created ${resource.activity.noun}`,
      {
        type: resource.activity.type,
        id,
        ...(typeof doc['displayName'] === 'string' && doc['displayName']
          ? { name: doc['displayName'] as string }
          : {}),
      } satisfies HostActivityTarget,
    )
    return Response.json({ ok: true, id }, { status: 200 })
  } catch (error: any) {
    if (error?.code === 6 /* ALREADY_EXISTS */) {
      return Response.json({ error: 'That id already exists' }, { status: 409 })
    }
    console.error(error)
    return Response.json({ error: 'Create failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
