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

import { AGLYN_BRANDING_PROFILE, pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  generateOrgSlug,
  isValidOrgSlug,
  resolveIdpDisplayName,
} from '@aglyn/aglyn/server'
import { isEmailConfigured, sendEmail } from '@aglyn/shared-util-email'
import { renderSystemEmail } from '../../_lib/render-system-email'
import { enforceSanctionsGeo } from '../../../../constants/sanctions-geo'
import {
  consumeRateLimit,
  createOrganization,
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  lockdownRefusal,
  meterOrgEmail,
  OrgSlugTakenError,
  recordSignupRefusal,
  signupProvisioningGraceAllows,
} from '@aglyn/tenant-data-admin'

/**
 * Creates an organization for the signed-in user (AGL-233). Like Slack,
 * any account can create workspaces; the creator becomes the org owner.
 * Server-side because slug reservation and membership docs are
 * Admin-SDK-only (rules deny client writes).
 */
async function handler(request: Request): Promise<Response> {
  // Sanctions / OFAC geo-block (AGL-1492). `/api/*` is outside the middleware
  // matcher, and this route is the provisioning moment — it is where Aglyn
  // starts providing the Services to a party, which is the act ToS §3.6
  // prohibits for an embargoed region. Before the body is even parsed.
  const refused = enforceSanctionsGeo(request.headers, 'json')
  if (refused) return refused
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const name = String(body?.name ?? '')
    .trim()
    .slice(0, 80)
  if (!name) return Response.json({ error: 'Missing organization name' }, { status: 400 })
  const slug = (String(body?.slug ?? '').trim().toLowerCase() ||
    generateOrgSlug(name)) as string
  if (!isValidOrgSlug(slug)) {
    return Response.json({
      error:
        'Workspace URL must be 3–30 lowercase letters, digits, or dashes ' +
        'and not a reserved name',
    }, { status: 400 })
  }

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      // Signup-time provisioning (AGL-1523): a fresh password account is
      // ALWAYS unverified when the signup form posts the org name it just
      // collected, so a flat refusal here made that field dead weight on the
      // primary self-serve door. A brand-new account owning nothing may
      // create its ONE signup workspace; everyone else still needs the
      // verified email (AGL-479 — which keeps gating console ACCESS for this
      // account regardless: the session mint and app layout still refuse
      // unverified). Fails closed inside the helper.
      const graced = await signupProvisioningGraceAllows(decoded.uid)
      if (!graced) return emailUnverifiedResponse()
    }
    // Lockdown verdict (AGL-1506): the org scope has no carrier before the
    // org exists — platform and user locks still refuse creation; distinct
    // 423 body; staff bypass is the un-panic invariant.
    const locked = await lockdownRefusal({
      request,
      staff: decoded['staff'] === true,
      uid: decoded.uid,
    })
    if (locked) return locked

    // Rate limit (AGL-1534) — the always-on layer under the AGL-1510 signups
    // feature-lock. The AGL-1523 grace above admits a brand-new unverified
    // account, so scripted org minting is one account-creation away; the
    // grace bounds each account to ONE org, this bounds the RATE. Same
    // durable limiter as every other consequence endpoint (AGL-794), keyed
    // per uid (a scripted account, a stuck client) AND per IP (a bot farm
    // rotating accounts behind one address). Fails soft by design: a limiter
    // outage must not block signups. Deliberately AFTER the 451/423/403
    // refusals — they win the spec-pinned order, and a refused request never
    // burns a token.
    const ip = headers['x-forwarded-for']?.split(',')[0]?.trim() ?? 'unknown'
    const perUid = await consumeRateLimit(`org-create:${decoded.uid}`, {
      limit: 3,
      windowMs: 60 * 60 * 1000,
    })
    const perIp = await consumeRateLimit(`org-create-ip:${ip}`, {
      limit: 10,
      windowMs: 60 * 60 * 1000,
    })
    // `.allowed`, not the result object — a truthiness check would be
    // permanently true and the limit would never bite.
    const overLimit = !perUid.allowed ? perUid : !perIp.allowed ? perIp : null
    if (overLimit) {
      // Make the refusal observable (AGL-1907). The AGL-1536 alarm counts
      // orgs that were CREATED, so a contained wave reads as calm — volume
      // falls the moment the limiter starts biting. This records the 429s
      // themselves, per-reason and with no identifiers, into the same
      // `rateLimits` collection the limiter already owns; the signups health
      // endpoint sums them. Deliberately not awaited: the refusal is the
      // control, the breadcrumb must never be able to delay or fail it.
      recordSignupRefusal(!perUid.allowed ? 'uid' : 'ip')
      // This copy is what a person reads: provisionSignUpOrg forwards the
      // body's `error` to the workspace picker via the AGL-1523 marker.
      return Response.json(
        {
          error:
            'Too many new workspaces in a short time — wait a while and ' +
            'try again. The name you typed is kept.',
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(
              Math.max(1, Math.ceil((overLimit.resetMs - Date.now()) / 1000)),
            ),
          },
        },
      )
    }

    const orgId = await createOrganization({
      name,
      slug,
      ownerUid: decoded.uid,
      ownerEmail: decoded.email ?? null,
      // Not `decoded['name']` (AGL-1131): a SAML assertion puts its mapped
      // attributes under `firebase.sign_in_attributes` and never promotes
      // them to a top-level claim, so this was empty for every SSO account —
      // stamping the org's first roster row, its owner, as nameless.
      ownerDisplayName: resolveIdpDisplayName(decoded) || null,
    })

    // Welcome email on the owner's FIRST org only (AGL-768): someone who
    // creates their second workspace does not get welcomed again. Counted
    // after creation — they now own exactly one — and wrapped so nothing in
    // the send can turn a created org into a 500. Best-effort like every
    // other send; `renderSystemEmail` returns null to fall back to the copy
    // below, `sendEmail` never throws.
    try {
      if (decoded.email && isEmailConfigured()) {
        const ownedCount = (
          await firebaseAdmin
            .app()
            .firestore()
            .collection('orgs')
            .where('ownerUid', '==', decoded.uid)
            .limit(2)
            .get()
        ).size
        if (ownedCount === 1) {
          const origin = headers.origin ?? `https://${headers.host}`
          // Same claim, same reason (AGL-1131) — the welcome email opened
          // "Hi there," for SSO owners regardless of what their IdP sent.
          const ownerName = resolveIdpDisplayName(decoded) || 'there'
          const fallbackText =
            `Hi ${ownerName}, thanks for creating ${name}. Your workspace ` +
            `is ready.\n\nOpen your dashboard at ${origin}.`
          const designed = await renderSystemEmail(
            'welcome',
            {
              name: ownerName,
              'org.name': name,
              consoleUrl: origin,
            },
            // The platform brand explicitly, not a resolved profile: the org
            // was created seconds ago, so it carries no plan and no
            // `whiteLabel` entitlement, and `resolveBrandingProfile` would
            // return exactly this. Passing it is not optional though — the
            // welcome copy now carries `{{brand.productName}}`, and a template
            // rendered with no brand tokens has them BLANKED rather than left
            // visible, so the greeting would read "Welcome to " (AGL-2139).
            AGLYN_BRANDING_PROFILE,
          )
          await sendEmail({
            to: decoded.email,
            subject:
              designed?.subject ??
              `Welcome to ${AGLYN_BRANDING_PROFILE.productName}`,
            text: designed?.text || fallbackText,
            ...(designed?.html ? { html: designed.html } : {}),
            context: 'welcome',
          })
          // Cost meter (AGL-1438). Org-scoped: the org exists by now — this
          // runs after `createOrganization` returned its id.
          await meterOrgEmail(orgId)
        }
      }
    } catch (welcomeError) {
      console.error('welcome email skipped', welcomeError)
    }

    return Response.json({ orgId, slug }, { status: 200 })
  } catch (error) {
    if (error instanceof OrgSlugTakenError) {
      return Response.json({ error: 'That workspace URL is taken' }, { status: 409 })
    }
    console.error(error)
    return Response.json({ error: 'Organization creation failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
