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
 * The platform's own dependencies for the accounting routes and the tick
 * (AGL-3614). Specs build their own.
 *
 * The permission resolver, the lockdown verdict and the activity log are
 * imported when a request first needs them rather than when the bundle
 * registers: `org-permissions` reaches the whole tenant data barrel, and the
 * manifest loads this bundle into every console API process whether or not
 * an accounting route is ever called.
 */

import type { PluginApiRequestSubject } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { getLockdownVerdict, lockdownRefusal } from '@aglyn/tenant-data-admin/server/lockdown'
import { tokenSigningSecret } from '@aglyn/tenant-data-admin/server/media-signing'
import { logOrgActivity } from '@aglyn/tenant-data-admin/server/organizations'
import type { AccountingProviderId } from '../model/accounting.types'
import { readAccountingKeyring, readAccountingProviderConfig } from './accounting-config'
import { readOrgId } from './accounting-gate'
import type { AccountingRouteDeps } from './accounting-routes'
import { readAccountingOAuthState } from './oauth-state'
import { accountingOAuthRedirectUri } from './oauth-redirect'
import type { AccountingHttpOptions } from './providers/http'
import type { AccountingProvider } from './providers/provider'
import { createQuickBooksProvider } from './providers/quickbooks'
import { createXeroProvider } from './providers/xero'
import type { AccountingJobDeps } from './sync-job'

/** The Admin Firestore, for a body loaded lazily by the declarations. */
export function platformFirestore(): FirebaseFirestore.Firestore {
  return firebaseAdmin.app().firestore()
}

/** The adapter for a provider with this deployment's credentials, or `null`. */
export function platformAccountingProvider(
  provider: AccountingProviderId,
  options: AccountingHttpOptions = {},
): AccountingProvider | null {
  const config = readAccountingProviderConfig(provider)
  if (!config.configured) return null
  const { clientId, clientSecret, environment, scopes } = config.config
  return provider === 'quickbooks'
    ? createQuickBooksProvider({ clientId, clientSecret, environment }, options)
    : createXeroProvider({ clientId, clientSecret, scopes }, options)
}

/** A fetch that reports each call, for the daily budget. */
const countingFetch =
  (onCall: () => void): typeof fetch =>
  (input, init) => {
    onCall()
    return fetch(input, init)
  }

export function defaultAccountingRouteDeps(): AccountingRouteDeps {
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
      lockdownRefusal: (options) => lockdownRefusal(options),
    },
    readProviderConfig: readAccountingProviderConfig,
    providerFor: (provider) => platformAccountingProvider(provider),
    stateSigningConfigured: () => {
      try {
        return Boolean(tokenSigningSecret())
      } catch {
        return false
      }
    },
    redirectUri: accountingOAuthRedirectUri,
    now: Date.now,
    logOrgActivity: (orgId, actor, action, target) => logOrgActivity(orgId, actor, action, target),
  }
}

export function defaultAccountingJobDeps(): AccountingJobDeps {
  return {
    firestore: () => firebaseAdmin.app().firestore(),
    keyring: readAccountingKeyring,
    providerFor: (provider, onCall) => platformAccountingProvider(provider, { fetch: countingFetch(onCall) }),
    now: Date.now,
    stripeKey: () => String(process.env['STRIPE_SECRET_KEY'] ?? '').trim() || null,
    orgLocked: async (orgId) => {
      const snapshot = await firebaseAdmin.app().firestore().collection('orgs').doc(orgId).get()
      if (!snapshot.exists) return true
      return Boolean(await getLockdownVerdict({ org: snapshot.data() as never, request: { method: 'POST' } }))
    },
  }
}

/**
 * The org an authenticated request names — query or JSON body — for the
 * dispatcher's release gate. Unverified, as a `hostId` is: the gate only
 * chooses whose rollout to read, and the route's own gate refuses anyone who
 * is not a member.
 */
export async function accountingOrgSubject(request: Request): Promise<PluginApiRequestSubject | null> {
  const fromQuery = readOrgId(new URL(request.url).searchParams.get('orgId'))
  if (fromQuery) return { orgId: fromQuery }
  if (request.method === 'GET' || request.method === 'HEAD') return null
  const body = (await request.json().catch(() => null)) as { orgId?: unknown } | null
  const orgId = readOrgId(body?.orgId)
  return orgId ? { orgId } : null
}

/** The org and member a provider's redirect is for, read off the signed state. */
export function accountingOAuthCallbackSubject(request: Request): PluginApiRequestSubject | null {
  const read = readAccountingOAuthState(new URL(request.url).searchParams.get('state'), Date.now())
  if (read.ok) return { orgId: read.claims.orgId, uid: read.claims.uid }
  if (read.ok === false && read.refusal === 'state-expired') {
    const { claims } = read as { claims: { orgId: string; uid: string } }
    return { orgId: claims.orgId, uid: claims.uid }
  }
  return null
}
