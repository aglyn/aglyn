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
  crmInboundDomain,
  isVerifiedMemberEmailAlias,
  type MemberEmailAlias,
  memberEmailAliasRows,
  normalizeMemberEmailAlias,
  pluginRequestFromWeb,
  resolveIdpDisplayName,
} from '@aglyn/aglyn/server'
import {
  addMemberEmailAlias,
  confirmMemberEmailAlias,
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgDoc,
  isImpersonationSession,
  listMemberEmailAliases,
  lockdownRefusal,
  logOrgActivity,
  type MemberEmailAliasRefusal,
  memberEmailAliasConfirmUrl,
  mintMemberEmailAliasToken,
  readMemberEmailAliasToken,
  removeMemberEmailAlias,
  resolveOrgMembership,
  sendMemberEmailAliasConfirmation,
} from '@aglyn/tenant-data-admin'
import { resolveAuthActionOrigin } from '../../../_lib/auth-action-url'
import { invalidIdTokenResponse } from '../../../_lib/invalid-id-token-response'

/**
 * A member's own addresses in a workspace (AGL-2975) — the management surface.
 *
 * `GET ?orgId=` lists the caller's addresses in that workspace. `POST`
 * with `action: 'add'` adds one and emails its confirmation link (adding
 * an unconfirmed address again sends another); `action: 'resend'` sends
 * another link for an address already on the list; `action: 'confirm'`
 * with the link's `token` confirms it. `DELETE` with `{ orgId, address }`
 * removes one.
 *
 * ## Whose addresses
 *
 * The caller's, always: there is no uid parameter, so "manage my addresses"
 * cannot become "manage someone else's". Any member of the workspace may
 * keep a list — a site collaborator copies the capture address in BCC like
 * anybody else — and a caller who is not a member, staff included, is
 * refused: the list belongs beside a roster row.
 *
 * ## Confirming takes the member's own session
 *
 * The link proves the address receives mail; the signed-in session proves
 * the mailbox is the member's, which is the half that decides whose
 * timeline a stranger's mail lands on. So `confirm` is authenticated —
 * unlike an account address's confirmation — refuses a link minted for
 * another member, and refuses an impersonated session, whose operator did
 * not open the member's mailbox. See `member-email-aliases.ts`.
 *
 * ## The link's host is not the caller's to choose
 *
 * `resolveAuthActionOrigin`, as for password resets: a request origin is
 * honored only when it is allowlisted, so a caller cannot make the platform
 * email somebody a genuine confirmation link that points at another host.
 * The client names only the console PATH it is on, which lands on the
 * console origin or not at all.
 */

const ACTIONS = ['list', 'add', 'resend', 'remove', 'confirm'] as const
type Action = (typeof ACTIONS)[number]

const STATUS: Partial<Record<MemberEmailAliasRefusal, number>> = {
  'not-a-member': 403,
  'wrong-member': 403,
  'unknown-address': 404,
  'link-retired': 410,
  'token-expired': 410,
}

const refusal = (outcome: { refusal: MemberEmailAliasRefusal; message: string }): Response =>
  Response.json(
    { error: outcome.message, reason: outcome.refusal },
    { status: STATUS[outcome.refusal] ?? 400 },
  )

async function handler(request: Request): Promise<Response> {
  const { method, query, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  const payload = ((typeof body === 'object' && body) || {}) as Record<string, unknown>
  const action = (
    method === 'GET' ? 'list' : method === 'DELETE' ? 'remove' : String(payload['action'] ?? '')
  ) as Action
  if (!ACTIONS.includes(action)) {
    return Response.json({ error: 'Unknown action' }, { status: 400 })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const staff = decoded['staff'] === true
    const firestore = firebaseAdmin.app().firestore()

    if (action === 'confirm') {
      if (isImpersonationSession(decoded)) {
        return Response.json(
          { error: 'Only the member can confirm their own address.' },
          { status: 403 },
        )
      }
      // The workspace is the one the link names, so the lock is judged for it.
      const read = readMemberEmailAliasToken(payload['token'])
      if (read.ok === false) return refusal(read)
      const linkOrg = await getOrgDoc(read.claims.orgId)
      const locked = await lockdownRefusal({
        request,
        staff,
        uid: decoded.uid,
        org: linkOrg ?? undefined,
      })
      if (locked) return locked
      const confirmed = await confirmMemberEmailAlias(firestore, {
        token: payload['token'],
        callerUid: decoded.uid,
      })
      if (confirmed.ok === false) return refusal(confirmed)
      if (!confirmed.alreadyConfirmed) {
        void logOrgActivity(
          confirmed.orgId,
          { uid: decoded.uid, email: decoded.email ?? null },
          'Confirmed a sending address for email capture',
          { type: 'member', id: decoded.uid },
        )
      }
      return Response.json(
        {
          ok: true,
          orgId: confirmed.orgId,
          address: confirmed.address,
          alreadyConfirmed: confirmed.alreadyConfirmed,
        },
        { status: 200 },
      )
    }

    const orgId = String((method === 'GET' ? query.orgId : payload['orgId']) ?? '').trim()
    if (!orgId) return Response.json({ error: 'Missing orgId' }, { status: 400 })
    const membership = await resolveOrgMembership(decoded.uid, orgId)
    if (!membership) {
      return Response.json(
        { error: 'You are not a member of that organization' },
        { status: 403 },
      )
    }
    const org = await getOrgDoc(orgId)
    const locked = await lockdownRefusal({ request, staff, uid: decoded.uid, org: org ?? undefined })
    if (locked) return locked

    // The address the roster matches this member by, which counts as theirs
    // already — the token's is the fallback for a row that carries none.
    const signInEmail = membership.member.email || decoded.email || null

    if (action === 'list') {
      const aliases = await listMemberEmailAliases(firestore, orgId, decoded.uid)
      return Response.json(
        { aliases: memberEmailAliasRows(aliases), signInEmail },
        { status: 200 },
      )
    }

    if (action === 'remove') {
      const removed = await removeMemberEmailAlias(firestore, {
        orgId,
        uid: decoded.uid,
        address: payload['address'],
      })
      if (removed.ok === false) return refusal(removed)
      if (isVerifiedMemberEmailAlias(removed.removed)) {
        void logOrgActivity(
          orgId,
          { uid: decoded.uid, email: decoded.email ?? null },
          'Removed a sending address from email capture',
          { type: 'member', id: decoded.uid },
        )
      }
      return Response.json({ ok: true }, { status: 200 })
    }

    let alias: MemberEmailAlias
    if (action === 'add') {
      const added = await addMemberEmailAlias(firestore, {
        orgId,
        uid: decoded.uid,
        address: payload['address'],
        signInEmail,
        reservedDomains: [crmInboundDomain()],
      })
      if (added.ok === false) return refusal(added)
      alias = added.alias
    } else {
      // Only an address ALREADY on the caller's list, and only one waiting
      // for confirmation: without both this would mail any address named.
      const address = normalizeMemberEmailAlias(payload['address'])
      const listed = (await listMemberEmailAliases(firestore, orgId, decoded.uid)).find(
        (entry) => entry.address === address,
      )
      if (!listed) {
        return Response.json(
          { error: 'That address is not on your list.', reason: 'unknown-address' },
          { status: 404 },
        )
      }
      if (isVerifiedMemberEmailAlias(listed)) {
        return Response.json(
          { ok: true, alias: memberEmailAliasRows([listed])[0], alreadyConfirmed: true },
          { status: 200 },
        )
      }
      alias = listed
    }

    const row = memberEmailAliasRows([alias])[0]
    let token: string
    try {
      token = mintMemberEmailAliasToken({
        orgId,
        uid: decoded.uid,
        address: alias.address,
        addedAtMs: alias.addedAtMs,
      })
    } catch (error) {
      // The address is on the list either way — unconfirmed, it does
      // nothing — so the card can offer another send once signing works.
      console.error('[orgs/members/email-aliases] the link could not be signed', error)
      return Response.json(
        { ok: true, alias: row, sent: false, error: 'The confirmation link could not be created.' },
        { status: 202 },
      )
    }
    const confirmUrl = memberEmailAliasConfirmUrl({
      origin: resolveAuthActionOrigin(
        headers.origin ?? (headers.host ? `https://${headers.host}` : ''),
      ),
      returnPath: payload['returnPath'],
      token,
    })
    const mail = await sendMemberEmailAliasConfirmation({
      orgId,
      org: (org ?? null) as Record<string, unknown> | null,
      uid: decoded.uid,
      memberName: membership.member.displayName || resolveIdpDisplayName(decoded) || null,
      address: alias.address,
      confirmUrl,
    })
    if (mail.sent === false) {
      return Response.json(
        { ok: true, alias: row, sent: false, error: mail.error },
        { status: mail.status === 429 ? 429 : 202 },
      )
    }
    return Response.json({ ok: true, alias: row, sent: true }, { status: 200 })
  } catch (error) {
    // A refused credential is a 401, not a fault of ours (AGL-1993).
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[orgs/members/email-aliases] failed', error)
    return Response.json({ error: 'Could not update your addresses' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as DELETE, handler as GET, handler as POST }
