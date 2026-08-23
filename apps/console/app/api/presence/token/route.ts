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
  hostRoleCanWrite,
  hostRoleFor,
  isOrgWideMember,
  pluginRequestFromWeb,
} from '@aglyn/aglyn/server'
import { deadDocumentPaths } from '../../_lib/presence-reaper'
import {
  authForPool,
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgDoc,
  isImpersonationSession,
  lockdownRefusal,
} from '@aglyn/tenant-data-admin'

/**
 * Mint a Realtime Database token scoped to one org, for presence (AGL-675).
 *
 * RTDB rules **cannot read Firestore**, and the ordinary console token
 * carries only `staff`/`staffRole` — no org membership for rules to check.
 * Left there, presence would have to be readable by any signed-in user who
 * knew a host id.
 *
 * So membership is verified HERE, server-side, and the answer is baked into
 * a separate short-lived token as a `presenceOrg` claim that the RTDB rules
 * can check with a simple equality. This is the same shape as the media
 * upload-URL route, which exists because Storage rules have the identical
 * limitation — and it is what `docs/MULTI_TENANT_FIRESTORE.md` §7 already
 * specified for RTDB.
 *
 * One org per token deliberately: the claim stays a single string rather
 * than a membership map, so it cannot drift toward the 1000-byte claim
 * ceiling, and switching orgs mints a new one.
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
    const firestore = firebaseAdmin.app().firestore()

    // Membership is proven against the host the caller claims to be
    // editing — not against an orgId they supply, which would let anyone
    // mint a token for any org.
    const host = await firestore.collection('hosts').doc(hostId).get()
    if (!host.exists) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }
    const orgId = host.get('orgId') as string | undefined
    if (!orgId) {
      return Response.json({ error: 'Site has no organization' }, { status: 409 })
    }
    const membership = await firestore
      .collection('orgs')
      .doc(orgId)
      .collection('members')
      .doc(decoded.uid)
      .get()
    if (!membership.exists) {
      return Response.json({ error: 'Not a member of this site' }, { status: 403 })
    }

    // BARE ORG MEMBERSHIP IS NOT REACH TO THIS SITE (AGL-1881).
    //
    // The check above proves the caller is on the org roster. The roster
    // holds BOTH org managers and site-scoped collaborators — a collaborator
    // invited to one site is written as `role:'viewer', allHosts:false,
    // hostAccess:{thatHost}` (`grantHostAccess`). Existence alone therefore
    // answered a question nobody asked, and `hostId` is caller-supplied: any
    // org member could name any host in the org and be minted a token for it.
    // The org doc's `hosts` map is readable by every member, so enumerating
    // the sibling ids takes one read.
    //
    // `hostRoleFor` is the predicate the rules and the ~20 server gates
    // already share, and `isOrgWideMember` alongside it because the two
    // disagree on ONE shape deliberately: a pre-`allHosts` legacy row carries
    // neither the flag nor a `hostAccess` map, and `hostRoleFor` reads that as
    // "no reach" while `isOrgWideMember` reads it as org-wide — which is the
    // reading that does not lock a real member out of their own workspace.
    // Asking both is what keeps this a security fix rather than an outage.
    const memberData = (membership.data() ?? {}) as Partial<AglynOrgMember>
    const orgWide = isOrgWideMember(memberData)
    const rosterHostRole = hostRoleFor(memberData, hostId)
    const hostRole = ((host.get('memberRoles') ?? {}) as Record<string, string>)[
      decoded.uid
    ]
    if (!orgWide && !rosterHostRole && !hostRole) {
      return Response.json({ error: 'Not a member of this site' }, { status: 403 })
    }

    // Lockdown verdict (AGL-1506): a locked org/host mints no presence or
    // co-edit token. Host doc already in hand; the org scope rides the
    // member doc's `orgSuspended` projection (also already read) — the org
    // doc is fetched only when the projection trips, so the happy path
    // adds no org read. Staff bypass is the un-panic invariant.
    const locked = await lockdownRefusal({
      request,
      // POST-shaped READ (AGL-1511): a presence token only lets the editor
      // SEE who else is in the document, and presence lives in RTDB — it
      // races no Firestore migration. Refusing it would break the read view.
      intent: 'read',
      staff: decoded['staff'] === true,
      uid: decoded.uid,
      org:
        membership.get('orgSuspended') === true
          ? ((await getOrgDoc(orgId)) ?? {})
          : undefined,
      host: host.data(),
    })
    if (locked) return locked

    // Presence is a read/write of your own name and selection — every role
    // that can open the editor can be seen in it, viewers included.
    //
    // Live co-editing (AGL-677) is not that. It lets one person mutate the
    // document another person is looking at, so it needs the same gate the
    // media routes use for a write — host `memberRoles` admin/editor, or an
    // org roster role above viewer — and it is scoped to the ONE host proven
    // here, not to the whole org. A viewer gets presence and no `coeditHost`
    // claim at all, so the RTDB rules refuse their writes outright rather
    // than relying on the client to keep them read-only.
    const orgRole = memberData.role
    // `author` (AGL-2334) is a content role, so it belongs on this list.
    // The co-edit claim is what lets the besigner mutate the version document
    // at all — refusing it would have shipped a role that can edit content in
    // the security rules and cannot open the editor that does the editing.
    // The publish gate is in the rules, on the publish FIELDS; it is not this
    // claim's job, and narrowing here would break the half of the role that
    // has to work.
    //
    // The org-roster arm is bound to `orgWide` (AGL-1881). It used to read
    // `orgRole === 'editor'` on its own, and a site collaborator can hold
    // `role:'editor'` with `allHosts:false` — expressible straight from
    // `/api/orgs/members` — so a member scoped to site A was minted
    // `coeditHost` for site B and could mutate a live editing session on a
    // site whose `memberRoles` does not list them. The comment above this
    // block already claimed the claim "is scoped to the ONE host proven
    // here"; nothing in the roster arm proved anything about that host.
    const canEdit =
      hostRoleCanWrite(hostRole) ||
      hostRoleCanWrite(rosterHostRole) ||
      (orgWide &&
        (orgRole === 'owner' || orgRole === 'admin' || orgRole === 'editor'))

    // Mint in the caller's OWN pool (AGL-1962). A uid is unique only WITHIN
    // a pool, and `signInWithCustomToken` CREATES the account when the uid is
    // absent from the pool the token was minted in. Minting an SSO user's
    // GCIP-tenant uid against the project pool therefore did not fail — it
    // silently manufactured a second, empty project-level account carrying
    // their tenant uid (no email, no providers), which then shadowed the real
    // SSO record in every `findUserByUidAcrossPools` caller, because that
    // helper checks the project pool first. Measured on production:
    // `QQ7fixtureUid0000000000000001` exists in both pools, the project copy
    // created 2026-08-04 22:10 during the AGL-675 presence verification.
    // `/api/admin/impersonate` already scoped its mint this way.
    const tenantId = decoded.firebase?.tenant ?? null
    const token = await authForPool(tenantId).createCustomToken(decoded.uid, {
      presenceOrg: orgId,
      // Minted but NOT YET READ by any rule (AGL-1881), and deliberately so.
      //
      // The co-edit READ rule keys on `presenceOrg` alone, with no `$hostId`
      // component — so a token minted for one site still reads
      // `coedit/{orgId}/{anySiteId}/…/nodes`, which is the unsaved canvas of
      // every sibling site in the org. The gate above stops a collaborator
      // OBTAINING a token for a site they cannot reach; it cannot narrow a
      // token they legitimately hold, because that narrowing has to happen in
      // the rule.
      //
      // Adding the claim now and tightening the rule later is the only
      // ordering that does not break live co-editing: a rule that requires
      // `presenceHost` must not ship before every token carries it. This half
      // is additive and inert. See the AGL-1881 report for the deploy order.
      presenceHost: hostId,
      ...(canEdit ? { coeditHost: hostId } : {}),
    })

    // TIDY THE ROOM WE ARE ABOUT TO LET SOMEBODY INTO (AGL-2486).
    //
    // The durable half of presence cleanup — see `presence-reaper.ts` for why
    // it lives on the join rather than on a schedule, and why the threshold
    // cannot evict a live session.
    //
    // Deliberately AFTER everything the caller depends on and wrapped so it
    // can never fail the request: a caller must always get their token, even
    // if the sweep throws, and housekeeping must never be able to break the
    // feature it is housekeeping for.
    const docType = String(body?.docType ?? '')
    const docId = String(body?.docId ?? '')
    if (docType && docId && /^[A-Za-z0-9_-]{1,64}$/.test(docId)) {
      try {
        // The DOCUMENT node, not the one room being joined (AGL-2486). Rooms
        // are version-scoped now, and the same read already holds every
        // version plus any legacy document-scoped rows left by an older
        // client — so one read tidies all of them, and a version nobody
        // reopens does not keep its dead rows forever.
        const docRef = firebaseAdmin
          .database()
          .ref(`presence/${orgId}/${docType}/${docId}`)
        const document = (await docRef.get()).val()
        const dead = deadDocumentPaths(document, Date.now())
        await Promise.all(dead.map((path) => docRef.child(path).remove()))
      } catch (sweepError) {
        console.warn('[presence/token] room sweep skipped:', sweepError)
      }
    }

    // The client must put its presence auth instance in the same tenant
    // before exchanging this, or the token is rejected as cross-pool.
    return Response.json({ token, orgId, canEdit, tenantId }, { status: 200 })
  } catch (error) {
    // AN AUTHENTICATION ANSWER IS NOT A SERVER FAULT (AGL-2486).
    //
    // Every `auth/…` failure landed here and came back 500 "Could not start
    // presence", which is how the SSO revocation bug above presented: a
    // stale, revoked or disabled session read as "our broker is broken",
    // pointed the reader at the server, and offered no remedy at all — the
    // one thing the caller could actually do (sign in again) was the one
    // thing nothing said. `reason` travels so the editor can name a remedy
    // instead of a status code.
    const code = String((error as { code?: string })?.code ?? '')
    if (code.startsWith('auth/')) {
      console.warn('[presence/token] refused:', code)
      return Response.json(
        { error: 'Your sign-in is no longer valid', reason: code },
        { status: 401 },
      )
    }
    // A real fault. Logged with a tag, because an untagged `console.error(e)`
    // in a process serving 117 routes is a stack with no subject.
    console.error('[presence/token] failed:', error)
    return Response.json(
      { error: 'Could not start presence', reason: 'broker-error' },
      { status: 500 },
    )
  }
}

export const POST = handler
