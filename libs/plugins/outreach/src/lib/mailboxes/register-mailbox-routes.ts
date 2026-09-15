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

import {
  registerPluginApiRoute,
  type PluginApiRequestSubject,
} from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { tokenSigningSecret } from '@aglyn/tenant-data-admin/server/media-signing'
import { registerProviderGrantRevoker } from '@aglyn/tenant-data-admin/server/provider-grant-revokers'
import { OUTREACH_API_ROUTES } from '../constants/api-routes'
import { OUTREACH_COLLECTIONS } from '../model/outreach.types'
import { readMailboxCredentials } from './mailbox-credentials'
import { readOrgId } from './mailbox-gate'
import {
  createOutreachMailboxRoutes,
  revokeMailboxGrant,
  type OutreachMailboxRouteDeps,
} from './mailbox-routes'
import { readOutreachOAuthState } from './oauth-state'
import { outreachOAuthRedirectUri } from './oauth-redirect'
import { readOutreachGoogleConfig } from './outreach-config'

/**
 * Wires the mailbox routes into the console dispatcher (AGL-2978), with the
 * production dependencies and each route's release subject.
 */

/**
 * The platform's own dependencies. Specs build their own.
 *
 * The permission resolver, the lockdown verdict, the rate limiter, the
 * activity log and the alias store are imported when a request first needs
 * them rather than when the bundle registers: `org-permissions` reaches the
 * whole tenant data barrel, and the manifest loads this bundle into every
 * console API process whether or not a mailbox route is ever called.
 */
export function defaultOutreachMailboxRouteDeps(): OutreachMailboxRouteDeps {
  return {
    firestore: () => firebaseAdmin.app().firestore(),
    gate: {
      verifyIdToken: (idToken) => firebaseAdmin.app().auth().verifyIdToken(idToken),
      resolveOrgPermissions: async (uid, context) =>
        (await import('@aglyn/tenant-runtime/org-permissions')).resolveOrgPermissions(uid, context),
      readOrg: async (orgId) => {
        const snapshot = await firebaseAdmin.app().firestore().collection('orgs').doc(orgId).get()
        return snapshot.exists ? (snapshot.data() ?? {}) : null
      },
      lockdownRefusal: async (options) =>
        (await import('@aglyn/tenant-data-admin/server/lockdown')).lockdownRefusal(options),
    },
    readConfig: readOutreachGoogleConfig,
    stateSigningConfigured: () => {
      try {
        return Boolean(tokenSigningSecret())
      } catch {
        return false
      }
    },
    redirectUri: outreachOAuthRedirectUri,
    now: Date.now,
    transport: {},
    consumeRateLimit: async (key, options) =>
      (await import('@aglyn/tenant-data-admin/server/rate-limit-store')).consumeRateLimit(key, options),
    logOrgActivity: async (orgId, actor, action, target) =>
      (await import('@aglyn/tenant-data-admin/server/organizations')).logOrgActivity(orgId, actor, action, target),
    confirmAliasesByProvider: async (firestore, input) =>
      (await import('@aglyn/tenant-data-admin/server/member-email-aliases')).confirmMemberEmailAliasesByProvider(
        firestore,
        input,
      ),
  }
}

/**
 * The org an authenticated mailbox request names — query or JSON body — for
 * the release gate. Unverified, exactly as a `hostId` is: the gate only
 * chooses which organization's rollout to read, and the route's own gate
 * refuses anyone who is not a member of it.
 */
export async function outreachOrgSubject(request: Request): Promise<PluginApiRequestSubject | null> {
  const fromQuery = readOrgId(new URL(request.url).searchParams.get('orgId'))
  if (fromQuery) return { orgId: fromQuery }
  if (request.method === 'GET' || request.method === 'HEAD') return null
  const body = (await request.json().catch(() => null)) as { orgId?: unknown } | null
  const orgId = readOrgId(body?.orgId)
  return orgId ? { orgId } : null
}

/**
 * The org AND member Google's redirect is for, read off the signed state.
 * Only a state whose signature verifies names anyone; an expired one still
 * does, so the rep who took too long lands on a page that says so rather than
 * on a 404.
 */
export function outreachOAuthCallbackSubject(request: Request): PluginApiRequestSubject | null {
  const read = readOutreachOAuthState(new URL(request.url).searchParams.get('state'), Date.now())
  if (read.ok) return { orgId: read.claims.orgId, uid: read.claims.uid }
  if (read.ok === false && read.refusal === 'state-expired') {
    const { claims } = read as { claims: { orgId: string; uid: string } }
    return { orgId: claims.orgId, uid: claims.uid }
  }
  return null
}

export function registerOutreachMailboxRoutes(
  deps: OutreachMailboxRouteDeps = defaultOutreachMailboxRouteDeps(),
): void {
  const routes = createOutreachMailboxRoutes(deps)
  const orgSubject = { subject: outreachOrgSubject }
  registerPluginApiRoute(OUTREACH_API_ROUTES.mailboxesAvailability, { web: routes.availability }, orgSubject)
  registerPluginApiRoute(OUTREACH_API_ROUTES.mailboxesConnect, { web: routes.connect }, orgSubject)
  registerPluginApiRoute(
    OUTREACH_API_ROUTES.mailboxesOAuthCallback,
    { web: routes.oauthCallback },
    { subject: outreachOAuthCallbackSubject },
  )
  registerPluginApiRoute(OUTREACH_API_ROUTES.mailboxesConnectComplete, { web: routes.connectComplete }, orgSubject)
  registerPluginApiRoute(OUTREACH_API_ROUTES.mailboxesSettings, { web: routes.settings }, orgSubject)
  registerPluginApiRoute(OUTREACH_API_ROUTES.mailboxesStatus, { web: routes.status }, orgSubject)
  registerPluginApiRoute(OUTREACH_API_ROUTES.mailboxesTest, { web: routes.test }, orgSubject)
  registerPluginApiRoute(OUTREACH_API_ROUTES.mailboxesDisconnect, { web: routes.disconnect }, orgSubject)

  // An org erasure deletes the stored grants whether or not this runs; this
  // tells Google too, when the erasing process loaded Outreach's server half.
  // A grant another organization still uses is left alone.
  registerProviderGrantRevoker(OUTREACH_COLLECTIONS.mailboxCredentials, async (stored, context) => {
    const credential = readMailboxCredentials(stored.data)
    if (!credential) return 'failed'
    const outcome = await revokeMailboxGrant(deps.firestore(), credential, deps, {
      excludeOrgId: context.erasingOrgId,
    })
    return outcome === 'kept-for-other-mailbox' ? 'kept' : outcome
  })
}
