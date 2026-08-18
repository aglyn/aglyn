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

import { buildRoute, pluginRequestFromWeb, Route } from '@aglyn/aglyn/server'
import type { AglynOrgBilling } from '@aglyn/aglyn/server'
import {
  checkSeatQuota,
  countManagerSeats,
  type HostAccessRole,
  isOrgRole,
  isOrgWideMember,
  resolveBrandingProfile,
} from '@aglyn/aglyn/server'
import { isEmailConfigured, sendEmail } from '@aglyn/shared-util-email'
import { renderSystemEmail } from '../../_lib/render-system-email'
import {
  collaboratorSeatRefusalResponse,
  emailUnverifiedResponse,
  findUserByEmailAcrossPools,
  findUserByUidAcrossPools,
  firebaseAdmin,
  getOrgDoc,
  isImpersonationSession,
  listOrgMembers,
  lockdownRefusal,
  logOrgActivity,
  memberHasOrgPermission,
  meterOrgEmail,
  notifyUsers,
  removeOrgMember,
  resolveOrgMembership,
  upsertOrgMember,
} from '@aglyn/tenant-data-admin'

const HOST_ROLES = new Set<HostAccessRole>(['admin', 'editor', 'viewer'])

function sanitizeHostAccess(
  raw: unknown,
): Record<string, HostAccessRole> {
  if (!raw || typeof raw !== 'object') return {}
  const access: Record<string, HostAccessRole> = {}
  for (const [hostId, role] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof role === 'string' && HOST_ROLES.has(role as HostAccessRole)) {
      access[hostId] = role as HostAccessRole
    }
  }
  return access
}

/**
 * Org membership management (AGL-234). GET lists members (any member of
 * the org, or staff); POST upserts/removes (org admin+, or staff).
 * Owner-safety guards: the owner's membership can't be edited or removed
 * here — ownership transfer is a deliberate future flow. Every mutation
 * runs through the Admin SDK so the reverse index and the hosts'
 * memberRoles projections stay in sync.
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET' && method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  const orgId = String(
    (method === 'GET' ? query.orgId : body?.orgId) ?? '',
  )
  if (!orgId) return Response.json({ error: 'Missing orgId' }, { status: 400 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const isStaff = decoded['staff'] === true
    const actor = await resolveOrgMembership(decoded.uid, orgId)
    if (!actor && !isStaff) {
      return Response.json({ error: 'You are not a member of that organization' }, { status: 403 })
    }

    if (method === 'GET') {
      // Lockdown verdict (AGL-1506): platform/org/user scopes — this read
      // path never reaches the POST branch's org read, so the org scope
      // rides on the request-deduped `getOrgDoc` read; distinct 423 body;
      // staff bypass is the un-panic invariant.
      const locked = await lockdownRefusal({
        request,
        staff: isStaff,
        uid: decoded.uid,
        org: (await getOrgDoc(orgId)) ?? undefined,
      })
      if (locked) return locked
      const members = await listOrgMembers(orgId)
      // `?counts=1` — the seat total WITHOUT the roster (AGL-1253).
      //
      // The quota banner used to count seats itself, with an unconstrained
      // `getDocs` on `orgs/{orgId}/members`. A list is evaluated against the
      // QUERY, so the rule's `memberUid == request.auth.uid` clause can never
      // satisfy it and the read resolves only through `isStaff()` or
      // `isOrgWideMember()` — measured denied on production 2026-08-04 for an
      // account the CLIENT had already decided was org-wide.
      //
      // The two predicates genuinely disagree: the client's
      // `isOrgWideMember` treats a legacy doc with no `allHosts` and no
      // `hostAccess` as org-wide, while the rules read
      // `get('allHosts', false)` and get `false`. Gating the query on the
      // client's answer therefore cannot be made reliable — so the banner
      // stops asking Firestore directly and asks here, where the Admin SDK
      // re-derives membership without a rule in the path.
      //
      // Counts only, deliberately: the banner needs one number, and shipping
      // the roster to satisfy it would hand every caller the names and emails
      // AGL-1026 restricted.
      if (String(query.counts ?? '') === '1') {
        return Response.json(
          {
            managerSeats: countManagerSeats(members as never),
            memberCount: members.length,
          },
          { status: 200 },
        )
      }
      return Response.json({ members }, { status: 200 })
    }

    // Permission-gated (AGL-243): members.manage covers custom roles too.
    if (
      !isStaff &&
      !(await memberHasOrgPermission(orgId, actor?.member, 'members.manage'))
    ) {
      return Response.json({ error: 'Managing members requires the members.manage permission' }, { status: 403 })
    }
    const firestore = firebaseAdmin.app().firestore()
    const orgSnapshot = await firestore.collection('orgs').doc(orgId).get()
    if (!orgSnapshot.exists) {
      return Response.json({ error: 'Unknown organization' }, { status: 404 })
    }
    // Lockdown verdict (AGL-1506): platform/org/user scopes with the org
    // doc already in hand; distinct 423 body; staff bypass is the
    // un-panic invariant.
    const locked = await lockdownRefusal({
      request,
      staff: isStaff,
      uid: decoded.uid,
      org: orgSnapshot.data(),
    })
    if (locked) return locked
    const ownerUid = orgSnapshot.data()?.['ownerUid']

    const action = String(body?.action ?? '')
    if (action === 'upsert') {
      const role = body?.role
      if (!isOrgRole(role) || role === 'owner') {
        return Response.json({ error: 'Role must be admin, editor, or viewer' }, { status: 400 })
      }
      // Resolve the target account by uid or email.
      let targetUid = String(body?.uid ?? '')
      let email: string | undefined
      let displayName: string | undefined
      // Mirrored onto the roster so member surfaces can show a face
      // (AGL-1126) — they cannot read a tenant-pool auth record themselves.
      let photoURL: string | undefined
      try {
        // Across ALL auth pools (AGL-1122). An SSO user lives in their org's
        // GCIP tenant pool, so the project-level lookup returned
        // `auth/user-not-found` for them — and this route reads that as "no
        // Aglyn account", so the client offered to send an INVITE to someone
        // who already has one. An enterprise user could never be added to a
        // second org by email.
        const found = targetUid
          ? await findUserByUidAcrossPools(targetUid)
          : await findUserByEmailAcrossPools(String(body?.email ?? ''))
        if (!found) {
          const missing = new Error('No such account') as Error & {
            code?: string
          }
          missing.code = 'auth/user-not-found'
          throw missing
        }
        targetUid = found.record.uid
        // ABSENT, never null, when the auth record carries nothing (AGL-1961).
        // This block also runs for an EXISTING member — `upsert` is the
        // role-change path — and `upsertOrgMember` documents `null` as "clear
        // the stored value" while `undefined` leaves it alone. An SSO member's
        // tenant auth record holds neither name nor photo (measured on
        // `zach@aglyn.com`: `displayName: null`, `photoURL: undefined`), so
        // `?? null` meant changing someone's role silently erased the roster
        // identity `backfillMemberIdentity` had put there for them (AGL-1131)
        // — the only copy any member surface can read (AGL-1122).
        email = found.record.email || undefined
        displayName = found.record.displayName || undefined
        photoURL = found.record.photoURL || undefined
      } catch (lookupError) {
        // Only a genuinely-missing account is the "invite them instead" 404.
        // Anything else (transient Admin SDK failure, misconfig) must NOT be
        // masked as "no account" — that made real errors look like the
        // account didn't exist, even for users who do (AGL-708).
        const code = (lookupError as { code?: string } | null)?.code
        if (code === 'auth/user-not-found' || code === 'auth/invalid-email') {
          return Response.json({
            error: 'No account with that identity — send an invite instead',
          }, { status: 404 })
        }
        throw lookupError
      }
      if (targetUid === ownerUid) {
        return Response.json({ error: "The owner's membership can't be changed here" }, { status: 400 })
      }
      const existedAlready = (
        await firestore
          .collection('orgs')
          .doc(orgId)
          .collection('members')
          .doc(targetUid)
          .get()
      ).exists
      // Manager-seat quota (AGL-471): adding a NEW org member consumes a
      // seat; role changes don't. A plan-less org resolves as `free`
      // (1 seat — the owner), not unmetered.
      // …and only a MANAGER consumes one (AGL-1113). Adding a site-scoped
      // collaborator writes an org member doc too, but that seat is metered
      // per host against `membersPerHost` at hosts/{id}/members — gating it
      // here billed and blocked it twice.
      const addingManager = isOrgWideMember({
        role,
        allHosts: body?.allHosts === true,
        hostAccess: sanitizeHostAccess(body?.hostAccess),
      })
      if (!existedAlready && addingManager) {
        const members = await firestore
          .collection('orgs')
          .doc(orgId)
          .collection('members')
          .get()
        const quota = checkSeatQuota(
          orgSnapshot.data() as any,
          'managers',
          countManagerSeats(members.docs.map((doc) => doc.data() as never)),
        )
        if (!quota.allowed) {
          return Response.json({
            error: quota.upgradeRequired
              ? `Team seat limit reached (${quota.limit}) — upgrade your ` +
                'plan to add more members'
              : `Team seats full (${quota.limit}) — add seats for ` +
                `$${quota.addonPriceUsd}/mo each from Billing`,
          }, { status: 403 })
        }
      }
      await upsertOrgMember({
        orgId,
        uid: targetUid,
        role,
        allHosts: body?.allHosts === true,
        hostAccess: sanitizeHostAccess(body?.hostAccess),
        // Custom role assignment (AGL-243): string sets, null clears,
        // absent leaves unchanged.
        roleId:
          typeof body?.roleId === 'string' && body.roleId
            ? String(body.roleId)
            : body?.roleId === null
              ? null
              : undefined,
        email,
        displayName,
        photoURL,
        // Job title (AGL-364): string sets, null clears, absent unchanged.
        title:
          typeof body?.title === 'string'
            ? String(body.title).trim().slice(0, 80)
            : body?.title === null
              ? null
              : undefined,
        invitedBy: decoded.uid,
      })
      const targetName = displayName ?? email ?? targetUid
      void logOrgActivity(
        orgId,
        { uid: decoded.uid, email: decoded.email },
        existedAlready
          ? `Changed ${targetName}'s role to ${role}`
          : `Added ${targetName} as ${role}`,
        { type: 'member', id: targetUid, name: targetName },
      )
      // In-app notification to the affected account (AGL-259).
      const grantedHosts = Object.keys(
        sanitizeHostAccess(body?.hostAccess),
      )
      void notifyUsers([targetUid], {
        type:
          !existedAlready || body?.allHosts === true
            ? 'team.roleChanged'
            : 'team.hostAccessGranted',
        title: existedAlready
          ? `Your organization role is now ${role}`
          : `You were added to an organization as ${role}`,
        ...(grantedHosts.length && body?.allHosts !== true
          ? { body: `Access to ${grantedHosts.length} site(s)` }
          : {}),
        orgId,
        // The sites list is org-scoped now (AGL-621/644); bare `/hosts` is a
        // dead route. Links are frozen at write time, so emit canonical here
        // and let the reader repair anything already stored.
        link: (orgSnapshot.get('slug') as string | undefined)
          ? buildRoute(Route.HOST_LIST, {
              orgSlug: orgSnapshot.get('slug') as string,
            })
          : '/hosts',
      })
      // Email a genuinely-new member too (AGL-768). This path only reaches
      // existing accounts — a missing account 404s to "invite instead", and
      // invites send the org-invite email — so the two never overlap.
      // Best-effort and wrapped so a send problem never fails the upsert.
      if (!existedAlready && email && isEmailConfigured()) {
        try {
          const orgName = orgSnapshot.get('name') ?? 'an organization'
          // White-label sender identity (White-Label Phase 3) off the org's
          // resolved brand, via the one shared resolver.
          const branding = resolveBrandingProfile(
            orgSnapshot.data() as Partial<AglynOrgBilling>,
          )
          const origin = headers.origin ?? `https://${headers.host}`
          const fallbackText =
            `You were added to ${orgName} as ${role}.\n\n` +
            `Sign in at ${origin} to switch to it from your dashboard.`
          const designed = await renderSystemEmail('member-added', {
            'org.name': String(orgName),
            'member.role': role,
            signInUrl: origin,
          })
          await sendEmail({
            to: email,
            subject: designed?.subject ?? `You've been added to ${orgName}`,
            text: designed?.text || fallbackText,
            ...(designed?.html ? { html: designed.html } : {}),
            fromName: branding.fromName,
            context: 'member-added',
          })
          // Cost meter (AGL-1438). Org-scoped and transactional, like the
          // invite beside it.
          await meterOrgEmail(orgId)
        } catch (memberEmailError) {
          console.error('member-added email skipped', memberEmailError)
        }
      }
      return Response.json({ ok: true, uid: targetUid }, { status: 200 })
    }

    if (action === 'remove') {
      const targetUid = String(body?.uid ?? '')
      if (!targetUid) return Response.json({ error: 'Missing uid' }, { status: 400 })
      if (targetUid === ownerUid) {
        return Response.json({ error: 'The organization owner cannot be removed' }, { status: 400 })
      }
      const targetSnapshot = await firestore
        .collection('orgs')
        .doc(orgId)
        .collection('members')
        .doc(targetUid)
        .get()
      const targetName =
        targetSnapshot.get('displayName') ??
        targetSnapshot.get('email') ??
        targetUid
      await removeOrgMember(orgId, targetUid)
      void logOrgActivity(
        orgId,
        { uid: decoded.uid, email: decoded.email },
        `Removed ${targetName} from the organization`,
        { type: 'member', id: targetUid, name: targetName },
      )
      return Response.json({ ok: true }, { status: 200 })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    // The `hostAccess` branch of this route admits a site COLLABORATOR and
    // metered nothing (AGL-2068): it gates on `isOrgWideMember`, which is
    // false for exactly that shape, so the manager quota above was skipped and
    // `upsertOrgMember` ran unconditionally. The cap now lives inside that
    // call's transaction and arrives here as an error to translate.
    const seatRefusal = collaboratorSeatRefusalResponse(error)
    if (seatRefusal) return seatRefusal
    console.error(error)
    return Response.json({ error: 'Membership operation failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
