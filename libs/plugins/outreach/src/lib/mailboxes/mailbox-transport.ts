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
import { createGmailClient, type GmailClient } from '../transport/gmail-client'
import type { TransportDeps } from '../transport/http'
import {
  mailboxCredentialsRef,
  mailboxRef,
  openMailboxRefreshToken,
  readMailboxCredentials,
  sealMailboxRefreshToken,
  type OutreachGoogleMailboxCredentials,
} from './mailbox-credentials'
import {
  readOutreachGoogleConfig,
  type OutreachGoogleConfigResult,
} from './outreach-config'

/**
 * A CONNECTED MAILBOX, OPENED FOR SENDING (AGL-2978).
 *
 * The door the send and sync runtime, and the panel's test send, reach a
 * mailbox's Gmail through: the stored credential read, its refresh token
 * opened with the deployment's key, and a transport client built on it. The
 * token never leaves this function except inside the client.
 *
 * A token opened under an older key of the keyring is sealed again under the
 * current one on the way through, so a key rotation completes itself as
 * mailboxes are used rather than needing a migration.
 */

export type OpenedOutreachMailbox =
  | { ok: true; client: GmailClient; credential: OutreachGoogleMailboxCredentials }
  | {
      ok: false
      /**
       * - `not-configured` — this deployment has no Outreach client or key.
       * - `no-credential` — nothing is stored for the mailbox.
       * - `sealed-token-unreadable` — the stored token does not open with
       *   this deployment's key (rotated away, or altered). The mailbox needs
       *   connecting again.
       */
      reason: 'not-configured' | 'no-credential' | 'sealed-token-unreadable'
    }

export interface OpenMailboxDeps extends TransportDeps {
  readConfig?: () => OutreachGoogleConfigResult
}

export async function openOutreachMailboxClient(
  firestore: FirebaseFirestore.Firestore,
  input: { mailboxId: string },
  deps: OpenMailboxDeps = {},
): Promise<OpenedOutreachMailbox> {
  const config = (deps.readConfig ?? readOutreachGoogleConfig)()
  if (!config.configured) return { ok: false, reason: 'not-configured' }
  const snapshot = await mailboxCredentialsRef(firestore, input.mailboxId).get()
  const credential = readMailboxCredentials(snapshot.exists ? snapshot.data() : null)
  if (!credential || credential.mailboxId !== input.mailboxId) {
    return { ok: false, reason: 'no-credential' }
  }
  let opened: { refreshToken: string; needsReseal: boolean }
  try {
    opened = openMailboxRefreshToken(credential, config.config.keyring)
  } catch (error) {
    if (error instanceof SecretBoxError) return { ok: false, reason: 'sealed-token-unreadable' }
    throw error
  }
  if (opened.needsReseal) {
    await resealMailboxRefreshToken(firestore, credential, opened.refreshToken, config.config.keyring, deps.now)
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
 * Seals a token again under the current key, only if the stored value is
 * still the one that was opened: a reconnect that landed in between wrote a
 * newer grant, and that one wins. Best-effort — a failure leaves the old
 * seal, which still opens.
 */
async function resealMailboxRefreshToken(
  firestore: FirebaseFirestore.Firestore,
  credential: OutreachGoogleMailboxCredentials,
  refreshToken: string,
  keyring: Parameters<typeof sealMailboxRefreshToken>[2],
  now: (() => number) | undefined,
): Promise<void> {
  const ref = mailboxCredentialsRef(firestore, credential.mailboxId)
  try {
    await firestore.runTransaction(async (tx) => {
      const current = await tx.get(ref)
      if (current.get('sealedRefreshToken') !== credential.sealedRefreshToken) return
      tx.update(ref, {
        ...sealMailboxRefreshToken(refreshToken, credential.mailboxId, keyring),
        updatedAtMs: (now ?? Date.now)(),
      })
    })
  } catch (error) {
    console.error('[outreach] resealing a mailbox token failed', error)
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
