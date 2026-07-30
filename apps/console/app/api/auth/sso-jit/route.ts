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
import { checkEntitlement, type OrgRole } from '@aglyn/aglyn/server'
import {
  firebaseAdmin,
  logOrgActivity,
  resolveOrgMembership,
  seedUserProfile,
  upsertOrgMember,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * Just-in-time org mapping for SSO sign-ins (AGL-1101). After a user completes
 * the SAML redirect, their Firebase user lives in the org's GCIP tenant with a
 * brand-new uid and no console access yet. The sign-in page calls this once
 * with that tenant ID token; it lands the user in the org with a role.
 *
 * Security (spec, non-negotiable):
 *  - re-verify the token **against the tenant** (`authForTenant`), never the
 *    default auth — the client's tenant claim is not trusted;
 *  - the org is resolved from `org.sso.tenantId` (server-side), the domain of
 *    the verified email must be one the org has **verified** (`sso.domains` +
 *    `domainVerified`), and the org must still carry the `ssoEnabled`
 *    entitlement — otherwise a disabled/mis-scoped IdP can't mint access;
 *  - a pending invite for that email sets the role (and is consumed); absent
 *    one, the org's `sso.defaultRole` (or `viewer`) is granted.
 * Idempotent: re-running just re-affirms the membership. Audited.
 */
const ORG_ROLES = new Set<OrgRole>(['admin', 'editor', 'viewer'])

async function handler(request: Request): Promise<Response> {
  const { method, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const auth = firebaseAdmin.app().auth()
    const firestore = firebaseAdmin.app().firestore()

    // Peek at the tenant on the token, then re-verify against THAT tenant so a
    // forged/foreign tenant claim can't slip through the default verifier.
    const peek = await auth.verifyIdToken(idToken)
    const tenantId = peek.firebase?.tenant
    if (!tenantId) {
      return Response.json({ error: 'Not an SSO session' }, { status: 400 })
    }
    const decoded = await auth
      .tenantManager()
      .authForTenant(tenantId)
      .verifyIdToken(idToken)
    const email = String(decoded.email ?? '').toLowerCase()
    if (!email || !decoded.email_verified) {
      return Response.json({ error: 'Unverified SSO email' }, { status: 403 })
    }
    const domain = email.slice(email.lastIndexOf('@') + 1)

    // Resolve the org from the tenant — the authoritative binding lives on the
    // org doc, not the token.
    const orgQuery = await firestore
      .collection('orgs')
      .where('sso.tenantId', '==', tenantId)
      .limit(1)
      .get()
    const orgDoc = orgQuery.docs[0]
    if (!orgDoc) {
      return Response.json({ error: 'No org bound to this IdP' }, { status: 404 })
    }
    const orgId = orgDoc.id
    const orgData = orgDoc.data() as any
    const sso = orgData?.sso ?? {}

    // Gate: entitlement on, config active, domain verified + governed.
    if (!checkEntitlement(orgData, 'ssoEnabled') || sso.status !== 'active') {
      return Response.json({ error: 'SSO is not active for this organization' }, { status: 403 })
    }
    const domains: string[] = Array.isArray(sso.domains) ? sso.domains : []
    if (!sso.domainVerified || !domains.includes(domain)) {
      return Response.json(
        { error: 'This email domain is not verified for SSO on this organization' },
        { status: 403 },
      )
    }

    // Seed the personal profile doc (AGL-1127). NOTHING else creates it: not
    // this route, and not sign-up either — `users/{uid}` was only ever born
    // the first time someone saved Basic info, so the form rendered empty
    // against a document that did not exist. An SSO account is the case where
    // that hurts, because the assertion already carries the name the user
    // would have typed.
    //
    // Runs BEFORE the already-a-member return on purpose: that early return
    // is what an existing SSO account takes on every subsequent sign-in, so
    // putting the seed after it would leave today's accounts blank forever.
    // Here it doubles as the backfill.
    //
    // Only the absent fields are written, so a user who has since edited
    // their name never has it overwritten by the IdP's copy on next sign-in.
    // Best-effort: a cosmetic prefill must not cost anyone their access, and
    // it self-heals on the next sign-in.
    try {
      await seedUserProfile(decoded.uid, {
        displayName: (decoded['name'] as string | undefined) ?? null,
      })
    } catch (error) {
      console.error('[auth/sso-jit] profile seed failed', error)
    }

    // Already a member? Idempotent success (a resync, not a re-grant).
    const existing = await resolveOrgMembership(decoded.uid, orgId)
    if (existing?.member) {
      return Response.json({ ok: true, orgId, orgSlug: orgData?.slug ?? null, alreadyMember: true }, { status: 200 })
    }

    // Role: a pending invite for this email wins; else the SSO default role.
    const invitesRef = orgDoc.ref.collection('invites')
    const inviteSnap = await invitesRef
      .where('email', '==', email)
      .where('acceptedAt', '==', null)
      .limit(1)
      .get()
    const invite = inviteSnap.docs[0]
    const defaultRole = ORG_ROLES.has(sso.defaultRole) ? sso.defaultRole : 'viewer'
    const role: OrgRole = invite
      ? (invite.get('role') as OrgRole)
      : (defaultRole as OrgRole)

    await upsertOrgMember({
      orgId,
      uid: decoded.uid,
      role,
      allHosts: invite ? invite.get('allHosts') === true : true,
      hostAccess: invite ? (invite.get('hostAccess') ?? {}) : {},
      email,
      displayName: (decoded['name'] as string | undefined) ?? null,
      // Measured 2026-07-30: this tenant's SAML app releases no picture
      // attribute, so this is null today. Read anyway, so mapping one on the
      // IdP (AGL-1131) starts working without a code change.
      photoURL: (decoded['picture'] as string | undefined) ?? null,
      invitedBy: invite ? (invite.get('invitedBy') ?? null) : 'sso',
    })
    if (invite) {
      await invite.ref.set(
        { acceptedAt: FieldValue.serverTimestamp(), acceptedBy: decoded.uid },
        { merge: true },
      )
    }
    void logOrgActivity(
      orgId,
      { uid: decoded.uid, email },
      `Joined via SSO as ${role}`,
      { type: 'member', id: decoded.uid, name: email },
    )
    await firestore.collection('adminAudit').add({
      actorUid: decoded.uid,
      action: 'org.sso.jit',
      target: `orgs/${orgId}`,
      before: null,
      after: { orgId, tenantId, role, viaInvite: !!invite, email },
      at: FieldValue.serverTimestamp(),
    })
    return Response.json({ ok: true, orgId, orgSlug: orgData?.slug ?? null, role }, { status: 200 })
  } catch (error) {
    console.error('[auth/sso-jit] failed', error)
    return Response.json({ error: 'SSO sign-in mapping failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
