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

import { checkEntitlement, pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  domainStateServes,
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgForHost,
  isImpersonationSession,
  lockdownRefusal,
  projectDomainStatus,
} from '@aglyn/tenant-data-admin'
// Shared with the AGL-2010 completer cron so there is exactly one
// implementation of the edge redirect. Moved out of this file unchanged.
import { upsertSubdomainRedirect } from '../../../../utils/server/subdomain-redirect'

/**
 * Attaches a verified custom domain to the tenant Vercel project so SSL
 * provisions automatically (Custom Domain Self-Service). Degrades to 501
 * without `VERCEL_TOKEN`/`VERCEL_TENANT_PROJECT_ID` — the wizard treats
 * that as "DNS connected, platform attachment pending". Auth: Firebase ID
 * token; the caller must be an admin of the host.
 */

async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const token = process.env.VERCEL_TOKEN
  const projectId = process.env.VERCEL_TENANT_PROJECT_ID
  const teamId = process.env.VERCEL_TEAM_ID
  const domain = String(body?.domain ?? '')
    .trim()
    .toLowerCase()
  const hostId = String(body?.hostId ?? '')
  if (!domain || !hostId) {
    return Response.json({ error: 'Missing domain or hostId' }, { status: 400 })
  }

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
    const hostSnapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
      .get()
    if (!hostSnapshot.exists) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (memberRole !== 'admin') {
      return Response.json({ error: 'Not a site admin' }, { status: 403 })
    }

    // Plan gate (AGL-469): custom domains are a Starter+ entitlement; a
    // plan-less org resolves as `free` and is denied.
    const org = (await getOrgForHost(hostId))?.org ?? {}
    // Lockdown verdict (AGL-1506): platform/org/host/user scopes with the
    // docs already in hand; distinct 423 body; staff bypass is the
    // un-panic invariant.
    const locked = await lockdownRefusal({
      request,
      staff: decoded['staff'] === true,
      uid: decoded.uid,
      org,
      host: hostSnapshot.data(),
    })
    if (locked) return locked
    if (!checkEntitlement(org, 'customDomain')) {
      return Response.json({
        error: 'Custom domains require a Starter plan',
      }, { status: 403 })
    }

    // Cname uniqueness (AGL-166): middleware resolution maps hostname ->
    // host 1:1; a duplicate would make it ambiguous.
    //
    // Claiming the domain and persisting `host.cname` happen in ONE
    // transaction (AGL-743). The write used to be a client-side `updateDoc`
    // that ran BEFORE this check, so losing the 409 still left the losing host
    // holding the domain — and `get-host.ts` then resolved the duplicate by
    // Firestore document order, i.e. one org could be served on another org's
    // domain. A cross-document invariant cannot be enforced from the client, so
    // this route is now the only writer of `cname`.
    const firestore = firebaseAdmin.app().firestore()
    const claimed = await firestore.runTransaction(async (tx) => {
      const duplicates = await tx.get(
        firestore.collection('hosts').where('cname', '==', domain).limit(2),
      )
      if (duplicates.docs.some((docSnapshot) => docSnapshot.id !== hostId)) {
        return false
      }
      tx.set(hostSnapshot.ref, { cname: domain }, { merge: true })
      return true
    })
    if (!claimed) {
      return Response.json({ error: 'That domain is already connected to another site' }, { status: 409 })
    }

    if (!token || !projectId) {
      // Backfill path (AGL-166): remember the attachment never happened
      // so the wizard can show it honestly and offer a retry.
      await hostSnapshot.ref
        .set({ cnameAttachmentPending: true }, { merge: true })
        .catch(() => undefined)
      return Response.json({
        error:
          'Domain attachment is not configured (missing VERCEL_TOKEN / ' +
          'VERCEL_TENANT_PROJECT_ID).',
      }, { status: 501 })
    }

    const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''
    const response = await fetch(
      `https://api.vercel.com/v10/projects/${projectId}/domains${query}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: domain }),
      },
    )
    const payload = await response.json()
    if (!response.ok && payload?.error?.code !== 'domain_already_in_use') {
      console.error(payload)
      await hostSnapshot.ref
        .set({ cnameAttachmentPending: true }, { merge: true })
        .catch(() => undefined)
      return Response.json({ error: payload?.error?.message ?? 'Vercel attach failed' }, { status: 502 })
    }

    // What the POST said is not what the customer gets (AGL-1913).
    //
    // Two states come back from a SUCCESSFUL add and mean the domain serves
    // nothing:
    //
    //  - `domain_already_in_use` was tolerated above as idempotency, but it is
    //    also the answer when the name is on a DIFFERENT project — including
    //    one outside this account. `projectDomainStatus` asks whether the name
    //    is on OUR project rather than inferring it from an error code, so the
    //    tolerated 409 stops doubling as a green light for a domain we do not
    //    hold.
    //  - Vercel accepts a name whose apex belongs to another Vercel account and
    //    then withholds routing and the certificate until a TXT challenge is
    //    answered. That returned `attached: true` and a green chip forever.
    //
    // `unknown`/`skipped` fall through to the previous behaviour: a status API
    // that could not answer must not block an otherwise-successful attach.
    const status = await projectDomainStatus(domain, { projectId })
    // `certificate-pending` is NOT serving (AGL-1996). It used to count as
    // serving, which contradicted the comment on the redirect below in the
    // one case that comment describes: a domain Vercel has accepted and
    // routed but for which no certificate exists yet. Treating it as live
    // deleted `cnameAttachmentPending` and registered the edge redirect, so
    // the subdomain stopped serving (it now redirects) and the destination
    // answered with a TLS error — the site lost BOTH addresses, which is
    // exactly the outcome the redirect guard was written to prevent.
    //
    // A cert normally issues in seconds, so the honest state is "not yet",
    // not "no". `admin/finish-domain-attachments` re-probes and completes it
    // without a human (AGL-2010) — the two changes only make sense together,
    // because without the sweeper this would strand every new domain on the
    // manual Re-attach button.
    //
    // The predicate itself now lives beside `projectDomainStatus` as
    // `domainStateServes` (AGL-2011) rather than inline here — it had two
    // hand-kept copies, and the staff re-attach at `/api/admin/host` would
    // have been a third.
    const serves = domainStateServes(status.state)
    if (status.state === 'not-attached') {
      await hostSnapshot.ref
        .set({ cnameAttachmentPending: true }, { merge: true })
        .catch(() => undefined)
      return Response.json({
        error:
          'That domain is already registered to another account on our ' +
          'hosting platform, so it could not be attached. Contact support ' +
          'with the domain name.',
        state: status.state,
      }, { status: 409 })
    }
    await hostSnapshot.ref
      .set(
        {
          cnameAttachmentPending: serves
            ? firebaseAdmin.firestore.FieldValue.delete()
            : // Not a lie about the attach: it landed. But the field is what
              // `liveCustomDomain` reads to decide whether it is safe to send
              // visitors here, and a domain awaiting an ownership challenge or
              // pointed elsewhere is exactly what that guard exists for.
              true,
        },
        { merge: true },
      )
      .catch(() => undefined)

    // Query-preserving edge redirect from the platform subdomain (AGL-1273).
    //
    // Only once the domain actually serves. Registering it against a domain
    // that does not is how a working site loses BOTH its addresses: the
    // subdomain stops serving because it now redirects, and the destination
    // has no certificate and no routing. The app-level redirect already
    // refuses on `cnameAttachmentPending` (`liveCustomDomain`); this is the
    // edge-level twin of that refusal, which had none.
    const subdomain = String(hostSnapshot.get('subdomain') ?? '')
      .trim()
      .toLowerCase()
    if (subdomain && serves) {
      const redirected = await upsertSubdomainRedirect({
        token,
        projectId,
        teamId,
        subdomain,
        target: domain,
      }).catch(() => false)
      await hostSnapshot.ref
        .set(
          redirected
            ? {
                subdomainRedirectPending:
                  firebaseAdmin.firestore.FieldValue.delete(),
              }
            : { subdomainRedirectPending: true },
          { merge: true },
        )
        .catch(() => undefined)
    }
    return Response.json({
      attached: true,
      // The wizard renders these rather than a bare tick: which of "still
      // issuing", "prove ownership", and "DNS points elsewhere" it is.
      state: status.state,
      verification: status.verification,
      conflicts: status.conflicts,
    }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Attach failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
