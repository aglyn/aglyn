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
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgForHost,
  isImpersonationSession,
  lockdownRefusal,
  projectDomainStatus,
} from '@aglyn/tenant-data-admin'

/**
 * What a site's custom domain is actually doing, right now (AGL-1913).
 *
 * The wizard has had exactly two things to say about a connected domain: a
 * green chip, or "attachment pending" if our own attach call failed. Between
 * those sits everything that actually happens to a customer in the minutes and
 * days after they point DNS — a certificate still issuing, an ownership
 * challenge Vercel is waiting on, a record they changed at the registrar six
 * weeks later — and all of it rendered as the same green chip. A pending
 * certificate and a domain that will never work looked identical, which is the
 * one thing a status must never do.
 *
 * Read-only and unpersisted BY DESIGN. The alternative — a status field on the
 * host document — is a cache of somebody else's state that goes stale the
 * moment the customer edits their zone, and stale is precisely the failure
 * being fixed. `host.cname` and `cnameAttachmentPending` remain what they were:
 * the claim, and whether our attach landed.
 *
 * Membership, not admin: this answers "is my site up", which every member of a
 * site has a reason to ask, and it reveals nothing an owner of the domain
 * cannot read from public DNS. Staff pass too, so support can see a customer's
 * stuck domain without impersonating them.
 */
async function handler(request: Request): Promise<Response> {
  const authorization = request.headers.get('authorization') ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : ''
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  let decoded: Record<string, unknown> & { uid: string; email_verified?: boolean }
  try {
    decoded = (await firebaseAdmin.app().auth().verifyIdToken(idToken)) as never
  } catch {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  if (!decoded.email_verified && !isImpersonationSession(decoded as never)) {
    return emailUnverifiedResponse()
  }

  const { query } = await pluginRequestFromWeb(request)
  const hostId = String(query['hostId'] ?? '').trim()
  if (!hostId) {
    return Response.json({ error: 'Missing hostId' }, { status: 400 })
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
  if (!memberRole && decoded['staff'] !== true) {
    return Response.json({ error: 'Not a member of this site' }, { status: 403 })
  }

  // Lockdown verdict (AGL-1506, AGL-2006). Wired rather than exempt, and the
  // line was already drawn in this directory: `domains/verify` is exempt
  // because it is an "advisory DNS lookup with no org/host doc in reach
  // (domain string only)", while `attach` and `detach` — which hold the host
  // doc — carry the gate. This route holds the host doc too: it reads
  // `memberRoles`, `cname` and `cnameAttachmentPending` off it. So it sits on
  // the wired side of the distinction its own siblings established, and
  // claiming the `verify` exemption here would mean restating a reason that is
  // not true of this handler.
  //
  // The read-only argument for exempting it is real but does not survive
  // contact with what a lockdown is for (AGL-1501): the panic button stops a
  // locked org operating its sites, not merely mutating them.
  //
  // Nothing is lost for support, which is the case an exemption would have
  // been protecting. `lockdownRefusal` bypasses for staff — the un-panic
  // invariant — so the docstring's promise above, that staff can see a
  // customer's stuck domain without impersonating them, still holds during a
  // lockdown. It is only the locked org's own members who get the 423, and
  // they can still read the same DNS facts publicly.
  // Passing `request` rather than an explicit intent is load-bearing, not
  // stylistic (AGL-1913): the verdict derives `read` from the GET, and
  // `lockdownBlocks` refuses a read only under a FULL lock. So a full lock —
  // suspension, abuse, panic — refuses here like it does at `attach`, while a
  // READ-ONLY lock, which exists to keep things readable during a migration,
  // lets this answer. Nothing below mutates, so there is nothing for a freeze
  // to protect by refusing. Drop `request` and the intent falls back to
  // `write`, which would quietly turn every maintenance window into a domain
  // page that says "locked" — `route.spec.ts` pins both modes.
  const locked = await lockdownRefusal({
    request,
    staff: decoded['staff'] === true,
    uid: decoded.uid,
    org: (await getOrgForHost(hostId))?.org ?? {},
    host: hostSnapshot.data(),
  })
  if (locked) return locked

  const domain = String(hostSnapshot.get('cname') ?? '')
    .trim()
    .toLowerCase()
  if (!domain) {
    return Response.json({ domain: null, state: 'none' }, { status: 200 })
  }

  const projectId = process.env.VERCEL_TENANT_PROJECT_ID
  const status = await projectDomainStatus(domain, { projectId })
  return Response.json({
    domain,
    state: status.state,
    verification: status.verification,
    conflicts: status.conflicts,
    // Our own record of the last attach, so the card can tell "we never
    // finished attaching this" from "the platform is still working on it".
    attachmentPending: hostSnapshot.get('cnameAttachmentPending') === true,
  }, { status: 200 })
}

export const dynamic = 'force-dynamic'
export { handler as GET }
