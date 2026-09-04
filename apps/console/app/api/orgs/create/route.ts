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

import { PLATFORM_BRANDING_PROFILE, pluginRequestFromWeb } from '@aglyn/aglyn/server'
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
  freeWorkspaceCapRefusalResponse,
  isImpersonationSession,
  lockdownRefusal,
  meterOrgEmail,
  OrgSlugTakenError,
  recordSignupRefusal,
} from '@aglyn/tenant-data-admin'
import { readClientIp } from '@aglyn/aglyn/app-utils/request-ip'

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
    /*
     * NOBODY CLAIMS A WORKSPACE ADDRESS UNTIL THEY HAVE PROVED THE EMAIL
     * (AGL-2590).
     *
     * An org's name becomes its address, `acme-inc.aglyn.com`, and this route
     * used to admit an unverified caller through the AGL-1523 signup grace —
     * because the sign-up form posted the name it had just collected seconds
     * after `createUserWithEmailAndPassword`, when a password account is
     * always unverified. That grace was the last way an unproven address
     * could be claimed, and AGL-2585 had to reserve, expire and reap behind
     * it: throwaway inboxes, and inboxes nobody could receive mail at, took
     * names permanently — a competitor's and a customer's included.
     *
     * The sign-up form no longer posts here. It holds the typed name against
     * the account and the workspace chooser creates the workspace on the
     * first VERIFIED session, which is the first session that can open one at
     * all: `/api/auth/session` refuses to mint a cookie for an unverified
     * account, so the workspace the grace created was unusable for exactly as
     * long as the grace was needed to create it.
     *
     * So the AGL-479 gate stands here with no exception. An impersonation
     * session is a staff member acting for an owner who already exists, and
     * passes as it does everywhere else.
     */
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
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
    // feature-lock. The gate above now costs an attacker a working inbox per
    // account (AGL-2590), which is a real price but not a rate: one verified
    // account can still ask for workspaces as fast as it likes, and this is
    // what bounds that. Same durable limiter as every other consequence
    // endpoint (AGL-794), keyed
    // per uid (a scripted account, a stuck client) AND per IP (a bot farm
    // rotating accounts behind one address). Fails soft by design: a limiter
    // outage must not block signups. Deliberately AFTER the 451/423/403
    // refusals — they win the spec-pinned order, and a refused request never
    // burns a token.
    const ip = readClientIp(headers)
    const perUid = await consumeRateLimit(`org-create:${decoded.uid}`, {
      limit: 3,
      windowMs: 60 * 60 * 1000,
    })
    // The per-IP half is skipped when no address is readable. It exists to
    // catch a bot farm rotating accounts behind one address, which is a
    // question about WHICH address; keying an unreadable one under a
    // placeholder answers it for nobody and caps the whole install at ten orgs
    // an hour instead.
    const perIp = ip
      ? await consumeRateLimit(`org-create-ip:${ip}`, {
          limit: 10,
          windowMs: 60 * 60 * 1000,
        })
      : null
    // `.allowed`, not the result object — a truthiness check would be
    // permanently true and the limit would never bite.
    const overLimit = !perUid.allowed ? perUid : perIp && !perIp.allowed ? perIp : null
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
      // The free-workspace ceiling (AGL-2265) — three per account by default,
      // moved from the staff console without a deploy. Staff provisioning on
      // a customer's behalf is exempt: a ceiling that stops support from
      // fixing a workspace produces the ticket it was meant to prevent.
      bypassFreeWorkspaceCap: decoded['staff'] === true,
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
          // No brand argument: `renderSystemEmail` already merges
          // `DEFAULT_BRAND_TOKENS` — the platform profile — under whatever the
          // caller supplies (AGL-2139). That is the right answer here anyway,
          // since the org was created seconds ago and carries no `whiteLabel`
          // entitlement, so `resolveBrandingProfile` would return exactly it.
          const designed = await renderSystemEmail('welcome', {
            name: ownerName,
            'org.name': name,
            consoleUrl: origin,
          })
          await sendEmail({
            to: decoded.email,
            subject:
              designed?.subject ??
              `Welcome to ${PLATFORM_BRANDING_PROFILE.productName}`,
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
    // AGL-2265. Before the 500, and with the numbers in the body: the client
    // forwards `error` to the workspace picker, so this is copy a person
    // reads. Returns null for anything else, so a real fault still 500s.
    const capped = freeWorkspaceCapRefusalResponse(error)
    if (capped) return capped
    console.error(error)
    return Response.json({ error: 'Organization creation failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
