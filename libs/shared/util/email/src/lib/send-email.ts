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

/**
 * The Resend send endpoint. Every outbound application email in Aglyn goes
 * through here — invites, receipts, usage summaries, campaigns, staff alerts.
 *
 * Auth email (verification, password reset) is Firebase's job and does NOT
 * come through this module.
 */
export const RESEND_SEND_ENDPOINT = 'https://api.resend.com/emails'

/** A Resend delivery tag, used for webhook attribution (AGL-268). */
export interface EmailTag {
  name: string
  value: string
}

export interface SendEmailOptions {
  /** One or more recipient addresses. */
  to: string | string[]
  subject: string
  /** Plain-text body. Supply at least one of `text` or `html`. */
  text?: string
  /** HTML body. Supply at least one of `text` or `html`. */
  html?: string
  /** Extra MIME headers, e.g. `List-Unsubscribe`. */
  headers?: Record<string, string>
  /** Delivery tags for the opens/clicks webhook. */
  tags?: EmailTag[]
  replyTo?: string | string[]
  /**
   * Overrides the configured sender. Almost nothing should set this — the
   * whole point of `USAGE_EMAIL_FROM` is one verified sender identity.
   */
  from?: string
  /**
   * Short label for logs, e.g. `'invite'` or `'usage-summary'`. Makes a
   * failure in the runtime logs traceable to the feature that caused it.
   */
  context?: string
}

/**
 * Why a send did not happen. `unconfigured` and `no-recipient` mean nothing
 * was attempted; `rejected` and `network` mean Resend was called and failed.
 */
export type SendEmailFailureReason =
  | 'unconfigured'
  | 'no-recipient'
  | 'rejected'
  | 'network'

export type SendEmailResult =
  | { sent: true; id: string | null }
  | {
      sent: false
      reason: SendEmailFailureReason
      /** HTTP status, when Resend answered. */
      status?: number
      /** Resend's error body or the thrown message, trimmed for logs. */
      detail?: string
    }

export interface EmailConfig {
  apiKey: string | undefined
  from: string | undefined
}

/**
 * Reads the email environment.
 *
 * Deliberately read per call rather than captured at module load: these run
 * in serverless handlers where the module may be evaluated during a build,
 * long before the runtime env exists.
 */
export function getEmailConfig(): EmailConfig {
  return {
    apiKey: process.env.RESEND_API_KEY || undefined,
    from: process.env.USAGE_EMAIL_FROM || undefined,
  }
}

/**
 * True when both `RESEND_API_KEY` and `USAGE_EMAIL_FROM` are present.
 *
 * Callers that answer an HTTP request (rather than firing best-effort mail)
 * use this to return a 501 with an actionable message instead of pretending
 * to have sent something.
 */
export function isEmailConfigured(): boolean {
  const { apiKey, from } = getEmailConfig()
  return Boolean(apiKey && from)
}

function normalizeRecipients(to: string | string[]): string[] {
  const list = Array.isArray(to) ? to : [to]
  return list
    .map((address) => String(address ?? '').trim())
    .filter((address) => address.includes('@'))
}

/**
 * Sends one email through Resend.
 *
 * **Never throws and never rejects.** Outbound mail is best-effort across
 * every caller in this codebase — a checkout must not fail because a receipt
 * bounced — so every outcome comes back as a `SendEmailResult` instead. The
 * one thing callers must not do is ignore the result: `sent` is what tells
 * the user whether a message actually went out (AGL-708).
 *
 * When the env vars are missing this warns once per call and returns
 * `{ sent: false, reason: 'unconfigured' }` rather than failing, so local and
 * preview environments keep working without a Resend account.
 */
export async function sendEmail(
  options: SendEmailOptions,
): Promise<SendEmailResult> {
  const { apiKey, from: configuredFrom } = getEmailConfig()
  const from = options.from ?? configuredFrom
  const label = options.context ? `${options.context} email` : 'email'

  if (!apiKey || !from) {
    console.warn(
      `${label} skipped — set RESEND_API_KEY and USAGE_EMAIL_FROM to ` +
        'deliver mail',
    )
    return { sent: false, reason: 'unconfigured' }
  }

  const to = normalizeRecipients(options.to)
  if (!to.length) {
    console.warn(`${label} skipped — no valid recipient address`)
    return { sent: false, reason: 'no-recipient' }
  }

  try {
    const response = await fetch(RESEND_SEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to,
        subject: options.subject,
        ...(options.text ? { text: options.text } : {}),
        ...(options.html ? { html: options.html } : {}),
        ...(options.headers ? { headers: options.headers } : {}),
        ...(options.tags ? { tags: options.tags } : {}),
        ...(options.replyTo ? { reply_to: options.replyTo } : {}),
      }),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      console.error(`${label} failed`, response.status, detail)
      return {
        sent: false,
        reason: 'rejected',
        status: response.status,
        detail: detail.slice(0, 500),
      }
    }

    const body = (await response.json().catch(() => null)) as {
      id?: string
    } | null
    return { sent: true, id: body?.id ?? null }
  } catch (error) {
    console.error(`${label} failed`, error)
    return {
      sent: false,
      reason: 'network',
      detail: String((error as Error)?.message ?? error).slice(0, 500),
    }
  }
}

export default sendEmail
