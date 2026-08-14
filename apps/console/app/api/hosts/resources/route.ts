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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  checkEntitlement,
  checkQuota,
  createResourceUid,
  nameSearchKey,
  NON_PAGE_SCREEN_MAX_PER_HOST,
  type OrgEntitlements,
  type OrgFeatureFlags,
  SCREEN_KIND_TEMPLATE,
  screenClaimsToBeAPage,
  WEBHOOK_MAX_PER_HOST,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getLockdownVerdict,
  getOrgForHost,
  isImpersonationSession,
  lockdownJsonResponse,
} from '@aglyn/tenant-data-admin'
import { Timestamp } from 'firebase-admin/firestore'
import {
  billableScreenIds,
  nonPageScreenIds,
  readScreenSources,
} from './count-billable-screens'

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
  /** Human label for quota error messages. */
  label: string
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
    fields: ['displayName', 'description', 'versionId'],
  },
  variable: {
    collection: 'variables',
    quotaKey: 'variablesPerHost',
    label: 'variables',
    fields: ['name', 'type', 'value', 'workflowId', 'workflowName'],
  },
  function: {
    collection: 'functions',
    quotaKey: 'functionsPerHost',
    label: 'functions',
    fields: ['name', 'parameters', 'variables', 'operations', 'returnValue'],
  },
  workflow: {
    collection: 'workflows',
    quotaKey: 'workflowsPerHost',
    entitlement: 'workflows',
    label: 'workflows',
    fields: ['name', 'steps', 'returnValue', 'trigger'],
  },
  service: {
    collection: 'services',
    quotaKey: 'servicesPerHost',
    entitlement: 'bookings',
    label: 'services',
    fields: [
      'name',
      'description',
      'durationMinutes',
      'priceUsd',
      'timezone',
      'windows',
    ],
  },
  redirect: {
    collection: 'redirects',
    quotaKey: 'redirectsPerHost',
    entitlement: 'redirects',
    label: 'redirects',
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
    fields: ['displayName', 'description', 'rootId', 'nodes'],
  },
  // POS registers (AGL-472): the `posRegisters` cap becomes enforceable
  // by routing register creation here. `pos` gates access to POS at all
  // (Pro+); `posRegisters` caps how many named registers a host runs.
  register: {
    collection: 'registers',
    quotaKey: 'posRegisters',
    entitlement: 'pos',
    label: 'POS registers',
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
    fields: ['name', 'direction', 'url', 'workflowName', 'secret', 'enabled'],
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
    if (memberRole !== 'admin' && memberRole !== 'editor') {
      return Response.json({ error: 'Editing requires the editor role' }, { status: 403 })
    }

    // Quota/entitlements ride the owning org's doc (AGL-238); suspension
    // mirrors the rules' hostOrgSuspended (fail-open for pre-org hosts).
    // Lockdown verdict (AGL-1501): subsumes the old bare `suspendedAt` check
    // — same org read, plus platform/host/user scopes and the distinct 423
    // body. Staff bypass is the un-panic invariant.
    const ownerOrg = await getOrgForHost(hostId)
    const org = (ownerOrg?.org ?? {}) as any
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
    const requestedKind = (data as Record<string, unknown>)['kind']
    if (
      resourceKey === 'screen' &&
      typeof requestedKind === 'string' &&
      requestedKind === SCREEN_KIND_TEMPLATE
    ) {
      return Response.json({
        error:
          'Create the screen, then convert it to a template — a screen ' +
          'cannot be created as one',
      }, { status: 403 })
    }

    const collectionRef = hostRef.collection(resource.collection)
    // ONE scan of the screens collection, two answers (AGL-1440): the plan's
    // allowance below and the flat non-page cap after it read the same rows.
    const screenRows =
      resourceKey === 'screen' ? await readScreenSources(hostRef) : []
    // The routing map decides which screens count (AGL-1383), and the host
    // snapshot above already holds it — no second read.
    const routingMap = hostSnapshot.get('screens')
    if (resource.quotaKey) {
      // Platform-seeded starters (AGL-687) are excluded from the template
      // count: they are content WE put in the library, and charging a free
      // plan's ten-template allowance for them would leave no room for the
      // user's own work. Every other template carries source.type
      // 'authored' or 'marketplace', both of which still count.
      const used =
        resourceKey === 'template'
          ? (
              await collectionRef
                .where('source.type', '!=', 'starter')
                .count()
                .get()
            ).data().count
          : resourceKey === 'screen'
            ? billableScreenIds(screenRows, routingMap).size
            : (await collectionRef.count().get()).data().count
      const quota = checkQuota(org, resource.quotaKey as any, used)
      if (!quota.allowed) {
        return Response.json({
          error:
            `Your plan includes ${quota.limit} ${resource.label} — ` +
            'upgrade in Billing for more',
        }, { status: 403 })
      }
    }
    // Flat platform cap (AGL-1360), counted from a server read for the same
    // reason the quotas above are: the number the client believed is not a
    // fact about the collection. `softDeletes` collections count LIVE docs
    // only, so deleting one frees its slot.
    if (resource.maxPerHost != null) {
      const existing = resource.softDeletes
        ? (await collectionRef.select('deletedAt').get()).docs.filter(
            (entry) => entry.get('deletedAt') == null,
          ).length
        : (await collectionRef.count().get()).data().count
      if (existing >= resource.maxPerHost) {
        return Response.json({
          error:
            `${resource.label} are capped at ${resource.maxPerHost} per site`,
        }, { status: 403 })
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
        return Response.json({
          error:
            'This site is at its limit of ' +
            `${NON_PAGE_SCREEN_MAX_PER_HOST} email and template screens — ` +
            'delete some to make room',
        }, { status: 403 })
      }
    }

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
    await collectionRef.doc(id).create({
      ...doc,
      ...nameLower,
      ...(resourceKey === 'template' ? { source: { type: 'authored' } } : {}),
      // Unconditional now that no allow-list carries them: the client cannot
      // supply either, so there is no client value left to preserve. The
      // callers already relied on this — a Timestamp does not survive the
      // JSON hop, so what they used to be able to send was junk anyway.
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    })
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
