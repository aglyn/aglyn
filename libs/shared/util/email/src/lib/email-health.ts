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

import { getEmailConfig } from './send-email'

/**
 * Where the credential probe asks its question.
 *
 * Deliberately NOT the send endpoint. A probe aimed at `/emails` is a send
 * attempt however empty its body is: it consumes an API call, and Resend
 * records it in the account's logs as a `422` on `POST /emails` with no
 * recipient, no subject and nothing identifying the caller — a line an
 * operator reading that dashboard has to treat as failed mail. A domain read
 * cannot create a message and cannot be mistaken for one.
 */
export const RESEND_DOMAINS_ENDPOINT = 'https://api.resend.com/domains'

/**
 * Resend error names that mean the key itself was not accepted, as opposed to
 * a key that authenticated and merely lacks read scope. Matched by NAME, not
 * status: `401` and `403` each cover both meanings.
 */
const REFUSED_KEY_ERRORS = new Set([
  'missing_api_key',
  'validation_error',
  'suspended_api_key',
])

/**
 * Resend error names that mean the key authenticated and was then denied this
 * particular read. A sending-scoped key — the shape Aglyn provisions — always
 * lands here, and reaching this answer at all required Resend to recognize
 * the credential, which is exactly what the probe is asking.
 */
const AUTHENTICATED_BUT_UNSCOPED_ERRORS = new Set([
  'restricted_api_key',
  'invalid_permission',
])

/** The `name` Resend puts on an error body, or `''` for anything else. */
function resendErrorName(body: string): string {
  try {
    const parsed = JSON.parse(body) as { name?: unknown }
    return typeof parsed?.name === 'string' ? parsed.name : ''
  } catch {
    return ''
  }
}

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
 * sending anything to anybody, and without leaving anything behind that reads
 * as failed mail.
 *
 * How: a `GET` of the domains collection. The question is only ever "does
 * Resend recognize this credential", so the probe reads the ERROR NAME rather
 * than the status, because `401` and `403` each carry both meanings:
 *
 * - `2xx` — the key is accepted and has read scope → `ok`
 * - `restricted_api_key` / `invalid_permission` — Resend authenticated the
 *   key and then denied it this read. A sending-scoped key, which is what
 *   Aglyn provisions, always answers this way, and getting the answer proves
 *   the credential works → `ok`
 * - `missing_api_key` / `validation_error` / `suspended_api_key` — the key
 *   itself was refused → `invalid-key`
 * - anything else → `unknown`
 *
 * An unrecognized rejection is `unknown`, never `invalid-key`: this feeds a
 * staff diagnostics screen whose whole value is that a red line means
 * something, and a shape we have not seen before is not evidence that a
 * working key is broken.
 *
 * It cannot confirm that *domain verification* has completed — only a real
 * send does that.
 */
export async function checkEmailCredentials(): Promise<EmailCredentialReport> {
  const { apiKey } = getEmailConfig()
  if (!apiKey) return { status: 'unconfigured' }

  try {
    const response = await fetch(RESEND_DOMAINS_ENDPOINT, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    const detail = (await response.text().catch(() => '')).slice(0, 300)

    if (response.status >= 200 && response.status < 300) {
      return { status: 'ok', probeStatus: response.status }
    }
    if (response.status === 401 || response.status === 403) {
      const name = resendErrorName(detail)
      if (AUTHENTICATED_BUT_UNSCOPED_ERRORS.has(name)) {
        return { status: 'ok', probeStatus: response.status }
      }
      if (REFUSED_KEY_ERRORS.has(name)) {
        return { status: 'invalid-key', probeStatus: response.status, detail }
      }
    }
    return { status: 'unknown', probeStatus: response.status, detail }
  } catch (error) {
    return {
      status: 'unknown',
      detail: String((error as Error)?.message ?? error).slice(0, 300),
    }
  }
}
