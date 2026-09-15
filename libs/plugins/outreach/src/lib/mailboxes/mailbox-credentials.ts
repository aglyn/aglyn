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
  needsReseal,
  openSecret,
  sealSecret,
  type SecretBoxKeyring,
} from '@aglyn/shared-util-tools/secret-box'
import { createHash } from 'node:crypto'
import {
  OUTREACH_COLLECTIONS,
  type OutreachMailboxCredentials,
} from '../model/outreach.types'

/**
 * A MAILBOX'S GRANT AT REST (AGL-2978): `outreachMailboxCredentials/{mailboxId}`.
 *
 * The refresh token is the only secret, and it is stored only sealed —
 * AES-256-GCM under `OUTREACH_TOKEN_KEY` through the shared secret box, bound
 * to this document by the seal's context, so a sealed token copied into
 * another mailbox's credential refuses to open there. Every other field is
 * bookkeeping a reader needs without the key: which account, which scopes,
 * which member, which key sealed it.
 *
 * Sealed fields carry `token` in their names. The personal-data export
 * redacts by field name first, and a neutral name would be judged by its
 * value's shape alone.
 */

/** A connected Google mailbox's stored credential. */
export interface OutreachGoogleMailboxCredentials extends OutreachMailboxCredentials {
  provider: 'google'
  /** The member who connected the mailbox. */
  connectedByUid: string
  /** Google's stable account id (`sub`), so one account's grants can be found. */
  providerAccountId: string
  /** The account's address, as Google verified it. */
  email: string
  /** The scopes Google granted, as it listed them. */
  scopes: string[]
  /** The refresh token, sealed — see the module comment. */
  sealedRefreshToken: string
  /** The id of the key that sealed it, for rotation. */
  tokenKeyId: string
}

/** The context a mailbox's refresh token is sealed under. */
export function refreshTokenSealContext(mailboxId: string): string {
  return `${OUTREACH_COLLECTIONS.mailboxCredentials}/${mailboxId}#refreshToken`
}

/** Seals a refresh token for one mailbox under the keyring's current key. */
export function sealMailboxRefreshToken(
  refreshToken: string,
  mailboxId: string,
  keyring: SecretBoxKeyring,
): { sealedRefreshToken: string; tokenKeyId: string } {
  return {
    sealedRefreshToken: sealSecret(refreshToken, keyring.current, {
      context: refreshTokenSealContext(mailboxId),
    }),
    tokenKeyId: keyring.current.id,
  }
}

/**
 * Opens a stored credential's refresh token. Throws `SecretBoxError` when it
 * cannot be opened — a missing or rotated-away key, or a tampered value.
 */
export function openMailboxRefreshToken(
  credential: Pick<OutreachGoogleMailboxCredentials, 'mailboxId' | 'sealedRefreshToken'>,
  keyring: SecretBoxKeyring,
): { refreshToken: string; needsReseal: boolean } {
  const opened = openSecret(credential.sealedRefreshToken, keyring, {
    context: refreshTokenSealContext(credential.mailboxId),
  })
  return { refreshToken: opened.plaintext, needsReseal: needsReseal(opened, keyring) }
}

/**
 * The id a member's mailbox for one Google account has in one organization.
 *
 * Derived rather than random, so connecting the same account again updates
 * the same mailbox instead of adding a second one, and two members — or two
 * organizations — connecting one account never share an id. The credential
 * collection is top-level, keyed by this id, so it must be unique across
 * every organization, which is why the org is part of it.
 */
export function outreachMailboxId(orgId: string, uid: string, providerAccountId: string): string {
  const hash = createHash('sha256').update(`${orgId}\n${uid}\ngoogle\n${providerAccountId}`).digest('base64url')
  return `gm_${hash.slice(0, 24)}`
}

export function mailboxCredentialsRef(firestore: FirebaseFirestore.Firestore, mailboxId: string) {
  return firestore.collection(OUTREACH_COLLECTIONS.mailboxCredentials).doc(mailboxId)
}

export function mailboxRef(firestore: FirebaseFirestore.Firestore, orgId: string, mailboxId: string) {
  return firestore
    .collection('orgs')
    .doc(orgId)
    .collection(OUTREACH_COLLECTIONS.mailboxes)
    .doc(mailboxId)
}

/** A stored credential read defensively, or `null` when it is not one. */
export function readMailboxCredentials(data: unknown): OutreachGoogleMailboxCredentials | null {
  const record = (data ?? null) as Partial<OutreachGoogleMailboxCredentials> | null
  if (
    !record ||
    record.provider !== 'google' ||
    typeof record.mailboxId !== 'string' ||
    typeof record.orgId !== 'string' ||
    typeof record.sealedRefreshToken !== 'string' ||
    !record.sealedRefreshToken
  ) {
    return null
  }
  return {
    id: String(record.id ?? record.mailboxId),
    orgId: record.orgId,
    mailboxId: record.mailboxId,
    provider: 'google',
    connectedByUid: String(record.connectedByUid ?? ''),
    providerAccountId: String(record.providerAccountId ?? ''),
    email: String(record.email ?? ''),
    scopes: Array.isArray(record.scopes) ? record.scopes.map(String) : [],
    sealedRefreshToken: record.sealedRefreshToken,
    tokenKeyId: String(record.tokenKeyId ?? ''),
    createdAtMs: Number(record.createdAtMs) || 0,
    updatedAtMs: Number(record.updatedAtMs) || 0,
  }
}

/**
 * How many OTHER stored credentials hold a grant for the same Google account.
 *
 * Google's revocation ends the whole grant this client holds for an account,
 * not one token, so revoking while another mailbox still uses the account —
 * the same shared inbox connected by two members, or one account connected
 * in two organizations — would silently break that mailbox. A disconnect or
 * an erasure asks this first and leaves the grant alone while it is shared.
 */
export async function countOtherCredentialsForAccount(
  firestore: FirebaseFirestore.Firestore,
  input: { providerAccountId: string; mailboxId: string; excludeOrgId?: string },
): Promise<number> {
  if (!input.providerAccountId) return 0
  const snapshot = await firestore
    .collection(OUTREACH_COLLECTIONS.mailboxCredentials)
    .where('providerAccountId', '==', input.providerAccountId)
    .limit(20)
    .get()
  return snapshot.docs.filter((doc) => {
    if (doc.id === input.mailboxId) return false
    return !input.excludeOrgId || doc.get('orgId') !== input.excludeOrgId
  }).length
}
