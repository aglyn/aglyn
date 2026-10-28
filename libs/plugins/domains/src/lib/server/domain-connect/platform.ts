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

import { holdsSiteKey } from '@aglyn/aglyn/app-utils/host-permissions'
import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { resolveHostEnabledPlugins } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import { isDevelopmentRuntime } from '@aglyn/aglyn/server'
import {
  connectHostCustomDomain,
  getHostDocAdmin,
  getOrgForHost,
  HOST_CNAME_TWIN_FIELD,
  validatePlatformDomain,
} from '@aglyn/tenant-data-admin'
import { readConfiguredPublicUrl } from '@aglyn/tenant-data-admin/server/configured-url-fetch'
import { lookupTxt } from '@aglyn/tenant-data-admin/server/dns-probe'
import { domainStateServes } from '@aglyn/tenant-data-admin/server/domain-provider'
import {
  firebaseAdmin,
  isEmailVerified,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin/server/firebase-admin'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import { getLockdownVerdict } from '@aglyn/tenant-data-admin/server/lockdown'
import {
  checkTenantDnsPointing,
  TENANT_DNS_DOMAIN_PATTERN,
} from '@aglyn/tenant-data-admin/server/tenant-dns-check'
import { BUNDLE_ID, DOMAINS_COLLECTIONS } from '../../constants/bundle-common'
import { readDomainConnectConfig } from './config'
import { discoverDomainConnect } from './discovery'
import type { DomainConnectEngineDeps, DomainConnectStore } from './engine'
import type { DomainConnectRouteDeps } from './handlers'
import { newDomainConnectState, type DomainConnectSession } from './session'

/*
 * One-click DNS wired to the platform (AGL-3963): Firestore, the ID-token
 * verifier, core's DNS check and its one connect. Everything above this
 * file takes these as arguments, so the specs drive the same code with
 * doubles.
 */

const sessions = () =>
  firebaseAdmin.app().firestore().collection(DOMAINS_COLLECTIONS.connectSessions)

export function firestoreDomainConnectStore(): DomainConnectStore {
  return {
    async get(id) {
      const snapshot = await sessions().doc(id).get()
      return snapshot.exists ? (snapshot.data() as DomainConnectSession) : null
    },
    async create(id, session) {
      await sessions().doc(id).create(session)
    },
    async update(id, patch) {
      await sessions().doc(id).set(patch, { merge: true })
    },
    async lease(id, nowMs, untilMs) {
      const firestore = firebaseAdmin.app().firestore()
      const ref = sessions().doc(id)
      return firestore.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref)
        if (!snapshot.exists) return null
        const session = snapshot.data() as DomainConnectSession
        if ((session.leaseUntilMs ?? 0) > nowMs) return null
        tx.set(ref, { leaseUntilMs: untilMs }, { merge: true })
        return { ...session, leaseUntilMs: untilMs }
      })
    },
    async listDue(nowMs, limit) {
      // One field, a range and its own order: the single-field index answers
      // it, and a terminal session (null) is never in it.
      const snapshot = await sessions()
        .where('nextCheckAtMs', '<=', nowMs)
        .orderBy('nextCheckAtMs')
        .limit(limit)
        .get()
      return snapshot.docs.map((doc) => ({ id: doc.id, session: doc.data() as DomainConnectSession }))
    },
  }
}

async function readSite(hostId: string) {
  const [resolved, host] = await Promise.all([getOrgForHost(hostId), getHostDocAdmin(hostId)])
  if (!resolved || !host) return null
  return { orgId: resolved.orgId, org: resolved.org as Record<string, unknown>, host }
}

const entitled = (org: Record<string, unknown>) => checkEntitlement(org as never, 'customDomain')

/**
 * Whether the session's owner may still connect its domain, asked by the
 * sweep hours after the route asked: the site exists, they are still its
 * admin, the plan still has custom domains, Domains is still on for the
 * site, and nothing is locked down.
 */
async function stillPermitted(session: DomainConnectSession): Promise<string | null> {
  const site = await readSite(session.hostId)
  if (!site || site.orgId !== session.orgId) return 'unknown-site'
  // "Manage site settings" (`site.manage`, AGL-4047), as the route asked it.
  if (!holdsSiteKey(site.host, session.createdBy, 'site.manage')) return 'not-admin'
  if (!entitled(site.org)) return 'not-entitled'
  const enabled = resolveHostEnabledPlugins(
    site.org as { enabledPlugins?: string[] },
    site.host as { disabledPlugins?: string[]; enabledPlugins?: string[] },
  )
  if (!enabled.includes(BUNDLE_ID)) return 'plugin-off'
  const locked = await getLockdownVerdict({
    uid: session.createdBy,
    org: site.org as never,
    host: site.host as never,
    request: { method: 'POST' },
  })
  return locked ? 'locked' : null
}

export function platformDomainConnectEngine(
  options: { recheckOwner: boolean },
): DomainConnectEngineDeps {
  return {
    store: firestoreDomainConnectStore(),
    async pointsHere(name) {
      if (!TENANT_DNS_DOMAIN_PATTERN.test(name)) return false
      const check = await checkTenantDnsPointing(name, { softPass: isDevelopmentRuntime() })
      return check.verified
    },
    async connect({ hostId, domain, twin, actor }) {
      const result = await connectHostCustomDomain({ hostId, domain, twin, actor })
      if (result.ok === 'refused') return { ok: 'refused', code: result.code }
      return { ok: 'connected', servingPending: !domainStateServes(result.state) }
    },
    ...(options.recheckOwner ? { permitted: stillPermitted } : {}),
    now: Date.now,
  }
}

async function heldElsewhere(names: readonly string[], hostId: string): Promise<boolean> {
  const hosts = firebaseAdmin.app().firestore().collection('hosts')
  const reads = names.flatMap((name) => [
    hosts.where('cname', '==', name).limit(2).get(),
    hosts.where(HOST_CNAME_TWIN_FIELD, '==', name).limit(2).get(),
  ])
  const snapshots = await Promise.all(reads)
  return snapshots.some((snapshot) => snapshot.docs.some((doc) => doc.id !== hostId))
}

async function customDomainPath(session: DomainConnectSession): Promise<string | null> {
  const site = await readSite(session.hostId)
  const slug = typeof site?.org['slug'] === 'string' ? site.org['slug'] : ''
  const subdomain = typeof site?.host['subdomain'] === 'string' ? site.host['subdomain'] : ''
  if (!slug || !subdomain) return null
  return `/${encodeURIComponent(slug)}/hosts/${encodeURIComponent(subdomain)}/admin/domain`
}

export function platformDomainConnectRouteDeps(): DomainConnectRouteDeps {
  return {
    config: () => readDomainConnectConfig(),
    async verifyIdToken(token) {
      try {
        const decoded = await firebaseAdmin.app().auth().verifyIdToken(token)
        return {
          uid: decoded.uid,
          email: decoded.email ? String(decoded.email) : null,
          staff: decoded['staff'] === true,
          emailVerified: isEmailVerified(decoded) || isImpersonationSession(decoded),
        }
      } catch (error) {
        if (isRefusedIdToken(error)) return 'refused'
        throw error
      }
    },
    readSite,
    entitled,
    validateDomain: (input) =>
      validatePlatformDomain(input, {
        invalid: 'Enter a valid domain, for example example.com',
        reserved: 'That domain is reserved by the platform and cannot be connected to a site',
      }),
    discover: (domain, providerId) =>
      discoverDomainConnect(domain, providerId, {
        lookupTxt,
        read: (url, init, options) => readConfiguredPublicUrl(url, init, options),
        now: Date.now,
      }),
    heldElsewhere,
    customDomainPath,
    engine: platformDomainConnectEngine({ recheckOwner: false }),
    newState: newDomainConnectState,
    now: Date.now,
  }
}
