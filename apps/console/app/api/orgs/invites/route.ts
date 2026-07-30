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
import type { AglynOrgBilling } from '@aglyn/aglyn/server'
import {
  buildRoute,
  canManageOrg,
  checkSeatQuota,
  countManagerSeats,
  createResourceUid,
  type HostAccessRole,
  isOrgRole,
  isOrgWideMember,
  resolveBrandingProfile,
  Route,
} from '@aglyn/aglyn/server'
import { isEmailConfigured, sendEmail } from '@aglyn/shared-util-email'
import { renderSystemEmail } from '../../_lib/render-system-email'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  logOrgActivity,
  notifyOrgAdmins,
  resolveOrgMembership,
  upsertOrgMember,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'

const HOST_ROLES = new Set<HostAccessRole>(['admin', 'editor', 'viewer'])

/**
 * Org invites (AGL-234) for people without Aglyn accounts yet. Admins
 * create/revoke; anyone signed in with a matching verified email accepts,
 * which materializes the membership via the same Admin-SDK path as direct
 * adds (reverse index + host projections included). Invite emails send via
 * Resend when RESEND_API_KEY + USAGE_EMAIL_FROM are configured (the response
 * reports `emailed`); invites also surface in the console after sign-in.
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
  const mine = method === 'GET' && query.mine === '1'
  if (!orgId && !mine) return Response.json({ error: 'Missing orgId' }, { status: 400 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }

    // Cross-org "invites for me" (AGL-234): pending invites addressed to
    // the caller's verified email, joined with the org names so the
    // console banner can render without extra reads.
    if (mine) {
      const email = String(decoded.email ?? '').toLowerCase()
      if (!email || !decoded.email_verified) {
        return Response.json({ invites: [] }, { status: 200 })
      }
      const firestore = firebaseAdmin.app().firestore()
      const snapshot = await firestore
        .collectionGroup('invites')
        .where('email', '==', email)
        .where('acceptedAt', '==', null)
        .limit(20)
        .get()
      const invites = await Promise.all(
        snapshot.docs.map(async (inviteDoc) => {
          const orgRef = inviteDoc.ref.parent.parent
          const orgSnapshot = orgRef ? await orgRef.get() : null
          return {
            $id: inviteDoc.id,
            orgId: orgRef?.id ?? null,
            orgName: orgSnapshot?.get('name') ?? null,
            role: inviteDoc.get('role') ?? null,
          }
        }),
      )
      return Response.json({ invites }, { status: 200 })
    }
    const isStaff = decoded['staff'] === true
    const actor = await resolveOrgMembership(decoded.uid, orgId)
    const firestore = firebaseAdmin.app().firestore()
    const invitesRef = firestore
      .collection('orgs')
      .doc(orgId)
      .collection('invites')

    const actorManages = isStaff || canManageOrg(actor?.member.role)

    /**
     * The org's slug, for the deep link on admin notifications (AGL-1116).
     * Links are frozen at write time, so a notification emitted for a
     * slug-less org gets none rather than a route that would 404 later.
     */
    const orgSlugForLink = async (): Promise<string | undefined> => {
      const snapshot = await firestore.collection('orgs').doc(orgId).get()
      const slug = snapshot.get('slug')
      return typeof slug === 'string' && slug ? slug : undefined
    }

    // Shared invite-email send (AGL-853): both `create` and the new `resend`
    // deliver the same message. Best-effort — returns whether a message
    // actually went out (unconfigured or a failed send both report false), so
    // the client can say so honestly.
    const sendInviteEmail = async (
      email: string,
      role: string,
    ): Promise<boolean> => {
      if (!isEmailConfigured()) {
        console.warn(
          'invite email skipped — set RESEND_API_KEY and USAGE_EMAIL_FROM ' +
            'to deliver invite emails',
        )
        return false
      }
      const orgSnapshot = await firestore.collection('orgs').doc(orgId).get()
      const orgName = orgSnapshot.get('name') ?? 'an organization'
      // White-label brand (White-Label Phase 3): a white-label org's invite
      // reads as its brand — sender display-name and product name — resolved
      // through the one shared resolver so it matches every other surface.
      const branding = resolveBrandingProfile(
        orgSnapshot.data() as Partial<AglynOrgBilling>,
      )
      const origin = headers.origin ?? `https://${headers.host}`
      const fallbackText =
        `You've been invited to join ${orgName} as ${role}.\n\n` +
        `Sign in at ${origin} with this email address and accept ` +
        'the invite from your dashboard.'
      // Staff-designed template when one is published (AGL-750); null
      // whenever it is missing or unusable, so this copy still goes out.
      const designed = await renderSystemEmail('org-invite', {
        'org.name': String(orgName),
        'invite.role': role,
        signInUrl: origin,
      })
      const result = await sendEmail({
        to: email,
        subject:
          designed?.subject ??
          `You've been invited to ${orgName} on ${branding.productName}`,
        text: designed?.text || fallbackText,
        ...(designed?.html ? { html: designed.html } : {}),
        fromName: branding.fromName,
        context: 'invite',
      })
      return result.sent
    }

    if (method === 'GET') {
      if (!actorManages) {
        return Response.json({ error: 'Listing invites requires the admin role' }, { status: 403 })
      }
      const snapshot = await invitesRef
        .where('acceptedAt', '==', null)
        .limit(100)
        .get()
      return Response.json({
        invites: snapshot.docs.map((doc) => ({ $id: doc.id, ...doc.data() })),
      }, { status: 200 })
    }

    const action = String(body?.action ?? '')

    if (action === 'create') {
      if (!actorManages) {
        return Response.json({ error: 'Inviting members requires the admin role' }, { status: 403 })
      }
      const email = String(body?.email ?? '')
        .trim()
        .toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return Response.json({ error: 'Invalid email' }, { status: 400 })
      }
      const role = body?.role
      if (!isOrgRole(role) || role === 'owner') {
        return Response.json({ error: 'Role must be admin, editor, or viewer' }, { status: 400 })
      }
      const hostAccess: Record<string, HostAccessRole> = {}
      for (const [hostId, hostRole] of Object.entries(
        (body?.hostAccess ?? {}) as Record<string, unknown>,
      )) {
        if (
          typeof hostRole === 'string' &&
          HOST_ROLES.has(hostRole as HostAccessRole)
        ) {
          hostAccess[hostId] = hostRole as HostAccessRole
        }
      }
      // Dedup (AGL-1111): one pending invite per address. Re-inviting someone
      // who already has a pending invite UPDATES it (correcting the role/site
      // access + re-sending), rather than stacking a second row — two rows for
      // one person also double-counted the seat quota and left two accept
      // links. Two `==` filters need no composite index (single-field merge).
      const existingPending = await invitesRef
        .where('email', '==', email)
        .where('acceptedAt', '==', null)
        .limit(1)
        .get()
      const reusing = !existingPending.empty
      // Manager-seat quota (AGL-471): only a genuinely NEW invite consumes a
      // seat — reusing an already-pending row does not, so skip the gate then
      // (it already counts toward `used`). Accept re-checks authoritatively.
      // A site-scoped invite becomes a COLLABORATOR, not a manager (AGL-1113):
      // it is metered per host against `membersPerHost`, so it must not be
      // gated on — or counted toward — the manager quota.
      if (!reusing && isOrgWideMember({ role, allHosts: body?.allHosts === true, hostAccess })) {
        const orgRef = firestore.collection('orgs').doc(orgId)
        const [orgSnapshot, members, pendingInvites] = await Promise.all([
          orgRef.get(),
          orgRef.collection('members').get(),
          invitesRef.where('acceptedAt', '==', null).get(),
        ])
        // Managers only, on both sides: the roster mixes managers and
        // collaborators, and so does the pending-invite list.
        const used =
          countManagerSeats(members.docs.map((doc) => doc.data() as never)) +
          countManagerSeats(
            pendingInvites.docs.map((doc) => doc.data() as never),
          )
        const quota = checkSeatQuota(orgSnapshot.data() as any, 'managers', used)
        if (!quota.allowed) {
          return Response.json({
            error: quota.upgradeRequired
              ? `Team seat limit reached (${quota.limit}) — upgrade your ` +
                'plan to invite more members'
              : `Team seats full (${quota.limit}) — add seats for ` +
                `$${quota.addonPriceUsd}/mo each from Billing`,
          }, { status: 403 })
        }
      }
      const inviteId = reusing
        ? existingPending.docs[0].id
        : createResourceUid()
      await invitesRef.doc(inviteId).set(
        {
          email,
          role,
          allHosts: body?.allHosts === true,
          hostAccess,
          invitedBy: decoded.uid,
          createdAt: FieldValue.serverTimestamp(),
          acceptedAt: null,
        },
        { merge: true },
      )
      void logOrgActivity(
        orgId,
        { uid: decoded.uid, email: decoded.email },
        `${reusing ? 'Updated invite for' : 'Invited'} ${email} as ${role}`,
        { type: 'invite', id: inviteId, name: email },
      )
      // Best-effort delivery via Resend (AGL-708): the invite works without
      // it — the console banner surfaces it after sign-in either way.
      const emailed = await sendInviteEmail(email, role)
      // Tell the org's admins (AGL-1116). Until now a pending invite left no
      // trace outside the activity log, which nobody watches: the `team.invite`
      // notification type has existed since AGL-259 with no emitter at all.
      // The invitee cannot be notified in-app — they have no account yet — so
      // the admins are the only audience there is, and whether the email
      // actually went out is the part they cannot otherwise find out.
      const inviteSlug = await orgSlugForLink()
      void notifyOrgAdmins(orgId, {
        type: 'team.invite',
        title: `${reusing ? 'Invite updated for' : 'Invited'} ${email}`,
        body:
          `Role: ${role}. ` +
          (emailed
            ? 'Invite email sent.'
            : 'No invite email was sent — they will see it when they sign in.'),
        ...(inviteSlug
          ? { link: buildRoute(Route.MANAGE_TEAM, { orgSlug: inviteSlug }) }
          : {}),
      })
      return Response.json(
        { ok: true, inviteId, emailed, updated: reusing },
        { status: 200 },
      )
    }

    if (action === 'revoke') {
      if (!actorManages) {
        return Response.json({ error: 'Revoking invites requires the admin role' }, { status: 403 })
      }
      const inviteId = String(body?.inviteId ?? '')
      if (!inviteId) return Response.json({ error: 'Missing inviteId' }, { status: 400 })
      const revokedSnapshot = await invitesRef.doc(inviteId).get()
      const revokedEmail = revokedSnapshot.get('email') ?? inviteId
      await invitesRef.doc(inviteId).delete()
      void logOrgActivity(
        orgId,
        { uid: decoded.uid, email: decoded.email },
        `Revoked invite for ${revokedEmail}`,
        { type: 'invite', id: inviteId, name: revokedEmail },
      )
      return Response.json({ ok: true }, { status: 200 })
    }

    if (action === 'resend') {
      if (!actorManages) {
        return Response.json({ error: 'Resending invites requires the admin role' }, { status: 403 })
      }
      const inviteId = String(body?.inviteId ?? '')
      if (!inviteId) return Response.json({ error: 'Missing inviteId' }, { status: 400 })
      const snapshot = await invitesRef.doc(inviteId).get()
      const invite = snapshot.data()
      if (!snapshot.exists || !invite) {
        return Response.json({ error: 'Invite not found' }, { status: 404 })
      }
      if (invite['acceptedAt']) {
        return Response.json({ error: 'Invite already accepted' }, { status: 409 })
      }
      const emailed = await sendInviteEmail(
        String(invite['email']),
        String(invite['role'] ?? 'viewer'),
      )
      void logOrgActivity(
        orgId,
        { uid: decoded.uid, email: decoded.email },
        `Resent invite for ${invite['email']}`,
        { type: 'invite', id: inviteId, name: String(invite['email']) },
      )
      return Response.json({ ok: true, emailed }, { status: 200 })
    }

    if (action === 'accept') {
      const inviteId = String(body?.inviteId ?? '')
      if (!inviteId) return Response.json({ error: 'Missing inviteId' }, { status: 400 })
      const snapshot = await invitesRef.doc(inviteId).get()
      const invite = snapshot.data()
      if (!snapshot.exists || !invite) {
        return Response.json({ error: 'Invite not found' }, { status: 404 })
      }
      if (invite['acceptedAt']) {
        return Response.json({ error: 'Invite already accepted' }, { status: 409 })
      }
      const email = String(decoded.email ?? '').toLowerCase()
      if (!email || email !== invite['email'] || !decoded.email_verified) {
        return Response.json({
          error: 'This invite is for a different (or unverified) email',
        }, { status: 403 })
      }
      // Manager-seat quota (AGL-471): accept is where the seat is actually
      // consumed — authoritative re-check (already-members re-accepting
      // don't add a seat, but the upsert is idempotent for them anyway).
      const existingMember = await firestore
        .collection('orgs')
        .doc(orgId)
        .collection('members')
        .doc(decoded.uid)
        .get()
      // Accepting a SITE-SCOPED invite makes the user a collaborator, metered
      // per host — never a manager seat (AGL-1113). Only an org-wide invite
      // re-checks the manager gate here.
      const acceptingAsManager = isOrgWideMember({
        role: invite['role'],
        allHosts: invite['allHosts'] === true,
        hostAccess: invite['hostAccess'] ?? {},
      })
      if (!existingMember.exists && acceptingAsManager) {
        const [orgSnapshot, members] = await Promise.all([
          firestore.collection('orgs').doc(orgId).get(),
          firestore
            .collection('orgs')
            .doc(orgId)
            .collection('members')
            .get(),
        ])
        const quota = checkSeatQuota(
          orgSnapshot.data() as any,
          'managers',
          countManagerSeats(members.docs.map((doc) => doc.data() as never)),
        )
        if (!quota.allowed) {
          return Response.json({
            error:
              `This organization is out of team seats (${quota.limit}) — ` +
              'ask its owner to add seats or upgrade from Billing',
          }, { status: 403 })
        }
      }
      await upsertOrgMember({
        orgId,
        uid: decoded.uid,
        role: invite['role'],
        allHosts: invite['allHosts'] === true,
        hostAccess: invite['hostAccess'] ?? {},
        email,
        displayName: (decoded['name'] as string | undefined) ?? null,
        photoURL: (decoded['picture'] as string | undefined) ?? null,
        invitedBy: invite['invitedBy'] ?? null,
      })
      await invitesRef.doc(inviteId).set(
        {
          acceptedAt: FieldValue.serverTimestamp(),
          acceptedBy: decoded.uid,
        },
        { merge: true },
      )
      void logOrgActivity(
        orgId,
        { uid: decoded.uid, email: decoded.email },
        `Joined the organization as ${invite['role']}`,
        { type: 'member', id: decoded.uid, name: email },
      )
      // Close the loop for whoever invited them (AGL-1116): an admin who sent
      // an invite had no way to learn it was taken up short of re-opening the
      // Team page and noticing the pending row had gone.
      const acceptSlug = await orgSlugForLink()
      void notifyOrgAdmins(orgId, {
        type: 'team.invite',
        title: `${email} accepted their invitation`,
        body: `They joined as ${invite['role']}.`,
        ...(acceptSlug
          ? { link: buildRoute(Route.MANAGE_TEAM, { orgSlug: acceptSlug }) }
          : {}),
      })
      return Response.json({ ok: true }, { status: 200 })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Invite operation failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
