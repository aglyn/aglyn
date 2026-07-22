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
  type OrgEntitlements,
  type OrgFeatureFlags,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgForHost,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { Timestamp } from 'firebase-admin/firestore'

/**
 * Quota-governed host subcollections (AGL-473): each entry maps a create
 * action to its collection, per-plan quota key, and (when the feature
 * itself is paid) the entitlement flag. Firestore rules deny client-side
 * `create` on these collections, so this route is the only creation path
 * — updates and deletes stay client-direct (they don't consume quota).
 */
const RESOURCES: Record<string, {
  collection: string
  /** Numeric per-plan cap; omit for entitlement-only (boolean) features. */
  quotaKey?: keyof OrgEntitlements & string
  entitlement?: keyof OrgFeatureFlags
  /** Human label for quota error messages. */
  label: string
  /**
   * Fields the client may never set, stripped from `data` before the write.
   * For anything the UI later presents as trustworthy — provenance, counts,
   * review verdicts — the client must not be the one writing it.
   */
  serverManagedFields?: Array<string>
}> = {
  screen: { collection: 'screens', quotaKey: 'screensPerHost', label: 'screens' },
  // Templates (AGL-666) are inert until instantiated, so they carry no
  // entitlement of their own — the gate is on what you make FROM them
  // (screensPerHost, sharedLayoutsPerHost, reusableComponents). `source`
  // is stamped here so a client cannot claim marketplace provenance.
  template: {
    collection: 'templates',
    quotaKey: 'templatesPerHost',
    label: 'templates',
    serverManagedFields: ['source'],
  },
  layout: { collection: 'layouts', quotaKey: 'sharedLayoutsPerHost', label: 'shared layouts' },
  variable: { collection: 'variables', quotaKey: 'variablesPerHost', label: 'variables' },
  function: { collection: 'functions', quotaKey: 'functionsPerHost', label: 'functions' },
  workflow: {
    collection: 'workflows',
    quotaKey: 'workflowsPerHost',
    entitlement: 'workflows',
    label: 'workflows',
  },
  service: {
    collection: 'services',
    quotaKey: 'servicesPerHost',
    entitlement: 'bookings',
    label: 'services',
  },
  redirect: {
    collection: 'redirects',
    quotaKey: 'redirectsPerHost',
    entitlement: 'redirects',
    label: 'redirects',
  },
  location: {
    collection: 'locations',
    quotaKey: 'inventoryLocations',
    entitlement: 'commerce',
    label: 'inventory locations',
  },
  product: {
    collection: 'products',
    quotaKey: 'productsPerHost',
    entitlement: 'commerce',
    label: 'products',
  },
  // Entitlement-only (boolean feature, no numeric cap): reusable
  // components render on the live site, so a Starter+ gate must be
  // server-enforced, not just hidden in the console (AGL-473).
  reusableComponent: {
    collection: 'components',
    entitlement: 'reusableComponents',
    label: 'reusable components',
  },
  // POS registers (AGL-472): the `posRegisters` cap becomes enforceable
  // by routing register creation here. `pos` gates access to POS at all
  // (Pro+); `posRegisters` caps how many named registers a host runs.
  register: {
    collection: 'registers',
    quotaKey: 'posRegisters',
    entitlement: 'pos',
    label: 'POS registers',
  },
}

/** Payload cap: none of these docs legitimately approach this size. */
const MAX_DATA_BYTES = 256 * 1024

/**
 * Generic quota-enforced creation for host resources (AGL-473). Body:
 * `{ hostId, resource, data, id?, count? }` — `data` is written as the
 * doc (server-stamped createdAt/updatedAt added when absent), `id` lets
 * the console pre-generate ids it needs to reference immediately, and
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
    const ownerOrg = await getOrgForHost(hostId)
    const org = (ownerOrg?.org ?? {}) as any
    if (org.suspendedAt != null) {
      return Response.json({ error: 'This workspace is suspended' }, { status: 403 })
    }
    if (resource.entitlement && !checkEntitlement(org, resource.entitlement)) {
      return Response.json({
        error: `This feature is not included in your plan — see Billing`,
      }, { status: 403 })
    }

    const collectionRef = hostRef.collection(resource.collection)
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

    const id = typeof body?.id === 'string' && body.id
      ? String(body.id).slice(0, 64)
      : createResourceUid()
    const doc = { ...(data as Record<string, unknown>) }
    // Dropped, not rejected: a client sending one is more likely stale than
    // hostile, and failing the create would be a worse experience than
    // ignoring a field it was never allowed to set.
    for (const field of resource.serverManagedFields ?? []) delete doc[field]
    await collectionRef.doc(id).create({
      ...doc,
      ...(resourceKey === 'template' ? { source: { type: 'authored' } } : {}),
      ...(doc['createdAt'] === undefined ? { createdAt: Timestamp.now() } : {}),
      ...(doc['updatedAt'] === undefined ? { updatedAt: Timestamp.now() } : {}),
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
