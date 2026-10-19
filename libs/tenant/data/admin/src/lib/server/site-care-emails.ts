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

import { inboundMailDomain } from '@aglyn/aglyn/app-utils/inbound-mail-domain'
import { SITE_CARE_INBOUND_LOCAL_PART } from '@aglyn/aglyn/app-utils/site-care'
import { isEmailConfigured, sendEmail } from '@aglyn/shared-util-email'
import { meterPlatformEmail } from './email-metering'
import {
  renderSystemEmailContent,
  systemEmailBrand,
} from './render-system-email'

/**
 * SENDING THE SITE CARE EMAILS (AGL-3959).
 *
 * Every Site Care email is a catalog key (`site-care-emails.ts` in
 * `shared-util-email`), rendered in the WORKSPACE's brand — a white-label
 * agency's client hears from the agency — and sent from the platform's
 * address with a Reply-To that threads the answer onto the same request:
 * `care+<requestId>@<inbound mail domain>`. Metered as platform mail, like
 * the success manager's copy: this is the service the owner pays for, not
 * mail the workspace sent.
 *
 * Never throws. The caller records what it returns as the request's
 * `email.sent` history row, so whether an email went is a fact on the
 * request rather than an assumption.
 */

/** The address a request's emails reply to, so the answer joins it. */
export function siteCareReplyTo(requestId: string | null): string {
  const local = requestId ? `${SITE_CARE_INBOUND_LOCAL_PART}+${requestId}` : SITE_CARE_INBOUND_LOCAL_PART
  return `${local}@${inboundMailDomain()}`
}

export interface SiteCareEmailInput {
  key: string
  to: string | null
  /** The workspace whose brand the email is sent in; null is the platform's. */
  org: Readonly<Record<string, unknown>> | null
  requestId: string | null
  merge: Record<string, string>
  fallback: { subject: string; text: string }
}

export interface SiteCareEmailResult {
  sent: boolean
  to: string | null
  subject: string
  reason?: string
}

export async function sendSiteCareEmail(input: SiteCareEmailInput): Promise<SiteCareEmailResult> {
  const to = String(input.to ?? '').trim()
  if (!to) return { sent: false, to: null, subject: input.fallback.subject, reason: 'no-recipient' }
  if (!isEmailConfigured()) {
    return { sent: false, to, subject: input.fallback.subject, reason: 'unconfigured' }
  }
  try {
    const brand = systemEmailBrand(input.org)
    const content = await renderSystemEmailContent(
      input.key,
      { ...(brand.orgName ? { 'org.name': brand.orgName } : {}), ...input.merge },
      brand,
      input.fallback,
    )
    const result = await sendEmail({
      to,
      subject: content.subject,
      text: content.text,
      ...(content.html ? { html: content.html } : {}),
      ...(brand.fromName ? { fromName: brand.fromName } : {}),
      replyTo: siteCareReplyTo(input.requestId),
      context: input.key,
    })
    if (result.sent) await meterPlatformEmail()
    return result.sent
      ? { sent: true, to, subject: content.subject }
      : {
          sent: false,
          to,
          subject: content.subject,
          reason: String((result as { reason?: unknown }).reason ?? 'not-sent'),
        }
  } catch (error) {
    console.error(`[site-care] ${input.key} email failed`, error)
    return { sent: false, to, subject: input.fallback.subject, reason: 'error' }
  }
}
