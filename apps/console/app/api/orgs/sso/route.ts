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

import { canManageOrg, checkEntitlement, pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  enforceSsoSignInMethods,
  firebaseAdmin,
  isImpersonationSession,
  issueDomainClaim,
  lockdownRefusal,
  logOrgActivity,
  provisionSsoPool,
  publishSsoDomains,
  resolveOrgMembership,
  revokeDomain,
  ssoServiceMetadata,
  unpublishSsoDomains,
  verifyDomainClaim,
} from '@aglyn/tenant-data-admin'

/**
 * Self-serve enterprise SSO setup (AGL-1210).
 *
 * Everything an org needs to stand up SAML on its own: claim a domain, prove
 * it by DNS TXT, hand us the IdP metadata, get our metadata back, go live, and
 * rehearse enforcement before switching it on. There is no staff step in the
 * flow — the gate is the `ssoEnabled` entitlement and nothing else, which is
 * where the sales conversation already lives (getting onto Enterprise).
 *
 * Two authorization facts hold for every action below:
 *
 *  1. **Org admin, or staff.** Same bar as the rest of org settings.
 *  2. **`ssoEnabled`.** Checked per request rather than once at page load,
 *     because a plan change between render and submit must not leave a live
 *     SSO config behind on an org that no longer pays for it.
 *
 * Domain ownership is enforced one layer down, in `sso-provisioning`: only a
 * DNS-verified domain reaches `sso.domains`, and only `publishSsoDomains`
 * writes the public `ssoDomains` routing docs. Nothing here can shortcut that,
 * which is deliberate — this route handles input, not trust.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const orgId = String(body?.orgId ?? '')
  const action = String(body?.action ?? '')
  if (!orgId) return Response.json({ error: 'Missing orgId' }, { status: 400 })

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const isStaff = decoded['staff'] === true
    const membership = await resolveOrgMembership(decoded.uid, orgId)
    if (!isStaff && !canManageOrg(membership?.member.role)) {
      return Response.json(
        { error: 'Single sign-on requires the admin role' },
        { status: 403 },
      )
    }

    const firestore = firebaseAdmin.app().firestore()
    const orgRef = firestore.collection('orgs').doc(orgId)
    const orgSnapshot = await orgRef.get()
    if (!orgSnapshot.exists) {
      return Response.json({ error: 'Unknown organization' }, { status: 404 })
    }
    const org = orgSnapshot.data() ?? {}
    // Lockdown verdict (AGL-1506): platform/org/user scopes with the org
    // doc already in hand; distinct 423 body; staff bypass is the
    // un-panic invariant.
    const locked = await lockdownRefusal({
      staff: isStaff,
      uid: decoded.uid,
      org,
    })
    if (locked) return locked
    if (!checkEntitlement(org, 'ssoEnabled')) {
      return Response.json(
        {
          error:
            'Single sign-on is an Enterprise feature. Talk to us about an ' +
            'Enterprise plan and every part of the setup below becomes yours to run.',
        },
        { status: 403 },
      )
    }
    const sso = (org as { sso?: Record<string, unknown> }).sso ?? {}
    const actor = { uid: decoded.uid, email: decoded.email }

    /** Current config + claims + the metadata their IdP needs from us. */
    if (action === 'status' || !action) {
      const claimDocs = await orgRef.collection('ssoDomains').get()
      const claims = claimDocs.docs.map((doc) => {
        const data = doc.data()
        return {
          domain: doc.id,
          verified: data['verified'] === true,
          attested: false,
          recordHost: `_aglyn-challenge.${doc.id}`,
          recordValue: `aglyn-domain-verification=${data['token']}`,
          lastRecords: data['lastRecords'] ?? null,
        }
      })

      // Orgs onboarded BEFORE self-serve have `sso.domains` populated by a
      // staff attestation and no claim document at all. Listing only claims
      // would show a live SSO org an empty domain list — and, worse, tell it
      // to "verify a domain before turning SSO on" while SSO is already on.
      //
      // These are surfaced as `attested`: genuinely governing sign-in today,
      // but never proven by DNS. They are NOT dropped — that would break a
      // working deployment — and NOT counted as verified, because a human
      // saying so is precisely the assurance this feature replaces. The org
      // can add the claim and prove them properly.
      const claimed = new Set(claims.map((claim) => claim.domain))
      const governed = Array.isArray(sso['domains'])
        ? (sso['domains'] as string[])
        : []
      for (const domain of governed) {
        if (claimed.has(domain)) continue
        claims.push({
          domain,
          verified: false,
          attested: true,
          recordHost: `_aglyn-challenge.${domain}`,
          recordValue: '',
          lastRecords: null,
        })
      }

      return Response.json(
        { ok: true, sso, metadata: ssoServiceMetadata(), claims },
        { status: 200 },
      )
    }

    if (action === 'add-domain') {
      const issued = await issueDomainClaim(orgId, String(body?.domain ?? ''))
      if (!issued.claim) {
        return Response.json({ error: issued.error }, { status: 400 })
      }
      return Response.json({ ok: true, claim: issued.claim }, { status: 200 })
    }

    if (action === 'verify-domain') {
      const checked = await verifyDomainClaim(orgId, String(body?.domain ?? ''))
      if (!checked.result) {
        return Response.json({ error: checked.error }, { status: 400 })
      }
      if (checked.result.verified) {
        void logOrgActivity(
          orgId,
          actor,
          `Verified SSO domain ${checked.result.domain}`,
          { type: 'org', id: orgId },
        )
      }
      return Response.json({ ok: true, ...checked.result }, { status: 200 })
    }

    if (action === 'remove-domain') {
      const domain = String(body?.domain ?? '')
      await revokeDomain(orgId, domain)
      void logOrgActivity(orgId, actor, `Removed SSO domain ${domain}`, {
        type: 'org',
        id: orgId,
      })
      return Response.json({ ok: true }, { status: 200 })
    }

    /**
     * Create or update the GCIP pool + SAML provider from the customer's IdP
     * metadata. Does NOT go live: `status` stays `configuring` until `activate`,
     * so a half-entered config can never start routing sign-ins.
     */
    if (action === 'save-idp') {
      const entityId = String(body?.entityId ?? '').trim()
      const ssoUrl = String(body?.ssoUrl ?? '').trim()
      const certificates = (Array.isArray(body?.certificates)
        ? body.certificates
        : [body?.certificate]
      )
        .map((value: unknown) => String(value ?? '').trim())
        .filter(Boolean)
      const displayName = String(body?.displayName ?? 'Single sign-on').slice(0, 60)
      if (!entityId || !ssoUrl || !certificates.length) {
        return Response.json(
          { error: 'Entity ID, sign-in URL and at least one certificate are required' },
          { status: 400 },
        )
      }
      if (!/^https:\/\//i.test(ssoUrl)) {
        // An http:// endpoint would carry the assertion in clear text.
        return Response.json(
          { error: 'The IdP sign-in URL must be https://' },
          { status: 400 },
        )
      }

      let provisioned
      try {
        provisioned = await provisionSsoPool({
          orgId,
          orgSlug: String((org as { slug?: string }).slug ?? orgId),
          existingTenantId: sso['tenantId'] as string | undefined,
          existingProviderId: sso['providerId'] as string | undefined,
          displayName,
          idp: { entityId, ssoUrl, certificates },
        })
      } catch (error) {
        // Identity Platform multi-tenancy has to be enabled on the project and
        // the service account needs firebaseauth.admin. Both are deployment
        // facts the customer cannot fix and must not be told to — surface it as
        // ours, the way the domain-attach route reports a missing Vercel token.
        console.error('[orgs/sso] provisioning failed', error)
        return Response.json(
          {
            error:
              'Could not create the identity pool. This is on our side — the ' +
              'setup you entered was not saved. Please contact support.',
            detail: (error as Error)?.message ?? null,
          },
          { status: 502 },
        )
      }

      await orgRef.set(
        {
          sso: {
            tenantId: provisioned.tenantId,
            providerId: provisioned.providerId,
            protocol: 'saml',
            displayName,
            idp: { entityId, ssoUrl, certificates },
            status: sso['status'] === 'active' ? 'active' : 'configuring',
            enforced: sso['enforced'] === true,
            domains: Array.isArray(sso['domains']) ? sso['domains'] : [],
            domainVerified: Boolean(sso['domainVerified']),
            configuredBy: decoded.uid,
            configuredAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          },
        },
        { merge: true },
      )
      void logOrgActivity(orgId, actor, 'Updated SSO identity provider', {
        type: 'org',
        id: orgId,
      })
      return Response.json({ ok: true, ...provisioned }, { status: 200 })
    }

    /** Go live: publish routing docs for the verified domains only. */
    if (action === 'activate') {
      const tenantId = sso['tenantId'] as string | undefined
      const providerId = sso['providerId'] as string | undefined
      if (!tenantId || !providerId) {
        return Response.json(
          { error: 'Add your identity provider details first' },
          { status: 400 },
        )
      }
      const domains = Array.isArray(sso['domains']) ? (sso['domains'] as string[]) : []
      if (!domains.length) {
        return Response.json(
          { error: 'Verify at least one domain before turning SSO on' },
          { status: 400 },
        )
      }
      const published = await publishSsoDomains({
        orgId,
        tenantId,
        providerId,
        protocol: 'saml',
        displayName: sso['displayName'] as string | undefined,
        domains,
      })
      if (!published.length) {
        return Response.json(
          { error: 'No verified domains to publish' },
          { status: 400 },
        )
      }
      await orgRef.set(
        { sso: { status: 'active', domainVerified: true } },
        { merge: true },
      )
      void logOrgActivity(
        orgId,
        actor,
        `Turned SSO on for ${published.join(', ')}`,
        { type: 'org', id: orgId },
      )
      return Response.json({ ok: true, published }, { status: 200 })
    }

    /** Stop routing sign-ins here. Never deletes the pool — see below. */
    if (action === 'disable') {
      await unpublishSsoDomains(orgId)
      await orgRef.set(
        { sso: { status: 'disabled', enforced: false } },
        { merge: true },
      )
      void logOrgActivity(orgId, actor, 'Turned SSO off', { type: 'org', id: orgId })
      // The GCIP pool stays. Deleting it would delete every account inside it,
      // and "turn SSO off for a moment" must not be a way to destroy the
      // organization's users. Re-enabling reuses the same pool and the same
      // uids.
      return Response.json({ ok: true }, { status: 200 })
    }

    /**
     * Enforcement rehearsal. `enforceSsoSignInMethods` already had a dry run
     * (AGL-1129); this surfaces it so the customer sees exactly which accounts
     * lose which sign-in methods BEFORE anything changes. `force` lets the
     * rehearsal run while `enforced` is still false — which is the only time a
     * rehearsal is any use.
     */
    if (action === 'enforce-preview') {
      const result = await enforceSsoSignInMethods(orgId, {
        actorUid: decoded.uid,
        dryRun: true,
        force: true,
      })
      return Response.json({ ok: true, preview: result }, { status: 200 })
    }

    if (action === 'enforce-apply') {
      if (body?.confirm !== true) {
        return Response.json(
          { error: 'Enforcement must be confirmed' },
          { status: 400 },
        )
      }
      await orgRef.set({ sso: { enforced: true } }, { merge: true })
      const result = await enforceSsoSignInMethods(orgId, {
        actorUid: decoded.uid,
      })
      void logOrgActivity(orgId, actor, 'Enforced SSO sign-in', {
        type: 'org',
        id: orgId,
      })
      return Response.json({ ok: true, result }, { status: 200 })
    }

    if (action === 'enforce-off') {
      await orgRef.set({ sso: { enforced: false } }, { merge: true })
      void logOrgActivity(orgId, actor, 'Stopped enforcing SSO sign-in', {
        type: 'org',
        id: orgId,
      })
      // Unlinked providers are NOT restored: we removed a Google link, we did
      // not store a credential we could put back. Users re-link themselves.
      return Response.json({ ok: true }, { status: 200 })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error('[orgs/sso] failed', error)
    return Response.json({ error: 'Single sign-on update failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
