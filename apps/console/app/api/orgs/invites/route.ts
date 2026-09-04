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
  pluginRequestFromWeb,
  resolveIdpDisplayName,
  resolveIdpPhotoUrl,
} from '@aglyn/aglyn/server'
import type { AglynOrgBilling } from '@aglyn/aglyn/server'
import {
  buildRoute,
  createResourceUid,
  type HostAccessRole,
  isOrgRole,
  isOrgWideMember,
  brandMergeTokens,
  resolveBrandingProfile,
  Route,
} from '@aglyn/aglyn/server'
import { isEmailConfigured, sendEmail } from '@aglyn/shared-util-email'
import { renderSystemEmail } from '../../_lib/render-system-email'
import {
  collaboratorSeatRefusal,
  collaboratorSeatRefusalResponse,
  managerSeatRefusal,
  managerSeatRefusalResponse,
  consumeRateLimit,
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgDoc,
  isImpersonationSession,
  lockdownRefusal,
  logOrgActivity,
  memberHasOrgPermission,
  meterOrgEmail,
  notifyOrgAdmins,
  orgOwnerSeatRefusalResponse,
  resolveOrgMembership,
  upsertOrgMember,
  verifiedAccountEmails,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'

// `author` (AGL-2334). An invite carries the pending host grant, so leaving
// it out here would make the role assignable to an existing account and not
// to the address an agency actually onboards a client from.
const HOST_ROLES = new Set<HostAccessRole>([
  'admin',
  'editor',
  'author',
  'viewer',
])

/**
 * How fast one person may put invite mail in front of arbitrary addresses,
 * and how fast one org may (AGL-1907).
 *
 * `create` and `resend` are the only two authenticated paths in the product
 * that send a message from `noreply@aglyn.com` to an address the caller
 * types, and before this they had no limiter of any kind. The seat quota is
 * not one: `checkSeatQuota` is skipped entirely for a site-scoped invite
 * (`isOrgWideMember` is false when `role` is editor/viewer and `allHosts` is
 * false), so `{action:'create', role:'viewer', allHosts:false, hostAccess:{}}`
 * loops over an address list unbounded. `resend` never had a quota at all.
 * On Sep 1 the signup door opens to anyone, which turns that into a same-day
 * spam cannon aimed at our own sending domain — and a burnt domain
 * reputation is not a bill we can pay off, it is every future customer's
 * transactional mail going to spam.
 *
 * Generous on purpose, because the expensive failure here is the GREEN one.
 * A refused legitimate onboarding is a launch-morning support ticket, so
 * these sit far above any plausible human burst: an admin adding a ten-person
 * team lands nowhere near 30, and a free org — `managersPerOrg: 1`,
 * `membersPerHost: 1` — has essentially no legitimate reason to send a third.
 * The org key is the one that binds a script, since a scripted farm can mint
 * accounts but every invite it sends is still charged to one workspace.
 */
const INVITE_SEND_LIMIT_PER_ACTOR = 30
const INVITE_SEND_LIMIT_PER_ORG = 60
const INVITE_SEND_WINDOW_MS = 60 * 60 * 1000

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
      // Every confirmed address on the account (AGL-2486), so an invitation
      // sent to a secondary shows up in the banner too — otherwise `accept`
      // would honour an invite the person can never see. Bounded by
      // MAX_ACCOUNT_EMAILS, which is what keeps this inside Firestore's
      // 30-value ceiling on `in`.
      const addresses = [email, ...(await verifiedAccountEmails(decoded.uid))]
      const snapshot = await firestore
        .collectionGroup('invites')
        .where('email', 'in', Array.from(new Set(addresses)).slice(0, 30))
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

    /**
     * The gate, resolved from the STORED permission model (AGL-2464).
     *
     * This asked `canManageOrg(actor?.member.role)`, which is
     * `orgRoleAtLeast(role, 'admin')` and nothing else — it never reads
     * `orgs/{orgId}/roles/{roleId}` and never applies `member.permissions`.
     * One boolean gated the pending-invite list, `create`, `revoke` and
     * `resend`, and it was wrong in both directions: an editor handed
     * `members.manage` by a custom role could add members at
     * `/api/orgs/members` and not invite one, and an admin whose
     * `members.manage` a per-member override had CLEARED was refused there
     * and kept inviting, revoking and resending here.
     *
     * The second is the one that mattered for launch. `members.manage` is
     * effectively the root permission — a holder can edit a custom role's
     * map and assign it — so the override that was supposed to take it away
     * was decorative while the console hid the affordance and the server
     * kept honouring the POST.
     *
     * `memberHasOrgPermission` is the same resolver `/api/orgs/members`,
     * `/api/orgs/roles` and `/api/orgs/settings` ask, and it layers role
     * defaults → custom role → per-member overrides. Awaited once here
     * rather than at each of the four call sites: one read of the role doc
     * per request, and no way for two branches of the same request to
     * disagree about the same member.
     *
     * Staff still bypass. Support access is not a customer-configured
     * permission and an org must not be able to revoke it by writing to its
     * own member doc.
     */
    const actorManages =
      isStaff ||
      (await memberHasOrgPermission(orgId, actor?.member, 'members.manage'))

    // Lockdown verdict (AGL-1506): platform/org/user scopes — the action
    // branches below read the org doc lazily, so the org scope rides on the
    // request-deduped `getOrgDoc` read; distinct 423 body; staff bypass is
    // the un-panic invariant.
    const locked = await lockdownRefusal({
      request,
      staff: isStaff,
      uid: decoded.uid,
      org: (await getOrgDoc(orgId)) ?? undefined,
    })
    if (locked) return locked

    /**
     * Rate-gate the two paths that SEND (AGL-1907). Returns the 429, or null
     * to proceed.
     *
     * Placed here rather than inside `sendInviteEmail` so a refusal happens
     * before any write: gating the send alone would leave an invite row
     * created and no message, which reads to the admin as a silent failure.
     * Called after the role check and after the body is validated — a request
     * that was never going to send must not burn a token, the same ordering
     * `/api/orgs/create` pins.
     *
     * Both keys are consumed on every attempt, not short-circuited: an actor
     * who is under their own cap must still be counted against their org's,
     * or two admins could take the org to 2× the org limit between them.
     *
     * Deliberately NOT staff-bypassed. Staff bypass is the un-panic invariant
     * for lockdown — a human needs a way back in — but nobody is locked out
     * by an invite throttle, and a compromised staff session is exactly the
     * one that should not have an uncapped sending path.
     */
    const inviteSendRefusal = async (): Promise<Response | null> => {
      const [perActor, perOrg] = await Promise.all([
        consumeRateLimit(`org-invite:${decoded.uid}`, {
          limit: INVITE_SEND_LIMIT_PER_ACTOR,
          windowMs: INVITE_SEND_WINDOW_MS,
        }),
        consumeRateLimit(`org-invite-org:${orgId}`, {
          limit: INVITE_SEND_LIMIT_PER_ORG,
          windowMs: INVITE_SEND_WINDOW_MS,
        }),
      ])
      // `.allowed`, not the result object — a truthiness check would be
      // permanently true and the limit would never bite (the defect
      // AGL-1534's spec pins by name).
      const over = !perActor.allowed ? perActor : !perOrg.allowed ? perOrg : null
      if (!over) return null
      // Observable to the customer AND to staff without a Firestore query:
      // the org activity feed is the surface a support conversation already
      // starts from. Fire-and-forget — the refusal is the control.
      // `target` is REQUIRED — omitting it is a type error, and this call
      // shipped without one. The refusal is org-scoped: it happens before any
      // invite row exists, so there is no invite to point at.
      void logOrgActivity(
        orgId,
        { uid: decoded.uid, email: decoded.email },
        'Invite sending paused — too many invites in a short time',
        { type: 'org', id: orgId },
      )
      return Response.json(
        {
          error:
            'Too many invites in a short time — wait a while and try again. ' +
            'Nothing was sent.',
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(
              Math.max(1, Math.ceil((over.resetMs - Date.now()) / 1000)),
            ),
          },
        },
      )
    }

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
      const designed = await renderSystemEmail(
        'org-invite',
        {
          // AGL-2139: the brand as merge tokens, so a staff-designed template
          // renders THIS org's brand rather than a hard-coded "Aglyn". The
          // designed template wins over the fallback below — which is exactly
          // the moment white-label used to invert.
          ...brandMergeTokens(branding),
          'org.name': String(orgName),
          'invite.role': role,
          signInUrl: origin,
        },
        { brandLogoUrl: branding.emailLogoUrl },
      )
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
      // Cost meter (AGL-1438). Org-scoped and transactional: an invite the
      // cap refused would leave a new teammate unable to reach the workspace
      // they were just added to, with nothing to tell them why.
      if (result.sent) await meterOrgEmail(orgId)
      return result.sent
    }

    if (method === 'GET') {
      if (!actorManages) {
        return Response.json({ error: 'Listing invites requires the members.manage permission' }, { status: 403 })
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
        return Response.json({ error: 'Inviting members requires the members.manage permission' }, { status: 403 })
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
      // Sending gate (AGL-1907) — after the role check and the body
      // validation, before the dedup read and the write. The seat quota
      // below does NOT cover this path: a site-scoped viewer invite skips
      // `isOrgWideMember` entirely and would otherwise be unbounded.
      const invitesThrottled = await inviteSendRefusal()
      if (invitesThrottled) return invitesThrottled
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
      // seat — reusing an already-pending row does not, since it already
      // counts toward the roster this measures. A site-scoped invite becomes
      // a COLLABORATOR, not a manager (AGL-1113): it is metered per host
      // against `membersPerHost`, so it is neither gated on nor counted here.
      //
      // This is the ONE manager door that never reaches `upsertOrgMember` —
      // it writes an invite document directly — so it is the one that still
      // needs a pre-flight. The other three are enforced transactionally
      // inside that function; this one refuses at the point the admin is
      // looking at, so nobody is mailed a link that will be refused when they
      // click it. `managerSeatRefusal` counts the roster AND the pending
      // invites through the shared `readSeatEntries`, which is what stops the
      // four doors measuring four different populations.
      const managerRefusal = await managerSeatRefusal({
        orgId,
        // The request-deduped read, like the collaborator gate below — this
        // is the second of the two and must not pay for the org doc twice.
        org: ((await getOrgDoc(orgId)) ?? {}) as Partial<AglynOrgBilling>,
        becomesManager:
          !reusing &&
          isOrgWideMember({ role, allHosts: body?.allHosts === true, hostAccess }),
      })
      if (managerRefusal) return managerRefusal
      // Collaborator seats (AGL-2068) — the OTHER branch of the same
      // question, and the one nothing has ever asked. A site-scoped invite
      // becomes a COLLABORATOR, metered per host against `membersPerHost`;
      // `isOrgWideMember` is false for exactly that shape, so the manager gate
      // above deliberately skips it and no other gate existed. A free org
      // (`membersPerHost: 1`) could invite an unlimited number of people to
      // full access on its site. Skipped when reusing a pending row, for the
      // same reason the manager gate is — it already counts toward `used`.
      if (
        !reusing &&
        Object.keys(hostAccess).length &&
        !isOrgWideMember({ role, allHosts: body?.allHosts === true, hostAccess })
      ) {
        const seatRefusal = await collaboratorSeatRefusal({
          orgId,
          org: ((await getOrgDoc(orgId)) ?? {}) as any,
          hostIds: Object.keys(hostAccess),
          self: { email },
        })
        if (seatRefusal) return seatRefusal
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
        return Response.json({ error: 'Revoking invites requires the members.manage permission' }, { status: 403 })
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
        return Response.json({ error: 'Resending invites requires the members.manage permission' }, { status: 403 })
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
      // Sending gate (AGL-1907). `resend` had no quota of ANY kind — not even
      // the seat check, since the row already exists — so one pending invite
      // could be re-mailed to the same address without limit. Shares the two
      // budgets with `create`: what is being bounded is messages leaving our
      // domain, not rows.
      const resendThrottled = await inviteSendRefusal()
      if (resendThrottled) return resendThrottled
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
      /*
       * An invitation may arrive at ANY confirmed address on the account
       * (AGL-2486), not only the primary — GitHub's behaviour, and the
       * decision recorded for this issue.
       *
       * It is safe for a reason worth stating, because the neighbouring SSO
       * path deliberately does NOT do this. An invitation is an explicit
       * grant the ORG made to a person it chose: somebody with permission
       * typed this address and picked this role. Matching it against the
       * recipient's other confirmed mailboxes decides only WHICH inbox the
       * org's own grant may land in. It cannot manufacture a grant, and
       * adding an address to your account still gives you access to nothing.
       *
       * Contrast `/api/auth/sso-jit`, which matches the address the IdP
       * asserted and nothing else. There the org is not choosing anybody —
       * the IdP's assertion IS the org's statement about who this is — so
       * widening the match to addresses the account holder added would let
       * them pull in an invitation inside the one flow whose entire premise
       * is that the IdP is the authority.
       *
       * `verifiedAccountEmails` returns CONFIRMED addresses only; the
       * uniqueness index guarantees no other account holds any of them, and
       * `email_verified` on the token is still required, so an account that
       * has not confirmed its own primary accepts nothing.
       */
      const acceptableEmails = email
        ? [email, ...(await verifiedAccountEmails(decoded.uid))]
        : []
      if (
        !email ||
        !acceptableEmails.includes(String(invite['email'] ?? '')) ||
        !decoded.email_verified
      ) {
        return Response.json({
          error: 'This invite is for a different (or unverified) email',
        }, { status: 403 })
      }
      // The manager seat is charged INSIDE `upsertOrgMember`'s transaction
      // (AGL-2068 on the manager key). The gate that stood here read the
      // roster and then wrote through a separate call, so N people accepting
      // at once all measured the same roster and all passed — and it counted
      // members only, never the pending invites they were themselves holding,
      // so it enforced a smaller population than the door that issued them.
      // Both are fixed by asking in the same transaction that writes.
      await upsertOrgMember({
        orgId,
        uid: decoded.uid,
        role: invite['role'],
        allHosts: invite['allHosts'] === true,
        hostAccess: invite['hostAccess'] ?? {},
        email,
        // AGL-1131 — read from wherever the provider put them. An SSO user
        // accepting an invite joined the roster nameless and faceless.
        //
        // `undefined`, not `null`, when the assertion carries nothing
        // (AGL-1961): `upsertOrgMember` treats `null` as "clear it". This
        // branch is not gated on the member being new — an existing member
        // re-accepting an invite would otherwise have the name and photo
        // already on their row wiped by a provider that simply sends neither.
        displayName: resolveIdpDisplayName(decoded) || undefined,
        photoURL: resolveIdpPhotoUrl(decoded) || undefined,
        invitedBy: invite['invitedBy'] ?? null,
        // The invite being consumed may be addressed to a CONFIRMED secondary
        // (AGL-2486). The collaborator seat count reads pending invites, and
        // this one is still pending at this moment — so without the aliases
        // it is keyed by an address `self.email` (the primary) does not match,
        // and the accepter is billed a seat against their own acceptance.
        seatAliasEmails: acceptableEmails,
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
    // Acceptance is the hard cap for a site-scoped invite (AGL-2068):
    // `upsertOrgMember` raises the refusal from inside the grant transaction,
    // which is what makes N simultaneous accepts land as one.
    const seatRefusal = collaboratorSeatRefusalResponse(error)
    if (seatRefusal) return seatRefusal
    // The owner seat (AGL-1888). ACCEPTANCE is the door this reaches us
    // through: it passes the invite doc's stored role into `upsertOrgMember`
    // without re-validating it, so an invitation addressed to the OWNER'S own
    // verified address used to demote them out of their own organization
    // permanently. Refused in the grant transaction, mapped here so the
    // person clicking a legitimate-looking invite gets told why rather than a
    // bare 500. Nothing was written and the invite is left unaccepted.
    const ownerRefusal = orgOwnerSeatRefusalResponse(error)
    if (ownerRefusal) return ownerRefusal
    // Accepting an invite into a full org (AGL-2068 on the manager key). The
    // refusal is now raised inside the grant transaction, so it arrives here
    // as a throw rather than as an early return.
    const managerRefusal = managerSeatRefusalResponse(error)
    if (managerRefusal) return managerRefusal
    console.error(error)
    return Response.json({ error: 'Invite operation failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
