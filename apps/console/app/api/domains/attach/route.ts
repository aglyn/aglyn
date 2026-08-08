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

import { checkEntitlement, pluginRequestFromWeb, TENANT_APEX } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgForHost,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'

/**
 * Attaches a verified custom domain to the tenant Vercel project so SSL
 * provisions automatically (Custom Domain Self-Service). Degrades to 501
 * without `VERCEL_TOKEN`/`VERCEL_TENANT_PROJECT_ID` — the wizard treats
 * that as "DNS connected, platform attachment pending". Auth: Firebase ID
 * token; the caller must be an admin of the host.
 */

/**
 * Registers `{subdomain}.aglyn.app` on the tenant project as a Vercel
 * per-domain REDIRECT to the custom domain (AGL-1273). The app-level
 * canonical redirect in `loadPageData` is baked into an ISR entry keyed on
 * pathname, so it structurally cannot carry the query string — a campaign
 * that pointed at the platform subdomain lost its `utm_*` on the hop. The
 * edge redirect preserves path AND query at zero runtime cost, and the
 * app-level redirect stays as the fallback for self-hosted deployments
 * where no Vercel API exists.
 *
 * Best-effort BY DESIGN: the custom domain is already attached by the time
 * this runs, and a redirect-registration failure must not unwind that. A
 * failure sets `subdomainRedirectPending` so the gap is visible and the
 * backfill script (`tools/scripts/backfill-subdomain-redirects.mjs`) can
 * close it.
 */
async function upsertSubdomainRedirect(options: {
  token: string
  projectId: string
  teamId?: string
  subdomain: string
  target: string
}): Promise<boolean> {
  const { token, projectId, teamId, subdomain, target } = options
  const name = `${subdomain}.${TENANT_APEX}`
  const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  const body = JSON.stringify({
    redirect: `https://${target}`,
    // Mirrors the app-level redirect's 307: revocable, method-preserving.
    redirectStatusCode: 307,
  })
  // The subdomain may or may not already exist as an explicit project
  // domain (a wildcard serving it does not count) — PATCH the existing
  // entry, and on 404 create it with the redirect in one call.
  const patch = await fetch(
    `https://api.vercel.com/v9/projects/${projectId}/domains/${encodeURIComponent(name)}${query}`,
    { method: 'PATCH', headers, body },
  )
  if (patch.ok) return true
  if (patch.status !== 404) {
    console.error(await patch.json().catch(() => undefined))
    return false
  }
  const post = await fetch(
    `https://api.vercel.com/v10/projects/${projectId}/domains${query}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name,
        redirect: `https://${target}`,
        redirectStatusCode: 307,
      }),
    },
  )
  if (!post.ok) console.error(await post.json().catch(() => undefined))
  return post.ok
}

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
    await hostSnapshot.ref
      .set(
        {
          cnameAttachmentPending:
            firebaseAdmin.firestore.FieldValue.delete(),
        },
        { merge: true },
      )
      .catch(() => undefined)

    // Query-preserving edge redirect from the platform subdomain (AGL-1273).
    const subdomain = String(hostSnapshot.get('subdomain') ?? '')
      .trim()
      .toLowerCase()
    if (subdomain) {
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
    return Response.json({ attached: true }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Attach failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
