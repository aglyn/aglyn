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

import { siteContactEmail, resolveHostToken, type HostTokenSource } from '@aglyn/aglyn/app-utils/host-tokens'
import { resolveBrandingProfile } from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  emailThreadAfterSend,
  isEmailConfigured,
  mintEmailMessageId,
  nextThreadHeaders,
  PLATFORM_EMAIL_PALETTE,
  readEmailThread,
  resolveEmailColor,
  sendEmail,
  type EmailTheme,
  type RenderedHostEmail,
  type SendEmailOptions,
  type SendEmailResult,
  type SendingIdentityVerdict,
} from '@aglyn/shared-util-email'
import {
  firebaseAdmin,
  hostSendingIdentity,
  meterHostEmail,
  renderHostEmailWithTokens,
  siteEmailFrame,
  transactionalAddressSuppression,
} from '@aglyn/tenant-data-admin'
import * as CommerceModel from '../model'
import { QUOTE_EMAIL_KEY, quoteEmailContent, type QuoteEmailColors } from '../utils/quote-email-content'
import type { quotePdfFile } from './commerce-pdf'
import type { CommercePdfFile } from './pdf-response'

/*==========================================
 * SENDING THE QUOTE EMAIL (AGL-4097). Loaded only by the console's Send
 * quote (`POST commerce/quote { action: 'send' }`), so the renderer, the PDF
 * writer and sharp stay out of every other request.
 *
 * One email, the `quote-sent` catalog key in the site's theme and its header
 * and footer (or the site's own design of it), with the quote's PDF attached:
 *
 *   - FROM the site's sending identity, under the site's name;
 *   - REPLY-TO the site's contact email (its listing's, else its support
 *     email), else the email of the person sending, so a reply reaches the
 *     business either way, as an inbox reply's does;
 *   - IN THE CUSTOMER'S CONVERSATION: a `Message-ID` minted on the sending
 *     domain, and, when the quote already has a conversation (an earlier
 *     send, or a request's confirmation), `In-Reply-To` and `References`
 *     from it, else the root of the one it starts in `References`
 *     (`nextThreadHeaders`). The provider's own id is returned beside ours,
 *     because a provider may replace a caller's `Message-ID` (in production
 *     one does), and a replaced one can then be traced;
 *   - METERED as a site's transactional email;
 *   - REFUSED only for an address that bounced for good or reported mail as
 *     spam (`transactionalAddressSuppression`): the customer asked for the
 *     quote, so an unsubscribe from the site's newsletter does not stop it,
 *     as it does not stop a receipt (AGL-4098).
 *
 * The route decides everything about the quote (who may send, the link, the
 * stage); this module only says the email and sends it.
 *=========================================*/

/** What the route hands over for one send. */
export interface QuoteDeliveryInput {
  hostId: string
  quoteId: string
  /** The quote as it stands, after any pay link replacement this send made. */
  order: CommerceModel.HostOrder
  host: Record<string, unknown>
  store: Record<string, unknown> | null
  owner: { id?: string; org?: unknown } | null
  to: string
  /** The subject as typed; empty takes the default. */
  subject: string
  message: string
  payUrl: string
  proofUrl: (proofId: string) => string | null
  linkReplaced: boolean
  /** The sending member's email: the Reply-To when the site has no contact email. */
  senderEmail: string | null
  atMs: number
}

export type QuoteDeliveryResult =
  | {
      sent: true
      messageId: string
      providerId: string | null
      subject: string
      replyTo: string | null
      thread: CommerceModel.QuoteEmailThread
    }
  | { sent: false; status: number; error: string }

/** The calls the send makes, injectable for specs. */
export interface QuoteMailerDeps {
  configured(): boolean
  sendingIdentity(hostId: string): Promise<SendingIdentityVerdict>
  render(hostId: string, key: string, tokens: Record<string, string>): Promise<RenderedHostEmail | null>
  /** The site's email theme, for the colors the composed proof markup draws with. */
  theme(hostId: string): Promise<EmailTheme | null>
  /** The quote's PDF; loads the PDF writer and sharp only here. */
  quotePdf(input: Parameters<typeof quotePdfFile>[0]): Promise<CommercePdfFile>
  send(options: SendEmailOptions): Promise<SendEmailResult>
  meter(hostId: string): Promise<void>
  /** The bounce and complaint list only: a quote is mail the customer asked for. */
  suppression(email: string): Promise<'suppressed-platform' | null>
}

export function defaultQuoteMailerDeps(): QuoteMailerDeps {
  const firestore = () => firebaseAdmin.app().firestore()
  return {
    configured: () => isEmailConfigured(),
    sendingIdentity: (hostId) => hostSendingIdentity(hostId),
    render: (hostId, key, tokens) => renderHostEmailWithTokens(firestore(), hostId, key, tokens),
    theme: async (hostId) => (await siteEmailFrame(firestore(), hostId, QUOTE_EMAIL_KEY)).theme,
    quotePdf: async (input) => (await import('./commerce-pdf')).quotePdfFile(input),
    send: (options) => sendEmail(options),
    meter: async (hostId) => {
      await meterHostEmail(hostId)
    },
    suppression: (email) => transactionalAddressSuppression(email),
  }
}

/** What the console's Send quote reaches: whether mail can go, whether this address may be mailed, and the send. */
export interface QuoteMailer {
  configured(): boolean
  suppression(email: string): Promise<'suppressed-platform' | null>
  deliver(input: QuoteDeliveryInput): Promise<QuoteDeliveryResult>
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The business's name as its documents print it. */
export function quoteBusinessName(host: Record<string, unknown>): string {
  const named = resolveHostToken('businessName', host as HostTokenSource)
  return String(named ?? '').trim() || String(host['name'] ?? '').trim()
}

/**
 * Who a reply reaches: the site's contact email, else the person sending, as
 * an inbox reply answers to them. Null only when neither is an address.
 */
export function quoteReplyTo(host: Record<string, unknown>, senderEmail: string | null | undefined): string | null {
  const contact = siteContactEmail(host as never)
  if (contact && EMAIL.test(contact)) return contact
  const sender = String(senderEmail ?? '').trim()
  return EMAIL.test(sender) ? sender : null
}

/** The theme's colors for the composed proof markup, the platform's where the site's cannot answer. */
function proofColors(theme: EmailTheme | null): QuoteEmailColors {
  const read = (token: string) =>
    resolveEmailColor(token, theme?.palette) ?? resolveEmailColor(token, PLATFORM_EMAIL_PALETTE) ?? 'inherit'
  return { border: read('divider'), muted: read('text.secondary') }
}

/** A refused send in the words the console shows. */
function refusalOf(result: Extract<SendEmailResult, { sent: false }>): { status: number; error: string } {
  switch (result.reason) {
    case 'unconfigured':
      return { status: 503, error: 'Email isn’t set up here, so the quote wasn’t sent.' }
    case 'rate-limited':
      return { status: 429, error: 'Too many emails are going out right now. Try again in a minute.' }
    case 'suppressed':
    case 'undeliverable':
      return { status: 409, error: 'This address can’t receive email, so the quote wasn’t sent. Copy the pay link and send it another way.' }
    case 'unverified-domain':
      return { status: 409, error: 'This site’s sending domain isn’t verified, so the quote wasn’t sent. Check Email settings.' }
    case 'suspended':
      return { status: 423, error: 'This site can’t send email right now, so the quote wasn’t sent.' }
    case 'held-for-review':
      return { status: 409, error: `The email was held for review, so it hasn’t gone out yet.${result.detail ? ` ${result.detail}` : ''}` }
    default:
      return { status: 502, error: 'The quote email could not be sent. Try again.' }
  }
}

/** The quote email, said and sent. */
export function quoteMailer(deps: QuoteMailerDeps = defaultQuoteMailerDeps()): QuoteMailer {
  return {
    configured: () => deps.configured(),
    suppression: (email) => deps.suppression(email),
    deliver: async (input) => {
      const { hostId, quoteId, order, host } = input
      const businessName = quoteBusinessName(host)
      const subject = input.subject || CommerceModel.quoteEmailDefaultSubject(order, businessName, quoteId)
      const [identity, theme] = await Promise.all([
        deps.sendingIdentity(hostId),
        deps.theme(hostId).catch(() => null),
      ])

      const content = quoteEmailContent({
        order,
        quoteId,
        businessName,
        currency: String(input.store?.['currency'] ?? 'USD'),
        subject,
        message: input.message,
        payUrl: input.payUrl,
        proofUrl: input.proofUrl,
        linkReplaced: input.linkReplaced,
        colors: proofColors(theme),
        radius: theme?.buttonRadius,
      })

      // The PDF is what the email says is attached; without it nothing goes.
      let pdf: CommercePdfFile
      try {
        pdf = await deps.quotePdf({
          hostId,
          quoteId,
          order,
          host,
          store: input.store,
          owner: input.owner,
          payUrl: input.payUrl,
        })
      } catch (error) {
        console.error('[commerce/quote-email] the PDF could not be made', { hostId, quoteId, error })
        return { sent: false, status: 500, error: 'The quote’s PDF could not be made, so nothing was sent. Try again.' }
      }

      const rendered = await deps.render(hostId, QUOTE_EMAIL_KEY, content.tokens)
      const thread = readEmailThread(order.quote?.emailThread)
      const siteHost = String(host['cname'] ?? '').trim() || null
      const messageId = mintEmailMessageId([identity?.domain, identity?.from, siteHost], {
        label: 'quote',
        atMs: input.atMs,
      })
      const replyTo = quoteReplyTo(host, input.senderEmail)

      const result = await deps.send({
        to: input.to,
        // The subject as sent, whatever a design's own says: it is what keeps
        // the conversation together, and it was typed for this send.
        subject,
        text: rendered?.text || content.text,
        ...(rendered?.html ? { html: rendered.html } : {}),
        headers: nextThreadHeaders(thread, messageId),
        ...(replyTo ? { replyTo } : {}),
        fromName: resolveBrandingProfile(input.owner?.org as never).fromName,
        sendingIdentity: identity,
        audience: 'tenant',
        context: 'quote',
        attachments: [
          {
            filename: pdf.filename,
            contentType: 'application/pdf',
            content: Buffer.from(pdf.bytes).toString('base64'),
          },
        ],
      })
      if (!result.sent) return { sent: false, ...refusalOf(result as Extract<SendEmailResult, { sent: false }>) }
      // Cost meter (AGL-1438), as every transactional site email.
      await deps.meter(hostId).catch((error) => console.error('[commerce/quote-email] not metered', error))
      return {
        sent: true,
        messageId,
        providerId: (result as Extract<SendEmailResult, { sent: true }>).id ?? null,
        subject,
        replyTo,
        thread: emailThreadAfterSend(thread, { messageId, subject }),
      }
    },
  }
}
