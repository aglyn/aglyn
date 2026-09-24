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
  type ConsentGroupSiteHold,
  consentGroupSiteHold,
} from '@aglyn/aglyn/app-utils/consent-groups'
import {
  emailUnverifiedResponse,
  eraseHost,
  firebaseAdmin,
  getOrgForHost,
  isImpersonationSession,
  lockdownRefusal,
  logOrgActivity,
  memberHasOrgPermission,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { teardownSendingDomain } from '../../../../utils/server/provision-sending-domain'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/**
 * What the site's admin is told when its consent group still needs it
 * (AGL-3320) — the one thing they can do about it, in the words of the
 * Emails page where they do it.
 */
function consentGroupHoldResponse(hold: ConsentGroupSiteHold): Response {
  return Response.json(
    {
      error:
        hold.reason === 'grouped'
          ? `This site sends as part of the consent group "${hold.name}". ` +
            'Remove it from the group on your organization’s Emails page, ' +
            'then delete it.'
          : 'A consent group change that includes this site is still ' +
            'finishing. Delete the site once it is done.',
      reason: hold.reason === 'grouped' ? 'consent-group' : 'consent-group-change',
    },
    { status: 409 },
  )
}

/**
 * Permanently delete a single site (AGL-488). Site-admin only. Unlike an
 * organization deletion there is no hold — a site is deleted immediately
 * (the console gates it behind a type-the-name confirm). `eraseHost` cleans
 * up Storage, the routing index, the org's hosts map, and the Firestore
 * tree so nothing is orphaned.
 *
 * A site in a consent group, or in a change to one that is still running,
 * is refused with a 409 (AGL-3320): its opt-outs are read by the other sites
 * in its group, so it leaves the group — which carries them over — first.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const hostId = String(body?.hostId ?? '')
  if (!hostId) return Response.json({ error: 'Missing hostId' }, { status: 400 })

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
    const hostRef = firebaseAdmin.app().firestore().collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }
    // Deleting a site is an admin-level action (mirrors the rules'
    // host-delete gate: only a site admin, staff aside).
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (decoded['staff'] !== true && memberRole !== 'admin') {
      return Response.json({
        error: 'Deleting a site requires the site admin role',
      }, { status: 403 })
    }

    /*==========================================
     * AND the ORG permission on top of it (AGL-2444).
     *
     * `hosts.delete` is one of eleven permissions a custom role advertises,
     * and until now it had ZERO consumers anywhere: an owner could build a
     * role with "Delete sites" unticked, assign it, and the member deleted
     * sites. The console did not even dim the control, because nothing read
     * the key. A permission a customer can toggle that changes nothing is
     * worse than its absence — it implies a control that does not exist.
     *
     * It is checked IN ADDITION to the site-admin role above, never instead
     * of it, because the two answer different questions. The host role says
     * whether this person runs that site; the org permission says whether
     * their seat in the organization may destroy sites at all. Replacing the
     * role check with this one would widen deletion to any org member who
     * happens to hold the permission — the opposite of the narrowing the
     * agency guide sells.
     *
     * The org is resolved from the HOST rather than from the request, so a
     * caller cannot name a workspace where their seat is more generous than
     * it is in the one that actually owns the site.
     *=========================================*/
    if (decoded['staff'] !== true) {
      const owning = await getOrgForHost(hostId)
      const membership = owning
        ? await resolveOrgMembership(decoded.uid, owning.orgId)
        : null
      if (
        !membership ||
        !(await memberHasOrgPermission(
          membership.orgId,
          membership.member,
          'hosts.delete',
        ))
      ) {
        return Response.json({
          error: 'Your organization role does not allow deleting sites',
        }, { status: 403 })
      }
    }

    // Lockdown verdict (AGL-1506): platform/org/host/user scopes; distinct
    // 423 body; staff bypass is the un-panic invariant. The org doc is
    // fetched deliberately — an org lock never stamps host docs, so a
    // host-only verdict would silently miss it.
    const owningOrg = (await getOrgForHost(hostId))?.org
    const locked = await lockdownRefusal({
      request,
      staff: decoded['staff'] === true,
      uid: decoded.uid,
      org: owningOrg,
      host: hostSnapshot.data(),
    })
    if (locked) return locked

    /*==========================================
     * NOT WHILE ITS CONSENT GROUP STILL NEEDS IT (AGL-3320).
     *
     * A grouped site's opt-outs are stored on the site and read by every
     * site in its group, so erasing it would start mailing, from the sites
     * that stay, people who unsubscribed here — and leave the declaration
     * naming a site that is gone. Staff are held to it too: the hazard is
     * to the people on the list, not a permission. `eraseHost` refuses the
     * same site on its own, so a caller that reaches it another way meets
     * the same answer.
     *=========================================*/
    const hold = consentGroupSiteHold(
      (owningOrg ?? null) as Record<string, unknown> | null,
      hostId,
    )
    if (hold) return consentGroupHoldResponse(hold)

    /*==========================================
     * READ BEFORE THE ERASE, LOG AFTER IT (AGL-118).
     *
     * Both halves of that are forced, and by different things.
     *
     * READ FIRST because `eraseHost` drops the site's entry from the owning
     * org's `hosts` map, so `getOrgForHost` answers null the moment it
     * returns — an entry composed afterwards has no workspace to be filed
     * under and no name to call the site. Taken off the snapshot this handler
     * already holds, so it costs no read.
     *
     * LOG AFTER because an entry written first would be a claim about a
     * deletion that had not happened yet, and `eraseHost` can throw — this
     * handler's catch answers 500 and the site is still there. The audit
     * trail must not be the one place that says otherwise.
     *=========================================*/
    const owningOrgId = hostSnapshot.get('orgId') as string | undefined
    const deletedName =
      (hostSnapshot.get('displayName') as string | undefined) ?? hostId

    /*==========================================
     * THE SENDING DOMAIN GOES WITH THE SITE, AND `eraseHost` OWNS THAT NOW.
     *
     * The read-before / release-after dance used to live here, which made
     * this route the ONLY way a site could stop existing and have its Resend
     * domain and its zone records released. Every other path — a workspace
     * erasure, and the per-host erasures inside one — left a plan-capped
     * provider slot spent forever and a live DKIM key in the zone under a
     * label a future site could claim and inherit a stranger's signature
     * from.
     *
     * So the ordering moved into `eraseHost`, which is what both paths share,
     * and this route's part is the one thing it has that a library cannot:
     * the credentials. `teardownSendingDomain` reads a full-access mail key
     * and a DNS token, neither of which the tenant runtime may hold, so it is
     * passed IN rather than imported by the library.
     *
     * A vendor that refuses does not fail the delete. The customer asked for
     * the site to go and it has gone; what is owed is recorded on the label
     * claim and `/api/admin/reap-sending-domains` collects it.
     *=========================================*/
    await eraseHost(hostId, { tearDownSendingDomain: teardownSendingDomain })

    /*==========================================
     * TO THE ORG'S FEED, NOT THE SITE'S.
     *
     * The site's own log is `hosts/{hostId}/activity`, which is inside the
     * tree `eraseHost` just recursive-deleted. An entry there would be
     * written into a document path that no longer exists, resurrecting a
     * fragment of a site the customer asked us to destroy — and no reader
     * would ever see it, because the surface that reads that collection is
     * the site's own page.
     *
     * A destroyed site's last event therefore belongs to the workspace that
     * owned it, which is also where somebody asking "where did our site go"
     * is looking. An orphaned host names no workspace, and there is no
     * honest feed to file it under; the `adminAudit` row below still records
     * it for staff.
     *=========================================*/
    if (owningOrgId) {
      await logOrgActivity(
        owningOrgId,
        { uid: decoded.uid, email: decoded.email ? String(decoded.email) : null },
        'Deleted a site',
        { type: 'host', id: hostId, name: deletedName },
      )
    }

    await firebaseAdmin
      .app()
      .firestore()
      .collection('adminAudit')
      .add({
        actorUid: decoded.uid,
        action: 'host.deleted',
        target: `hosts/${hostId}`,
        before: { displayName: hostSnapshot.get('displayName') ?? null },
        at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      })
      .catch(() => undefined)

    return Response.json({ ok: true }, { status: 200 })
  } catch (error) {
    // A refused credential is a 401, not a fault of ours (AGL-1993). Null
    // for anything else, so a real failure keeps the answer below.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    // The group changed between the check above and the erase: `eraseHost`
    // refused before destroying anything, and the answer is the same 409.
    // Matched by name, so this route does not load the erase module for it.
    const refused = error as { name?: unknown; hold?: ConsentGroupSiteHold }
    if (refused?.name === 'SiteInConsentGroupError' && refused.hold) {
      return consentGroupHoldResponse(refused.hold)
    }
    console.error(error)
    return Response.json({ error: 'Site deletion failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
