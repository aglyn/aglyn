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

import { SecretBoxError } from '@aglyn/shared-util-tools/secret-box'
import { createGmailClient } from '../transport/gmail-client'
import { createGraphClient } from '../transport/graph-client'
import type { TransportDeps } from '../transport/http'
import type { OutreachMailClient } from '../transport/mail-client'
import {
  mailboxCredentialsRef,
  mailboxRef,
  openMailboxRefreshToken,
  readMailboxCredentials,
  sealMailboxRefreshToken,
  type OutreachStoredMailboxCredentials,
} from './mailbox-credentials'
import {
  readOutreachGoogleConfig,
  readOutreachMicrosoftConfig,
  type OutreachGoogleConfigResult,
  type OutreachMicrosoftConfigResult,
} from './outreach-config'

/**
 * A CONNECTED MAILBOX, OPENED FOR SENDING (AGL-2978).
 *
 * The door the send and sync runtime, and the panel's test send, reach a
 * mailbox through: the stored credential read, its refresh token opened with
 * the deployment's key, and the transport client for its provider — Gmail,
 * or Microsoft Graph (AGL-3489) — built on it. The token never leaves this
 * function except inside the client.
 *
 * Microsoft rotates refresh tokens; the Graph client hands a rotated one
 * back, and it is sealed and stored in place of the one it replaced.
 *
 * A token opened under an older key of the keyring is sealed again under the
 * current one on the way through, so a key rotation completes itself as
 * mailboxes are used rather than needing a migration.
 */

export type OpenedOutreachMailbox =
  | { ok: true; client: OutreachMailClient; credential: OutreachStoredMailboxCredentials }
  | {
      ok: false
      /**
       * - `not-configured` — this deployment has no Outreach client or key
       *   for the mailbox's provider.
       * - `no-credential` — nothing is stored for the mailbox.
       * - `sealed-token-unreadable` — the stored token does not open with
       *   this deployment's key (rotated away, or altered). The mailbox needs
       *   connecting again.
       */
      reason: 'not-configured' | 'no-credential' | 'sealed-token-unreadable'
    }

export interface OpenMailboxDeps extends TransportDeps {
  readConfig?: () => OutreachGoogleConfigResult
  readMicrosoftConfig?: () => OutreachMicrosoftConfigResult
}

export async function openOutreachMailboxClient(
  firestore: FirebaseFirestore.Firestore,
  input: { mailboxId: string },
  deps: OpenMailboxDeps = {},
): Promise<OpenedOutreachMailbox> {
  const snapshot = await mailboxCredentialsRef(firestore, input.mailboxId).get()
  const credential = readMailboxCredentials(snapshot.exists ? snapshot.data() : null)
  if (!credential || credential.mailboxId !== input.mailboxId) {
    const anyConfigured =
      (deps.readConfig ?? readOutreachGoogleConfig)().configured ||
      (deps.readMicrosoftConfig ?? readOutreachMicrosoftConfig)().configured
    return { ok: false, reason: anyConfigured ? 'no-credential' : 'not-configured' }
  }
  const microsoft = credential.provider === 'microsoft' ? (deps.readMicrosoftConfig ?? readOutreachMicrosoftConfig)() : null
  const config = microsoft ?? (deps.readConfig ?? readOutreachGoogleConfig)()
  if (!config.configured) return { ok: false, reason: 'not-configured' }
  let opened: { refreshToken: string; needsReseal: boolean }
  try {
    opened = openMailboxRefreshToken(credential, config.config.keyring)
  } catch (error) {
    if (error instanceof SecretBoxError) return { ok: false, reason: 'sealed-token-unreadable' }
    throw error
  }
  const resealed = opened.needsReseal
    ? await resealMailboxRefreshToken(firestore, credential, opened.refreshToken, config.config.keyring, deps.now)
    : null
  if (microsoft?.configured) {
    const keyring = microsoft.config.keyring
    // The seal the stored document holds now: a rotation replaces it, and
    // the next rotation is guarded against that one.
    let stored = resealed ? { ...credential, ...resealed } : credential
    const client = createGraphClient({
      ...deps,
      clientId: microsoft.config.clientId,
      clientSecret: microsoft.config.clientSecret,
      tenant: microsoft.config.tenant,
      refreshToken: opened.refreshToken,
      selfAddresses: [credential.email],
      onRefreshTokenRotated: async (refreshToken) => {
        const written = await resealMailboxRefreshToken(firestore, stored, refreshToken, keyring, deps.now)
        if (written) stored = { ...stored, ...written }
      },
    })
    return { ok: true, client, credential }
  }
  const client = createGmailClient({
    ...deps,
    clientId: config.config.clientId,
    clientSecret: config.config.clientSecret,
    refreshToken: opened.refreshToken,
  })
  return { ok: true, client, credential }
}

/**
 * Seals a token — the same one under the current key, or one the provider
 * rotated in — only if the stored value is still the one that was opened: a
 * reconnect that landed in between wrote a newer grant, and that one wins.
 * Best-effort — a failure leaves the old seal, which still opens. Answers
 * what it wrote, or `null` when it wrote nothing.
 */
async function resealMailboxRefreshToken(
  firestore: FirebaseFirestore.Firestore,
  credential: Pick<OutreachStoredMailboxCredentials, 'mailboxId' | 'sealedRefreshToken'>,
  refreshToken: string,
  keyring: Parameters<typeof sealMailboxRefreshToken>[2],
  now: (() => number) | undefined,
): Promise<{ sealedRefreshToken: string; tokenKeyId: string } | null> {
  const ref = mailboxCredentialsRef(firestore, credential.mailboxId)
  try {
    return await firestore.runTransaction(async (tx) => {
      const current = await tx.get(ref)
      if (current.get('sealedRefreshToken') !== credential.sealedRefreshToken) return null
      const sealed = sealMailboxRefreshToken(refreshToken, credential.mailboxId, keyring)
      tx.update(ref, { ...sealed, updatedAtMs: (now ?? Date.now)() })
      return sealed
    })
  } catch (error) {
    console.error('[outreach] resealing a mailbox token failed', error)
    return null
  }
}

/**
 * Marks a mailbox as needing a reconnect: the provider refused its grant, or
 * its stored token cannot be opened. Nothing sends from it until the member
 * connects it again, which returns it to where it was.
 */
export async function markOutreachMailboxReconnectRequired(
  firestore: FirebaseFirestore.Firestore,
  input: { orgId: string; mailboxId: string; errorCode: string; nowMs: number },
): Promise<void> {
  await mailboxRef(firestore, input.orgId, input.mailboxId)
    .update({
      status: 'reconnect_required',
      'health.lastErrorAtMs': input.nowMs,
      'health.lastErrorCode': input.errorCode,
      updatedAtMs: input.nowMs,
    })
    .catch((error: unknown) => {
      console.error('[outreach] marking a mailbox reconnect_required failed', error)
    })
}
