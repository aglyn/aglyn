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
  type AglynOrgMember,
  hostRoleFor,
  isOrgWideMember,
} from '@aglyn/aglyn/server'
import {
  SITE_PREVIEW_COOKIE,
  SITE_PREVIEW_EDIT_HINT_COOKIE,
} from '@aglyn/aglyn/app-utils/site-preview'
import type { DocumentSnapshot, Firestore } from 'firebase-admin/firestore'
import { findUserByUidAcrossPools } from './auth-pools'
import { verifyEditHintToken } from './edit-hint-token'
import { readCookieValue, verifySitePreviewToken } from './site-preview-token'
import { claimsHoldStaff } from './staff-seat'

/**
 * Who may see a site, or a page, that is in preview (AGL-4086).
 *
 * The site's TEAM: anyone the console lets open the site. That is the same
 * question the host document's read rule answers — a role on this site in its
 * `memberRoles` — widened by the roster for the two members that projection
 * can miss: a workspace owner or admin, and a member who holds every site of
 * the workspace. A collaborator scoped to OTHER sites of the workspace is not
 * this site's team, and does not see it.
 *
 * And Aglyn STAFF, by the `staff` custom claim on the account. That claim is
 * set only through the Admin SDK, so nothing a client can write reaches it.
 *
 * NOT the site's own member accounts — the visitors who signed up on the
 * site. They are an audience, not the team, and they are in another account
 * pool besides.
 *
 * Read intent, not write: seeing a site is not editing it, so a role that can
 * only view the site in the console sees its preview too. Lockdown is not
 * asked here because it outranks preview where it is enforced — the
 * middleware's verdict and the loader's lockdown branch both run first, for
 * the team as for everyone.
 */

export type SiteViewRefusal = 'not-team'

/**
 * `null` when `uid` may see this site in preview, or why not. The caller has
 * already proved WHO the uid is (a verified ID token at the console, a signed
 * hint at the tenant) and whether the account is staff.
 */
export async function siteViewRefusal(options: {
  firestore: Firestore
  /** The `hosts/{hostId}` snapshot, already confirmed to exist. */
  host: DocumentSnapshot
  uid: string
  /** From verified claims or the auth record; never from a request body. */
  staff?: boolean
}): Promise<SiteViewRefusal | null> {
  const { firestore, host, uid, staff = false } = options
  if (staff) return null
  if (!uid) return 'not-team'
  const memberRoles = (host.get('memberRoles') ?? {}) as Record<string, unknown>
  if (memberRoles && memberRoles[uid] != null) return null
  const orgId = host.get('orgId') as string | undefined
  if (!orgId) return 'not-team'
  const membership = await firestore
    .collection('orgs')
    .doc(orgId)
    .collection('members')
    .doc(uid)
    .get()
  if (!membership.exists) return 'not-team'
  const member = (membership.data() ?? {}) as Partial<AglynOrgMember>
  if (isOrgWideMember(member) || hostRoleFor(member, host.id) !== null) {
    return null
  }
  return 'not-team'
}

/** How a team member was recognized on the site, or that they were not. */
export interface SitePreviewViewer {
  admitted: boolean
  via: 'cookie' | 'hint' | null
}

export interface SitePreviewViewerDeps {
  findUser?: typeof findUserByUidAcrossPools
  nowMs?: number
}

const REFUSED: SitePreviewViewer = { admitted: false, via: null }

/**
 * Is the person behind this request the site's team? (AGL-4086)
 *
 * The middleware routed the request here because one of two cookies was
 * PRESENT; this is where either is believed or not.
 *
 * 1. `aglyn_site_preview` — planted by a console-minted enter link on this
 *    host alone. A signed token bound to the site; verified against the site
 *    the request resolved to.
 * 2. `aglyn_edit_hint` — the console sign-in's hint on the tenant apex. It
 *    names a uid and nothing more, so the account is looked up (it must exist
 *    and be enabled, which is how a sign-out the cookie cannot hear about
 *    still ends it) and then asked {@link siteViewRefusal}, with the staff
 *    claim read off the account record.
 *
 * Anything else — no cookie, a forged or expired one, one for another site, a
 * uid with no role here — is refused, and the caller renders what the public
 * gets. Never throws: a lookup that fails is a refusal.
 */
export async function verifySitePreviewViewer(
  options: {
    firestore: Firestore
    hostId: string
    cookieHeader: string | null | undefined
  },
  deps: SitePreviewViewerDeps = {},
): Promise<SitePreviewViewer> {
  const { firestore, hostId, cookieHeader } = options
  if (!hostId) return REFUSED
  const nowMs = deps.nowMs ?? Date.now()

  const previewCookie = readCookieValue(cookieHeader, SITE_PREVIEW_COOKIE)
  if (
    previewCookie &&
    verifySitePreviewToken('cookie', previewCookie, hostId, nowMs)
  ) {
    return { admitted: true, via: 'cookie' }
  }

  const hint = readCookieValue(cookieHeader, SITE_PREVIEW_EDIT_HINT_COOKIE)
  const claims = hint ? verifyEditHintToken('cookie', hint, nowMs) : null
  if (!claims) return REFUSED
  try {
    const findUser = deps.findUser ?? findUserByUidAcrossPools
    const found = await findUser(claims.uid)
    if (!found || found.record.disabled) return REFUSED
    const host = await firestore.collection('hosts').doc(hostId).get()
    if (!host.exists) return REFUSED
    const refusal = await siteViewRefusal({
      firestore,
      host,
      uid: claims.uid,
      staff: claimsHoldStaff(found.record),
    })
    return refusal ? REFUSED : { admitted: true, via: 'hint' }
  } catch (error) {
    console.error('[site-preview] viewer check failed', error)
    return REFUSED
  }
}
