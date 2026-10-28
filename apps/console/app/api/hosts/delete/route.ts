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

import { holdsSiteKey, siteKeyRefusal } from '@aglyn/aglyn/app-utils/host-permissions'
import type { DecodedIdToken } from 'firebase-admin/auth'
import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  type ConsentGroupSiteHold,
  consentGroupSiteHold,
} from '@aglyn/aglyn/app-utils/consent-groups'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgForHost,
  isImpersonationSession,
  lockdownRefusal,
  memberHasOrgPermission,
  previewHostErase,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { eraseSiteAndRecord } from '../../../../utils/server/erase-site'
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

/** The site and the person a delete or its preview was asked for, once both may go ahead. */
interface SiteDeleteCaller {
  decoded: DecodedIdToken
  hostSnapshot: FirebaseFirestore.DocumentSnapshot
  owning: Awaited<ReturnType<typeof getOrgForHost>>
}

/**
 * Who may delete the site, asked the same way by the delete and by the
 * preview the Delete site card reads first (AGL-4003): a verified sign-in,
 * the site admin role, and the organization's `hosts.delete` permission. A
 * refusal is the response to send; anything else is the caller. Throws what
 * the token check throws, for the handler's 401.
 */
async function siteDeleteCaller(
  hostId: string,
  headers: Partial<Record<string, string>>,
): Promise<Response | SiteDeleteCaller> {
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
  if (!decoded.email_verified && !isImpersonationSession(decoded)) {
    return emailUnverifiedResponse()
  }
  const hostRef = firebaseAdmin.app().firestore().collection('hosts').doc(hostId)
  const hostSnapshot = await hostRef.get()
  if (!hostSnapshot.exists) {
    return Response.json({ error: 'Unknown site' }, { status: 404 })
  }
  // Deleting a site asks "Manage site settings" (`site.manage`, AGL-4047)
  // on it, as the rules' host-delete gate does (staff aside), beside the
  // workspace's "Delete sites" below.
  if (decoded['staff'] !== true && !holdsSiteKey(hostSnapshot, decoded.uid, 'site.manage')) {
    return Response.json({ error: siteKeyRefusal('site.manage') }, { status: 403 })
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
  const owning = await getOrgForHost(hostId)
  if (decoded['staff'] !== true) {
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
  return { decoded, hostSnapshot, owning }
}

/**
 * What deleting the site would take with it (AGL-4003), for the Delete site
 * card to list before it asks: what plugins share with this site alone — the
 * datasets, each with its record count — and how many shared ones stay.
 * Reads only; the same people who may delete the site may ask.
 */
async function preview(request: Request): Promise<Response> {
  const { query, headers } = await pluginRequestFromWeb(request)
  const hostId = String(query?.['hostId'] ?? '')
  if (!hostId) return Response.json({ error: 'Missing hostId' }, { status: 400 })
  try {
    const caller = await siteDeleteCaller(hostId, headers as Partial<Record<string, string>>)
    if (caller instanceof Response) return caller
    if (!caller.owning) return Response.json({ resources: [] }, { status: 200 })
    return Response.json(await previewHostErase(caller.owning.orgId, hostId), { status: 200 })
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'Could not read what goes with the site' }, { status: 500 })
  }
}

/**
 * Permanently delete a single site (AGL-488). Site-admin only. Unlike an
 * organization deletion there is no hold — a site is deleted immediately
 * (the console gates it behind a type-the-name confirm). `eraseHost` cleans
 * up Storage, the routing index, the org's hosts map, the Firestore tree,
 * and the datasets shared with this site alone (AGL-4003), so nothing is
 * orphaned.
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

  try {
    const caller = await siteDeleteCaller(hostId, headers)
    if (caller instanceof Response) return caller
    const { decoded, hostSnapshot } = caller

    // Lockdown verdict (AGL-1506): platform/org/host/user scopes; distinct
    // 423 body; staff bypass is the un-panic invariant. The org doc is
    // fetched deliberately — an org lock never stamps host docs, so a
    // host-only verdict would silently miss it.
    const owningOrg = caller.owning?.org
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

    /*
     * The erase and its record, in the order every server deletion shares
     * (`utils/server/erase-site.ts`, AGL-3936): the site's name and workspace
     * read from this snapshot first, `eraseHost` with this app's sending-domain
     * teardown, the tenant's cached pages and names dropped, then the
     * workspace's feed and the staff audit.
     */
    await eraseSiteAndRecord(
      { id: hostId, get: (field) => hostSnapshot.get(field) },
      {
        actor: { uid: decoded.uid, email: decoded.email ? String(decoded.email) : null },
        activity: 'Deleted a site',
        auditActorUid: decoded.uid,
      },
    )

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
export { handler as POST, preview as GET }
