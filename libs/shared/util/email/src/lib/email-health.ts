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

import { RESEND_SEND_ENDPOINT, getEmailConfig } from './send-email'

export interface EmailConfigReport {
  /** Both env vars present — mail will at least be attempted. */
  configured: boolean
  hasApiKey: boolean
  hasFrom: boolean
  /**
   * The configured sender, e.g. `Aglyn <noreply@aglyn.com>`. Not a secret —
   * it appears in the headers of every message we send.
   */
  from: string | null
  /** Domain part of the sender, which is what must be verified in Resend. */
  fromDomain: string | null
}

/**
 * Describes the email configuration without revealing the API key.
 *
 * Answers "is this environment able to send mail?" — the question that is
 * otherwise only answerable by emailing a real person and waiting.
 */
export function describeEmailConfig(): EmailConfigReport {
  const { apiKey, from } = getEmailConfig()
  const match = from?.match(/<([^>]+)>/)
  const address = (match?.[1] ?? from ?? '').trim()
  const domain = address.includes('@') ? address.split('@').pop()! : null
  return {
    configured: Boolean(apiKey && from),
    hasApiKey: Boolean(apiKey),
    hasFrom: Boolean(from),
    from: from ?? null,
    fromDomain: domain,
  }
}

export type EmailCredentialStatus =
  | 'ok'
  | 'unconfigured'
  | 'invalid-key'
  | 'unknown'

export interface EmailCredentialReport {
  status: EmailCredentialStatus
  /** HTTP status Resend answered the probe with, when it answered. */
  probeStatus?: number
  detail?: string
}

/**
 * Checks whether `RESEND_API_KEY` is actually accepted by Resend — without
 * sending anything to anybody.
 *
 * How: it POSTs an **empty body** to the send endpoint. No recipient and no
 * sender means no message can be created, so this is safe to run against
 * production. What differs is the rejection:
 *
 * - `401`/`403` — the key itself was refused → `invalid-key`
 * - `422`/`400` — the key was accepted, the empty payload was not → `ok`
 *
 * A sending-scoped Resend key has no read permissions, so there is no
 * `GET /domains` available to us; this is the only no-send liveness signal.
 * It cannot confirm that *domain verification* has completed — only a real
 * send does that.
 */
export async function checkEmailCredentials(): Promise<EmailCredentialReport> {
  const { apiKey } = getEmailConfig()
  if (!apiKey) return { status: 'unconfigured' }

  try {
    const response = await fetch(RESEND_SEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
    const detail = (await response.text().catch(() => '')).slice(0, 300)

    if (response.status === 401 || response.status === 403) {
      return { status: 'invalid-key', probeStatus: response.status, detail }
    }
    if (response.status === 422 || response.status === 400) {
      return { status: 'ok', probeStatus: response.status }
    }
    return { status: 'unknown', probeStatus: response.status, detail }
  } catch (error) {
    return {
      status: 'unknown',
      detail: String((error as Error)?.message ?? error).slice(0, 300),
    }
  }
}
