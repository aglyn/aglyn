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
  evaluateMemberEmailAliasAdd,
  isVerifiedMemberEmailAlias,
  MEMBER_EMAIL_ALIAS_CONFIRM_PARAM,
  MEMBER_EMAIL_ALIAS_CONFIRM_TTL_MS,
  MEMBER_EMAIL_ALIASES_COLLECTION,
  type MemberEmailAlias,
  type MemberEmailAliasAddRefusal,
  normalizeMemberEmailAlias,
  readMemberEmailAliases,
} from '@aglyn/aglyn/app-utils/member-email-aliases'
import { resolveBrandingProfile } from '@aglyn/aglyn/server'
import { isEmailConfigured, sendEmail } from '@aglyn/shared-util-email'
import { createHmac } from 'crypto'
import { tokenSigningSecret } from './media-signing'
import { safeEqual } from './safe-equal'

/**
 * A MEMBER'S OWN ADDRESSES (AGL-2975): the half with Firestore.
 *
 * The pure rules — what an address is, which are confirmed, whose an
 * address is — are `@aglyn/aglyn`'s `member-email-aliases.ts`. This module
 * is the store under `orgs/{orgId}/memberEmailAliases/{uid}`, the signed
 * confirmation link, and the email that carries it.
 *
 * ## Every write is here
 *
 * The rules deny the collection to every client, reads included, so the
 * one way `verifiedAtMs` is ever set is {@link confirmMemberEmailAlias}
 * running behind a verified session. A client that could write the
 * document could mark any address it liked as its own, and the capture
 * webhook would then file a stranger's mail as the member's.
 *
 * ## The confirmation link
 *
 * `{ org, uid, address, addedAtMs, exp }`, HMAC-signed with the shared,
 * fail-closed `TOKEN_SIGNING_SECRET` under its own `member-email-alias:`
 * prefix, so it can never be replayed as a media, edit-bar or form token.
 * Nothing is stored for it: the entry's `addedAtMs` is what binds a link to
 * one request, so removing an address and adding it again retires every
 * link sent before, and a link for an address already confirmed confirms
 * nothing new.
 *
 * Confirming takes the session of the member who added the address — not
 * merely the link. Opening the mailbox proves the address receives mail;
 * it does not prove the mailbox is the member's. A prospect whose address
 * was pasted into the wrong field receives the link too, and a link that
 * worked for whoever opened it would let that prospect turn their own
 * address into the member's, after which every reply they sent would be
 * filed as the member writing to nobody.
 *
 * Firestore is a parameter, as in `crm-inbound-email.ts`, so a spec needs a
 * store and nothing else; the rate limiter and the email meter are loaded
 * only when a message is actually sent.
 */

/** The version tag at the head of a token, so a later claim change is refused by shape. */
const TOKEN_VERSION = 'mea1'

/** Domain separation from every other token the shared secret signs. */
const TOKEN_CONTEXT = 'member-email-alias:v1'

/** Far above any real token, so an oversized value is refused unparsed. */
const TOKEN_MAX_CHARS = 2048

/** Confirmation emails one member may cause per hour, across addresses. */
export const MEMBER_EMAIL_ALIAS_SENDS_PER_MEMBER_PER_HOUR = 10

/**
 * Confirmation emails one address may receive per hour, from anybody.
 * Per member alone would let many members aim at one mailbox; per address
 * alone would let one member walk a list — the two limits the account
 * address route applies, for the same mailbomb shape.
 */
export const MEMBER_EMAIL_ALIAS_SENDS_PER_ADDRESS_PER_HOUR = 3

/** Every refusal this module answers with, as a stable code. */
export type MemberEmailAliasRefusal =
  | MemberEmailAliasAddRefusal
  | 'not-a-member'
  | 'unknown-address'
  | 'token-invalid'
  | 'token-expired'
  | 'wrong-member'
  | 'link-retired'

export interface MemberEmailAliasRefused {
  ok: false
  refusal: MemberEmailAliasRefusal
  message: string
}

const refused = (refusal: MemberEmailAliasRefusal, message: string): MemberEmailAliasRefused => ({
  ok: false,
  refusal,
  message,
})

const NOT_A_MEMBER = 'Only a member of this workspace can add addresses to it.'

function aliasesRef(firestore: FirebaseFirestore.Firestore, orgId: string, uid: string) {
  return firestore
    .collection('orgs')
    .doc(orgId)
    .collection(MEMBER_EMAIL_ALIASES_COLLECTION)
    .doc(uid)
}

function memberRef(firestore: FirebaseFirestore.Firestore, orgId: string, uid: string) {
  return firestore.collection('orgs').doc(orgId).collection('members').doc(uid)
}

/** The addresses one member has added in one workspace, confirmed or not. */
export async function listMemberEmailAliases(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  uid: string,
): Promise<MemberEmailAlias[]> {
  const snapshot = await aliasesRef(firestore, orgId, uid).get()
  return readMemberEmailAliases(snapshot.exists ? snapshot.data() : null)
}

export type MemberEmailAliasAdded =
  | {
      ok: true
      alias: MemberEmailAlias
      /** False when the address was already waiting for confirmation. */
      created: boolean
    }
  | MemberEmailAliasRefused

/**
 * Adds an address, unconfirmed, for a member of the workspace — or answers
 * the entry already waiting for it, so the caller sends another link. One
 * transaction over the roster row and the member's document, so the
 * ceiling is counted from what is stored at the moment of the write and an
 * address is never added for somebody who is no longer a member.
 */
export async function addMemberEmailAlias(
  firestore: FirebaseFirestore.Firestore,
  input: {
    orgId: string
    uid: string
    address: unknown
    /** The address the member signs in with, which is theirs already. */
    signInEmail?: string | null
    /** Domains the deployment receives mail at — the capture domain. */
    reservedDomains?: readonly string[]
    nowMs?: number
  },
): Promise<MemberEmailAliasAdded> {
  const nowMs = input.nowMs ?? Date.now()
  const ref = aliasesRef(firestore, input.orgId, input.uid)
  const roster = memberRef(firestore, input.orgId, input.uid)
  return firestore.runTransaction<MemberEmailAliasAdded>(async (tx) => {
    const member = await tx.get(roster)
    if (!member.exists) return refused('not-a-member', NOT_A_MEMBER)
    const stored = await tx.get(ref)
    const aliases = readMemberEmailAliases(stored.exists ? stored.data() : null)
    const verdict = evaluateMemberEmailAliasAdd({
      address: input.address,
      signInEmail: input.signInEmail ?? null,
      aliases,
      reservedDomains: input.reservedDomains ?? [],
    })
    if (verdict.ok === false) return refused(verdict.refusal, verdict.message)
    if (verdict.existing) return { ok: true, alias: verdict.existing, created: false }
    const alias: MemberEmailAlias = { address: verdict.address, addedAtMs: nowMs }
    tx.set(ref, { uid: input.uid, aliases: [...aliases, alias], updatedAtMs: nowMs })
    return { ok: true, alias, created: true }
  })
}

/**
 * Removes one address, confirmed or not; the document goes with its last
 * address. Removal retires every link sent for the address, because a link
 * names the entry's `addedAtMs` and there is no longer an entry to match.
 */
export type MemberEmailAliasRemoved =
  | { ok: true; removed: MemberEmailAlias }
  | MemberEmailAliasRefused

export async function removeMemberEmailAlias(
  firestore: FirebaseFirestore.Firestore,
  input: { orgId: string; uid: string; address: unknown; nowMs?: number },
): Promise<MemberEmailAliasRemoved> {
  const address = normalizeMemberEmailAlias(input.address)
  if (!address) return refused('invalid-address', 'Enter a valid email address.')
  const nowMs = input.nowMs ?? Date.now()
  const ref = aliasesRef(firestore, input.orgId, input.uid)
  return firestore.runTransaction<MemberEmailAliasRemoved>(async (tx) => {
    const stored = await tx.get(ref)
    const aliases = readMemberEmailAliases(stored.exists ? stored.data() : null)
    const removed = aliases.find((alias) => alias.address === address)
    if (!removed) return refused('unknown-address', 'That address is not on your list.')
    const remaining = aliases.filter((alias) => alias.address !== address)
    if (remaining.length) {
      tx.set(ref, { uid: input.uid, aliases: remaining, updatedAtMs: nowMs })
    } else {
      tx.delete(ref)
    }
    return { ok: true, removed }
  })
}

/** What a confirmation link asserts. */
export interface MemberEmailAliasClaims {
  orgId: string
  uid: string
  address: string
  /** The `addedAtMs` of the entry the link was sent for. */
  addedAtMs: number
  /** Expiry, epoch ms. */
  exp: number
}

interface WireClaims {
  o: string
  u: string
  a: string
  t: number
  e: number
}

const signature = (payload: string): string =>
  createHmac('sha256', tokenSigningSecret()).update(`${TOKEN_CONTEXT}:${payload}`).digest('base64url')

/**
 * The token a confirmation link carries for one entry. Throws when
 * `TOKEN_SIGNING_SECRET` is not configured, like every token that secret
 * signs; the route answers that as a failure to send.
 */
export function mintMemberEmailAliasToken(
  claims: Omit<MemberEmailAliasClaims, 'exp'>,
  nowMs: number = Date.now(),
): string {
  const wire: WireClaims = {
    o: claims.orgId,
    u: claims.uid,
    a: claims.address,
    t: claims.addedAtMs,
    e: nowMs + MEMBER_EMAIL_ALIAS_CONFIRM_TTL_MS,
  }
  const payload = Buffer.from(JSON.stringify(wire), 'utf8').toString('base64url')
  return `${TOKEN_VERSION}.${payload}.${signature(payload)}`
}

/**
 * The claims a token carries, or why it carries none: `token-expired` for a
 * genuine link past its day, `token-invalid` for anything else — tampered,
 * truncated, another version, or a deployment with no signing secret, whose
 * only safe reading of a link is that it proves nothing.
 */
export function readMemberEmailAliasToken(
  token: unknown,
  nowMs: number = Date.now(),
): { ok: true; claims: MemberEmailAliasClaims } | MemberEmailAliasRefused {
  const invalid = refused('token-invalid', 'That confirmation link is not valid.')
  if (typeof token !== 'string' || !token || token.length > TOKEN_MAX_CHARS) return invalid
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return invalid
  const [, payload, signed] = parts
  let expected: string
  try {
    expected = signature(payload)
  } catch {
    return invalid
  }
  if (!safeEqual(signed, expected)) return invalid
  let wire: Partial<WireClaims>
  try {
    wire = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<WireClaims>
  } catch {
    return invalid
  }
  const address = normalizeMemberEmailAlias(wire?.a)
  const orgId = typeof wire?.o === 'string' ? wire.o : ''
  const uid = typeof wire?.u === 'string' ? wire.u : ''
  const addedAtMs = Number(wire?.t)
  const exp = Number(wire?.e)
  if (!orgId || !uid || !address || !Number.isFinite(addedAtMs) || !Number.isFinite(exp)) {
    return invalid
  }
  if (exp <= nowMs) {
    return refused('token-expired', 'That confirmation link has expired. Send a new one from the list.')
  }
  return { ok: true, claims: { orgId, uid, address, addedAtMs, exp } }
}

export type MemberEmailAliasConfirmed =
  | {
      ok: true
      orgId: string
      address: string
      /** True when the address had been confirmed before this call. */
      alreadyConfirmed: boolean
    }
  | MemberEmailAliasRefused

/**
 * Confirms the address a link was sent for, for the member signed in — who
 * must be the member who added it (see the module comment). A link for an
 * entry that has since been removed or added again is refused as retired,
 * and opening a link twice is not an error.
 */
export async function confirmMemberEmailAlias(
  firestore: FirebaseFirestore.Firestore,
  input: { token: unknown; callerUid: string; nowMs?: number },
): Promise<MemberEmailAliasConfirmed> {
  const nowMs = input.nowMs ?? Date.now()
  const read = readMemberEmailAliasToken(input.token, nowMs)
  if (read.ok === false) return read
  const { claims } = read
  if (!input.callerUid || claims.uid !== input.callerUid) {
    return refused(
      'wrong-member',
      'This link confirms an address for another member. Sign in as the member who added it, then open the link again.',
    )
  }
  const ref = aliasesRef(firestore, claims.orgId, claims.uid)
  const roster = memberRef(firestore, claims.orgId, claims.uid)
  return firestore.runTransaction<MemberEmailAliasConfirmed>(async (tx) => {
    const member = await tx.get(roster)
    if (!member.exists) return refused('not-a-member', 'You are no longer a member of that workspace.')
    const stored = await tx.get(ref)
    const aliases = readMemberEmailAliases(stored.exists ? stored.data() : null)
    const entry = aliases.find((alias) => alias.address === claims.address)
    if (!entry || entry.addedAtMs !== claims.addedAtMs) {
      return refused(
        'link-retired',
        'This link is for an address that has since been removed or added again. Send a new link from the list.',
      )
    }
    if (isVerifiedMemberEmailAlias(entry)) {
      return { ok: true, orgId: claims.orgId, address: entry.address, alreadyConfirmed: true }
    }
    const next = aliases.map((alias) =>
      alias.address === entry.address ? { ...alias, verifiedAtMs: nowMs } : alias,
    )
    tx.set(ref, { uid: claims.uid, aliases: next, updatedAtMs: nowMs })
    return { ok: true, orgId: claims.orgId, address: entry.address, alreadyConfirmed: false }
  })
}

/**
 * A console path a link may land on: absolute, on the console's own
 * origin, with no query or fragment of its own. Anything else lands on
 * `/`, which still signs the member in.
 */
const RETURN_PATH = /^\/(?![/\\])[^\s?#\\]{0,511}$/

/**
 * The link a confirmation email carries: the console origin the caller
 * resolved from server configuration — never from a request header — the
 * page the member added the address on, and the token.
 */
export function memberEmailAliasConfirmUrl(input: {
  origin: string
  returnPath?: unknown
  token: string
}): string {
  const origin = String(input.origin ?? '').replace(/\/+$/, '')
  const raw = typeof input.returnPath === 'string' ? input.returnPath : ''
  const path = RETURN_PATH.test(raw) ? raw : '/'
  return `${origin}${path}?${MEMBER_EMAIL_ALIAS_CONFIRM_PARAM}=${encodeURIComponent(input.token)}`
}

export type MemberEmailAliasConfirmationSent =
  | { sent: true }
  | { sent: false; status: 429 | 501 | 502; error: string }

/**
 * Emails the confirmation link to the address, in the workspace's brand.
 *
 * Rate-limited per member and per destination address before anything is
 * sent (see the two ceilings above), and metered to the workspace, whose
 * member asked for it.
 */
export async function sendMemberEmailAliasConfirmation(input: {
  orgId: string
  /** The org document, for its name and its brand. */
  org: Record<string, unknown> | null
  uid: string
  /** The member's display name, when the roster row carries one. */
  memberName?: string | null
  address: string
  confirmUrl: string
}): Promise<MemberEmailAliasConfirmationSent> {
  if (!isEmailConfigured()) {
    return { sent: false, status: 501, error: 'Email is not configured on this deployment.' }
  }
  const { consumeRateLimit } = await import('./rate-limit-store')
  const perMember = await consumeRateLimit(`member-email-alias-confirm:${input.uid}`, {
    limit: MEMBER_EMAIL_ALIAS_SENDS_PER_MEMBER_PER_HOUR,
    windowMs: 60 * 60 * 1000,
  })
  if (!perMember.allowed) {
    return { sent: false, status: 429, error: 'Too many confirmation emails. Try again in an hour.' }
  }
  const perAddress = await consumeRateLimit(`member-email-alias-target:${input.address}`, {
    limit: MEMBER_EMAIL_ALIAS_SENDS_PER_ADDRESS_PER_HOUR,
    windowMs: 60 * 60 * 1000,
  })
  if (!perAddress.allowed) {
    return {
      sent: false,
      status: 429,
      error: 'Too many confirmation emails for that address. Try again later.',
    }
  }

  const branding = resolveBrandingProfile((input.org ?? null) as never)
  const workspace = String(input.org?.['name'] ?? '').trim() || 'your workspace'
  const member = String(input.memberName ?? '').trim()
  const text = [
    `${member || 'A member'} asked to add ${input.address} as one of their own email ` +
      `addresses in the ${workspace} workspace on ${branding.productName}.`,
    '',
    `To confirm it, open this link while signed in as ${member || 'that member'}:`,
    '',
    input.confirmUrl,
    '',
    `Once it is confirmed, email sent from ${input.address} with the workspace's capture ` +
      'address in BCC is filed under the person it was written to. The link works for 24 hours.',
    '',
    'If you did not expect this email, ignore it. Nothing changes unless the member who asked opens the link.',
  ].join('\n')
  const result = await sendEmail({
    to: input.address,
    subject: `Confirm your address for ${workspace}`,
    text,
    fromName: branding.fromName,
    context: 'member-email-alias-confirmation',
  })
  if (!result.sent) {
    return { sent: false, status: 502, error: 'The confirmation email could not be sent.' }
  }
  const { meterOrgEmail } = await import('./email-metering')
  await meterOrgEmail(input.orgId).catch(() => undefined)
  return { sent: true }
}
