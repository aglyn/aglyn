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
  ACCOUNT_ACQUISITION_FIELD,
  readAccountAcquisition,
  type AccountAcquisition,
} from '@aglyn/aglyn/app-utils/account-acquisition'
import {
  listPluginPersonMatchers,
  runPluginPersonMatchers,
} from '@aglyn/aglyn/plugin-manager/plugin-person-matches'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { recordAdminAudit } from '@aglyn/tenant-data-admin/server/admin-audit'
import { findUserByUidAcrossPools } from '@aglyn/tenant-data-admin/server/auth-pools'
import { getOrgForHost } from '@aglyn/tenant-data-admin/server/organizations'
import { platformMarketingHostId } from '@aglyn/tenant-data-admin/server/platform-marketing-consent'
import type { StaffAcquisitionView } from '../../../../utils/staff-acquisition'
import { readDeviceRows } from '../../_lib/device-registry'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/**
 * GET /api/admin/acquisition?uid=… | ?orgId=… — where an account, or a
 * workspace, came from (AGL-3289), for the staff Acquisition card.
 *
 * One read answers the question that used to take five tools: the record
 * written at account creation, the newest sign-in the device registry holds,
 * and whether the platform's own sales workspace already knew the person —
 * asked of every plugin that keeps people, through the person-match seam, so
 * the platform never reads another plugin's records itself.
 *
 * ## Who sees what
 *
 * Any staff role reads the record. City-level geography — where the account
 * was created from, and where it last signed in — is `super` only, the same
 * line the sign-in history card draws; other roles see the country.
 *
 * ## The look is recorded first
 *
 * The cross-check reads the sales workspace's people for this person, so the
 * access is written to `adminAudit` BEFORE the answer is served, as the other
 * person-shaped staff reads do: a card that rendered and then failed to
 * record the look would be the access that collection exists to never lose.
 */

let declarationsRepaired: Promise<void> | null = null

/** Run the app's plugin declarations once, for a process whose boot did not. */
async function ensurePersonMatchers(): Promise<void> {
  if (listPluginPersonMatchers().length) return
  if (!declarationsRepaired) {
    declarationsRepaired = import('../../../../constants/plugins.declarations.server.generated')
      .then(({ registerPluginServerDeclarations }) => registerPluginServerDeclarations())
      .catch((error) => {
        console.error('[admin/acquisition] plugin declarations failed', error)
      })
  }
  await declarationsRepaired
}

/** The country alone, for a reader who may not see the city. */
function countryOnly(location: string | null): string | null {
  if (!location) return null
  const parts = location.split(',').map((part) => part.trim()).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : null
}

function withoutCity(record: AccountAcquisition | null): AccountAcquisition | null {
  if (!record?.geo) return record
  return { ...record, geo: { country: record.geo.country, region: null, city: null } }
}

function nameOf(profile: Record<string, unknown> | undefined, fallback: string | undefined): string | null {
  const first = typeof profile?.['firstName'] === 'string' ? (profile['firstName'] as string).trim() : ''
  const last = typeof profile?.['lastName'] === 'string' ? (profile['lastName'] as string).trim() : ''
  const joined = [first, last].filter(Boolean).join(' ')
  return joined || (fallback ?? '').trim() || null
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = request.headers.get('authorization') ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  const params = new URL(request.url).searchParams
  const uidParam = (params.get('uid') ?? '').trim()
  const orgIdParam = (params.get('orgId') ?? '').trim()
  if (!uidParam === !orgIdParam) {
    return Response.json({ error: 'Pass exactly one of uid or orgId' }, { status: 400 })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) return Response.json({ error: 'Staff only' }, { status: 403 })
    const cityLevel = String(decoded['staffRole'] ?? 'support') === 'super'
    const firestore = firebaseAdmin.app().firestore()

    let scope: StaffAcquisitionView['scope'] = 'user'
    let uid = uidParam
    let stored: unknown
    if (orgIdParam) {
      scope = 'org'
      const org = await firestore.collection('orgs').doc(orgIdParam).get()
      if (!org.exists) return Response.json({ error: 'No such organization' }, { status: 404 })
      stored = org.get(ACCOUNT_ACQUISITION_FIELD)
      const copied = readAccountAcquisition(stored)?.copiedFromUid
      uid = copied || String(org.get('createdByUid') ?? org.get('ownerUid') ?? '')
    }

    const [pooled, profile] = await Promise.all([
      uid ? findUserByUidAcrossPools(uid) : Promise.resolve(null),
      uid ? firestore.collection('users').doc(uid).get() : Promise.resolve(null),
    ])
    if (scope === 'user') {
      if (!pooled && !profile?.exists) {
        return Response.json({ error: 'No such account' }, { status: 404 })
      }
      stored = profile?.get(ACCOUNT_ACQUISITION_FIELD)
    }
    const record = pooled?.record
    const createdAtMs = record ? Date.parse(record.metadata.creationTime) : NaN
    const subject: StaffAcquisitionView['subject'] = {
      uid: uid || null,
      email: record?.email ?? null,
      name: nameOf(profile?.data(), record?.displayName),
      createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : null,
      provider: record?.providerData?.[0]?.providerId ?? null,
    }

    let latestSignIn: StaffAcquisitionView['latestSignIn'] = null
    if (uid) {
      try {
        const newest = (await readDeviceRows(firestore, uid, 1))[0]
        if (newest) {
          latestSignIn = {
            location: cityLevel ? newest.location : countryOnly(newest.location),
            atMs: newest.lastSeenMs,
          }
        }
      } catch (error) {
        console.error('[admin/acquisition] sign-in history read failed', error)
      }
    }

    const acquisition = readAccountAcquisition(stored)
    const matches: StaffAcquisitionView['matches'] = {
      status: 'unconfigured',
      workspace: null,
      items: [],
      failed: [],
    }
    const houseHostId = platformMarketingHostId()
    const house = houseHostId ? await getOrgForHost(houseHostId) : null
    if (house) {
      matches.workspace = {
        orgId: house.orgId,
        slug: typeof house.org.slug === 'string' ? house.org.slug : null,
        name: typeof house.org.name === 'string' ? house.org.name : null,
      }
      await ensurePersonMatchers()
      if (!listPluginPersonMatchers().length) {
        matches.status = 'no-matchers'
      } else {
        await recordAdminAudit({
          actorUid: decoded.uid,
          action: scope === 'user' ? 'user.acquisition-viewed' : 'org.acquisition-viewed',
          target: scope === 'user' ? `users/${uid}` : `orgs/${orgIdParam}`,
          subjectUid: uid || null,
          note: 'Acquisition opened; the sales workspace was checked for this person',
        })
        const report = await runPluginPersonMatchers({
          orgId: house.orgId,
          orgSlug: matches.workspace.slug,
          email: subject.email,
          name: subject.name,
          accountCreatedAtMs: subject.createdAtMs,
        })
        matches.status = 'checked'
        matches.items = report.matches
        matches.failed = report.failed
      }
    }

    const view: StaffAcquisitionView = {
      scope,
      subject,
      acquisition: cityLevel ? acquisition : withoutCity(acquisition),
      cityLevel,
      latestSignIn,
      matches,
    }
    return Response.json(view, { status: 200, headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[admin/acquisition]', error)
    return Response.json({ error: 'Could not read where this account came from' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
