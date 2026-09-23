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
  FIRST_PARTY_HOSTS_MAX,
  FIRST_PARTY_HOSTS_SETTINGS_DOC,
  normalizeFirstPartyHostEntry,
} from '@aglyn/aglyn/app-utils/first-party-hosts'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { recordAdminAudit } from '@aglyn/tenant-data-admin/server/admin-audit'
import {
  builtInHosts,
  FIRST_PARTY_HOSTS_COLLECTION,
  invalidateFirstPartyHostsCache,
  readConfiguredFirstPartyHosts,
  writeConfiguredFirstPartyHosts,
} from '@aglyn/tenant-data-admin/server/first-party-hosts'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/**
 * The first-party host registry, as a control (AGL-3289).
 *
 * Which hosts are the platform's OWN decides what the first-touch capture
 * treats as an internal hop rather than a source, and where it runs at all.
 * Most of the list is built from configuration and shown read-only; the rest
 * is what staff add here for a surface the configuration cannot name — a
 * forum, a status page, another apex. Adding one is the whole job of
 * "adding a first-party surface", beside including the capture.
 *
 * Same posture as the other platform settings: any staff role may READ, only
 * `super` may CHANGE, a reason is required, and the change is written to
 * `adminAudit` with the list before and after. Other processes converge
 * within the registry's cache lifetime; this one serves the change at once.
 */

const NOTE_MAX = 500

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'PUT') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = request.headers.get('authorization') ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) return Response.json({ error: 'Staff only' }, { status: 403 })
    const role = String(decoded['staffRole'] ?? 'support')

    if (request.method === 'GET') {
      return Response.json(
        { role, builtIn: builtInHosts(), configured: await readConfiguredFirstPartyHosts(), max: FIRST_PARTY_HOSTS_MAX },
        { status: 200, headers: { 'cache-control': 'no-store' } },
      )
    }

    if (role !== 'super') {
      return Response.json({ error: 'Requires the super staff role' }, { status: 403 })
    }
    const body = await request.json().catch(() => null)
    const note = String(body?.note ?? '').trim().slice(0, NOTE_MAX)
    if (!note) {
      return Response.json(
        { error: 'A reason is required — it is written to the audit log' },
        { status: 400 },
      )
    }
    const entries: unknown[] = Array.isArray(body?.hosts) ? body.hosts : []
    const refused = entries.filter((entry) => !normalizeFirstPartyHostEntry(entry))
    if (refused.length) {
      return Response.json(
        { error: `Not a host: ${refused.map((entry) => String(entry)).join(', ')}`, refused },
        { status: 400 },
      )
    }
    const hosts = [...new Set(entries.map((entry) => normalizeFirstPartyHostEntry(entry)))]
    if (hosts.length > FIRST_PARTY_HOSTS_MAX) {
      return Response.json(
        { error: `At most ${FIRST_PARTY_HOSTS_MAX} hosts can be added` },
        { status: 400 },
      )
    }

    const before = await readConfiguredFirstPartyHosts()
    await writeConfiguredFirstPartyHosts(hosts, decoded.email ?? decoded.uid)
    invalidateFirstPartyHostsCache()
    await recordAdminAudit({
      actorUid: decoded.uid,
      action: 'firstPartyHosts.update',
      target: `${FIRST_PARTY_HOSTS_COLLECTION}/${FIRST_PARTY_HOSTS_SETTINGS_DOC}`,
      note: `${note} (before: ${before.hosts.join(', ') || 'none'}; after: ${hosts.join(', ') || 'none'})`,
    })
    return Response.json(
      { ok: true, builtIn: builtInHosts(), configured: await readConfiguredFirstPartyHosts() },
      { status: 200 },
    )
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[admin/first-party-hosts]', error)
    return Response.json({ error: 'First-party hosts operation failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as PUT }
