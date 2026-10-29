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

import { resolveHostToken, siteContactEmail, type HostTokenSource } from '@aglyn/aglyn/app-utils/host-tokens'
import { resolveBrandingProfile } from '@aglyn/aglyn/app-utils/plan-entitlements'
import type { FormFieldDecl, FormRequest } from '@aglyn/aglyn/app-utils/forms'
import {
  emailThreadAfterSend,
  isEmailConfigured,
  mintEmailMessageId,
  nextThreadHeaders,
  sendEmail,
  type EmailThread,
  type RenderedHostEmail,
  type SendEmailOptions,
  type SendEmailResult,
  type SendingIdentityVerdict,
} from '@aglyn/shared-util-email'
import {
  consumeRateLimit,
  emailSuppressionKey,
  firebaseAdmin,
  hostSendingIdentity,
  meterHostEmail,
  renderHostEmailWithTokens,
  transactionalAddressSuppression,
} from '@aglyn/tenant-data-admin'
import { FORM_CONFIRMATION_EMAIL_KEY } from '../tenant-emails'
import { formConfirmationContent } from '../utils/form-confirmation-content'

/*==========================================
 * THE CONFIRMATION A FORM EMAILS THE PERSON WHO SENT IT (AGL-4098).
 *
 * Loaded only by the submit route, and only for a form set to "Email the
 * person a confirmation" whose submission named an address, so the renderer
 * stays out of every other submission.
 *
 * One email, the `form-confirmation` catalog key in the site's theme and its
 * header and footer (or the site's own design of it):
 *
 *   - FROM the site's sending identity, under the site's name;
 *   - REPLY-TO the site's contact email (its listing's, else its support
 *     email), so a reply reaches the business; none when the site has none;
 *   - STARTING A CONVERSATION: a `Message-ID` minted on the sending domain
 *     and the conversation's root in `References` (`nextThreadHeaders`),
 *     answered as the thread the submission keeps (`emailThread`), so a
 *     quote started from the request later replies into it;
 *   - TRANSACTIONAL: the person asked for it by sending the form, so only an
 *     address that bounced for good or reported mail as spam is refused
 *     (`transactionalAddressSuppression`), never one that unsubscribed from
 *     the site's newsletter;
 *   - LIMITED: three confirmations an hour to one address from one site, and
 *     three hundred an hour from one site, so a form cannot be used to flood
 *     somebody else's inbox with a site's mail. Whoever sends a form types
 *     the address, so the answers are echoed with their links taken out
 *     (`form-confirmation-content.ts`), and the send is not declared owed:
 *     the outbound screen judges it like any mail the site writes;
 *   - METERED as a site's transactional email.
 *
 * Never throws and never fails the submission: the submission is stored
 * before this runs, and a confirmation that could not go is logged.
 *=========================================*/

/** Confirmations one address may be sent by one site, per hour. */
export const FORM_CONFIRMATIONS_PER_ADDRESS = { limit: 3, windowMs: 60 * 60_000 }
/** Confirmations one site may send, per hour. */
export const FORM_CONFIRMATIONS_PER_SITE = { limit: 300, windowMs: 60 * 60_000 }

export interface FormConfirmationInput {
  hostId: string
  host: Record<string, unknown>
  org: unknown
  to: string
  formName: string
  request: FormRequest | null
  answers: Readonly<Record<string, string>>
  decls: readonly FormFieldDecl[]
  consentFieldName: string | null
  fileNames: readonly string[]
  atMs: number
}

export type FormConfirmationResult =
  | { sent: true; messageId: string; providerId: string | null; subject: string; thread: EmailThread }
  | { sent: false; reason: string }

export interface FormConfirmationDeps {
  configured(): boolean
  sendingIdentity(hostId: string): Promise<SendingIdentityVerdict>
  render(hostId: string, key: string, tokens: Record<string, string>): Promise<RenderedHostEmail | null>
  send(options: SendEmailOptions): Promise<SendEmailResult>
  meter(hostId: string): Promise<void>
  /** The bounce and complaint list only: the person asked for this email. */
  suppression(email: string): Promise<'suppressed-platform' | null>
  consumeRateLimit(key: string, options: { limit: number; windowMs: number }): Promise<{ allowed: boolean }>
}

export function defaultFormConfirmationDeps(): FormConfirmationDeps {
  return {
    configured: () => isEmailConfigured(),
    sendingIdentity: (hostId) => hostSendingIdentity(hostId),
    render: (hostId, key, tokens) =>
      renderHostEmailWithTokens(firebaseAdmin.app().firestore(), hostId, key, tokens),
    send: (options) => sendEmail(options),
    meter: async (hostId) => {
      await meterHostEmail(hostId)
    },
    suppression: (email) => transactionalAddressSuppression(email),
    consumeRateLimit: (key, options) => consumeRateLimit(key, options),
  }
}

/** The business's name as its emails print it. */
export function formBusinessName(host: Record<string, unknown>): string {
  const named = resolveHostToken('businessName', host as HostTokenSource)
  return String(named ?? '').trim() || String(host['displayName'] ?? host['name'] ?? '').trim()
}

/** The phone the site's listing gives, or null. */
function listedPhone(host: Record<string, unknown>): string | null {
  const entity = ((host['seo'] as Record<string, unknown> | undefined)?.['entity'] ?? null) as Record<string, unknown> | null
  const phone = typeof entity?.['telephone'] === 'string' ? entity['telephone'].trim().slice(0, 40) : ''
  return phone || null
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Sends one form's confirmation; never throws. */
export async function sendFormConfirmation(
  input: FormConfirmationInput,
  deps: FormConfirmationDeps = defaultFormConfirmationDeps(),
): Promise<FormConfirmationResult> {
  try {
    const to = input.to.trim()
    if (!EMAIL.test(to)) return { sent: false, reason: 'no-address' }
    if (!deps.configured()) return { sent: false, reason: 'unconfigured' }
    if (await deps.suppression(to)) return { sent: false, reason: 'suppressed' }
    const recipientKey = emailSuppressionKey(to) ?? to.toLowerCase()
    for (const [key, rate] of [
      [`form-confirmation:${input.hostId}:${recipientKey}`, FORM_CONFIRMATIONS_PER_ADDRESS],
      [`form-confirmation-site:${input.hostId}`, FORM_CONFIRMATIONS_PER_SITE],
    ] as const) {
      if (!(await deps.consumeRateLimit(key, rate)).allowed) return { sent: false, reason: 'rate-limited' }
    }

    const businessName = formBusinessName(input.host)
    const contact = siteContactEmail(input.host as never)
    const content = formConfirmationContent({
      businessName,
      formName: input.formName,
      request: input.request,
      answers: input.answers,
      decls: input.decls,
      consentFieldName: input.consentFieldName,
      fileNames: input.fileNames,
      contactEmail: contact && EMAIL.test(contact) ? contact : null,
      contactPhone: listedPhone(input.host),
    })
    const identity = await deps.sendingIdentity(input.hostId)
    const rendered = await deps.render(input.hostId, FORM_CONFIRMATION_EMAIL_KEY, content.tokens)
    const siteHost = String(input.host['cname'] ?? '').trim() || null
    // The first message of the conversation: its own id, and the root every
    // later message shares in `References`.
    const messageId = mintEmailMessageId([identity?.domain, identity?.from, siteHost], {
      label: 'form',
      atMs: input.atMs,
    })
    const subject = rendered?.subject?.trim() || content.subject
    const result = await deps.send({
      to,
      subject,
      text: rendered?.text || content.text,
      ...(rendered?.html ? { html: rendered.html } : {}),
      headers: nextThreadHeaders(null, messageId),
      ...(contact && EMAIL.test(contact) ? { replyTo: contact } : {}),
      fromName: resolveBrandingProfile(input.org as never).fromName,
      sendingIdentity: identity,
      audience: 'tenant',
      context: 'form confirmation',
      // Not declared owed: its answers were typed by whoever sent the form,
      // so the outbound screen judges it as fully as a merchant's own mail.
    })
    if (!result.sent) {
      return { sent: false, reason: String((result as { reason?: string }).reason ?? 'not-sent') }
    }
    // Cost meter (AGL-1438), as every transactional site email.
    await deps.meter(input.hostId).catch((error) => console.error('[forms] confirmation not metered', error))
    return {
      sent: true,
      messageId,
      providerId: (result as Extract<SendEmailResult, { sent: true }>).id ?? null,
      subject,
      thread: emailThreadAfterSend(null, { messageId, subject }),
    }
  } catch (error) {
    console.error('[forms] confirmation failed', { hostId: input.hostId, error })
    return { sent: false, reason: 'error' }
  }
}
