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
import { GmailTransportError } from '../transport/gmail-errors'
import { revokeGoogleToken } from '../transport/google-oauth'
import type { TransportDeps } from '../transport/http'
import type { OutreachMailboxDisconnectResponse } from './mailbox-api'
import {
  countOtherCredentialsForAccount,
  openMailboxRefreshToken,
  type OutreachGoogleMailboxCredentials,
} from './mailbox-credentials'
import type { OutreachGoogleConfigResult } from './outreach-config'

/**
 * TELLING GOOGLE A STORED GRANT IS OVER (AGL-2978).
 *
 * A disconnect, a workspace erasure and an account erasure all end a
 * mailbox's grant the same way: open its sealed refresh token with this
 * deployment's key and revoke it at Google — unless another stored
 * credential still uses the same Google account, because Google's
 * revocation ends the whole grant this client holds for the account, and
 * revoking it would silently break that other mailbox.
 *
 * Never throws. A grant that cannot be revoked is still deleted by whoever
 * called this; the outcome says which happened.
 */

/**
 * What became of a grant at Google: `revoked`, `already-invalid`,
 * `kept-for-other-mailbox` while another credential still uses the account,
 * or `failed` when Google could not be told — the token would not open, the
 * deployment is not configured, or Google did not answer.
 */
export type OutreachGrantRevocation = OutreachMailboxDisconnectResponse['revocation']

export interface OutreachRevokeDeps {
  readConfig(): OutreachGoogleConfigResult
  /** The network and retry policy the revocation call uses. */
  transport: TransportDeps
}

export interface RevokeMailboxGrantOptions {
  /**
   * Credentials of this organization do not count as another use of the
   * account: the workspace erasure is ending all of them.
   */
  excludeOrgId?: string
  /**
   * These credentials do not count as another use of the account either:
   * the account erasure is ending every one of the person's grants.
   */
  excludeMailboxIds?: ReadonlySet<string>
}

/** Revokes one stored grant at Google, unless it is still shared. Never throws. */
export async function revokeMailboxGrant(
  firestore: FirebaseFirestore.Firestore,
  credential: OutreachGoogleMailboxCredentials,
  deps: OutreachRevokeDeps,
  options: RevokeMailboxGrantOptions = {},
): Promise<OutreachGrantRevocation> {
  try {
    const others = await countOtherCredentialsForAccount(firestore, {
      providerAccountId: credential.providerAccountId,
      mailboxId: credential.mailboxId,
      excludeOrgId: options.excludeOrgId,
      excludeMailboxIds: options.excludeMailboxIds,
    })
    if (others > 0) return 'kept-for-other-mailbox'
    const config = deps.readConfig()
    if (!config.configured) return 'failed'
    const { refreshToken } = openMailboxRefreshToken(credential, config.config.keyring)
    return await revokeGoogleToken(refreshToken, deps.transport)
  } catch (error) {
    if (!(error instanceof GmailTransportError) && !(error instanceof SecretBoxError)) {
      console.error('[outreach] revoking a mailbox grant failed', error)
    }
    return 'failed'
  }
}
