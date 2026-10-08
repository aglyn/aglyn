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

import { callProvider, ReviewPlatformError, type ProviderFetch } from './http'

/**
 * Trustpilot's Invitations API with the merchant's OWN API key and secret
 * (AGL-3699), from their Trustpilot Business account (Integrations →
 * Developers → APIs). No app of Aglyn's: the key is the merchant's, and
 * Trustpilot's `client_credentials` grant issues a token for it, sent with
 * the business user it acts for.
 *
 *   POST https://api.trustpilot.com/v1/oauth/oauth-business-users-for-applications/accesstoken
 *        Basic key:secret, grant_type=client_credentials → access_token
 *   POST https://invitations-api.trustpilot.com/v1/private/business-units/{id}/email-invitations
 *        Bearer, x-business-user-id → 202
 *
 * Only a SERVICE review is asked for: product reviews stay on the store's
 * own built-in reviews.
 */

export const TRUSTPILOT_TOKEN_URL =
  'https://api.trustpilot.com/v1/oauth/oauth-business-users-for-applications/accesstoken'
export const TRUSTPILOT_INVITATIONS_API_BASE = 'https://invitations-api.trustpilot.com/v1'

const VENDOR = 'Trustpilot'

export interface TrustpilotCredentials {
  apiKey: string
  apiSecret: string
  fetchImpl?: ProviderFetch
}

function basic(apiKey: string, apiSecret: string): string {
  return `Basic ${Buffer.from(`${apiKey}:${apiSecret}`, 'utf8').toString('base64')}`
}

/** A token for the merchant's key. Also how a key is checked before it is kept. */
export async function trustpilotAccessToken(credentials: TrustpilotCredentials): Promise<string> {
  const answer = await callProvider<{ access_token?: unknown }>({
    vendor: VENDOR,
    method: 'POST',
    url: TRUSTPILOT_TOKEN_URL,
    headers: { Authorization: basic(credentials.apiKey, credentials.apiSecret) },
    form: { grant_type: 'client_credentials' },
    fetchImpl: credentials.fetchImpl,
  })
  const token = typeof answer.body?.access_token === 'string' ? answer.body.access_token.trim() : ''
  if (!token) throw new ReviewPlatformError(VENDOR, 502, 'Trustpilot issued no access token', answer.body)
  return token
}

export interface TrustpilotInvitation {
  businessUnitId: string
  businessUserId: string | null
  consumerEmail: string
  consumerName: string
  /** The order number the store shows. */
  referenceNumber: string
  locale: string
  templateId: string | null
  senderName: string | null
}

/** Asks Trustpilot to invite one buyer to review the store. */
export async function createTrustpilotInvitation(
  credentials: TrustpilotCredentials,
  invitation: TrustpilotInvitation,
): Promise<void> {
  const token = await trustpilotAccessToken(credentials)
  await callProvider({
    vendor: VENDOR,
    method: 'POST',
    url: `${TRUSTPILOT_INVITATIONS_API_BASE}/private/business-units/${encodeURIComponent(invitation.businessUnitId)}/email-invitations`,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(invitation.businessUserId ? { 'x-business-user-id': invitation.businessUserId } : {}),
    },
    json: {
      consumerEmail: invitation.consumerEmail,
      consumerName: invitation.consumerName,
      referenceNumber: invitation.referenceNumber,
      locale: invitation.locale,
      type: 'email',
      ...(invitation.senderName ? { senderName: invitation.senderName } : {}),
      serviceReviewInvitation: {
        ...(invitation.templateId ? { templateId: invitation.templateId } : {}),
        tags: ['aglyn'],
      },
    },
    fetchImpl: credentials.fetchImpl,
  })
}

/**
 * The data block a BCC invitation carries, which Trustpilot reads out of
 * the copied email's HTML: who to invite and under which order number.
 */
export function trustpilotBccDataBlock(input: { name: string; email: string; referenceId: string }) {
  return {
    type: 'application/json+trustpilot',
    json: { recipientName: input.name, recipientEmail: input.email, referenceId: input.referenceId },
  }
}
