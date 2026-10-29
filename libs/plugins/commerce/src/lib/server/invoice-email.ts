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

import { resolveSiteTimeZone } from '@aglyn/aglyn/app-utils/collection-entry-date'
import { resolveBrandingProfile } from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  emailThreadAfterSend,
  isEmailConfigured,
  mintEmailMessageId,
  nextThreadHeaders,
  readEmailThread,
  sendEmail,
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
  transactionalAddressSuppression,
} from '@aglyn/tenant-data-admin'
import * as CommerceModel from '../model'
import { INVOICE_EMAIL_KEY, invoiceEmailContent } from '../utils/invoice-email-content'
import type { orderInvoicePdfFile } from './commerce-pdf'
import type { CommercePdfFile } from './pdf-response'
import { quoteBusinessName, quoteReplyTo } from './quote-email'

/*==========================================
 * SENDING THE INVOICE EMAIL (AGL-4099). Loaded only by the console's Send
 * invoice (`POST commerce/order-invoice-send`), so the renderer, the PDF
 * writer and sharp stay out of every other request.
 *
 * One email, the `order-invoice` catalog key in the site's theme and its
 * header and footer (or the site's own design of it), with the invoice's PDF
 * attached, sent as the quote email is (`quote-email.ts`):
 *
 *   - FROM the site's sending identity, under the site's name;
 *   - REPLY-TO the site's contact email, else the person sending;
 *   - IN THE CUSTOMER'S CONVERSATION: a quote's invoice replies into the
 *     quote's conversation (`quote.emailThread`: its emails, or a request's
 *     confirmation before them), and any other order's into its own
 *     (`emailThread`), which its first invoice starts;
 *   - METERED as a site's transactional email;
 *   - REFUSED only for an address that bounced for good or reported mail as
 *     spam: an invoice is transactional, as a receipt is.
 *
 * The route decides everything about the order (who may send, the link,
 * whether it can be paid); this module only says the email and sends it.
 *=========================================*/

/** What the route hands over for one send. */
export interface InvoiceDeliveryInput {
  hostId: string
  orderId: string
  order: CommerceModel.HostOrder
  host: Record<string, unknown>
  store: Record<string, unknown> | null
  owner: { id?: string; org?: unknown } | null
  to: string
  /** The subject as typed; empty takes the default. */
  subject: string
  message: string
  /** The order's pay link, for an invoice still to be paid; null for a paid one. */
  payUrl: string | null
  /** The sending member's email: the Reply-To when the site has no contact email. */
  senderEmail: string | null
  atMs: number
}

export type InvoiceDeliveryResult =
  | {
      sent: true
      messageId: string
      providerId: string | null
      subject: string
      replyTo: string | null
      thread: CommerceModel.QuoteEmailThread
      paid: boolean
      totalCents: number
    }
  | { sent: false; status: number; error: string }

/** The calls the send makes, injectable for specs. */
export interface InvoiceMailerDeps {
  configured(): boolean
  sendingIdentity(hostId: string): Promise<SendingIdentityVerdict>
  render(hostId: string, key: string, tokens: Record<string, string>): Promise<RenderedHostEmail | null>
  /** The invoice's PDF; loads the PDF writer and sharp only here. */
  invoicePdf(input: Parameters<typeof orderInvoicePdfFile>[0]): Promise<CommercePdfFile>
  send(options: SendEmailOptions): Promise<SendEmailResult>
  meter(hostId: string): Promise<void>
  /** The bounce and complaint list only: an invoice is transactional. */
  suppression(email: string): Promise<'suppressed-platform' | null>
}

export function defaultInvoiceMailerDeps(): InvoiceMailerDeps {
  const firestore = () => firebaseAdmin.app().firestore()
  return {
    configured: () => isEmailConfigured(),
    sendingIdentity: (hostId) => hostSendingIdentity(hostId),
    render: (hostId, key, tokens) => renderHostEmailWithTokens(firestore(), hostId, key, tokens),
    invoicePdf: async (input) => (await import('./commerce-pdf')).orderInvoicePdfFile(input),
    send: (options) => sendEmail(options),
    meter: async (hostId) => {
      await meterHostEmail(hostId)
    },
    suppression: (email) => transactionalAddressSuppression(email),
  }
}

/** What the console's Send invoice reaches: whether mail can go, whether this address may be mailed, and the send. */
export interface InvoiceMailer {
  configured(): boolean
  suppression(email: string): Promise<'suppressed-platform' | null>
  deliver(input: InvoiceDeliveryInput): Promise<InvoiceDeliveryResult>
}

/** A refused send in the words the console shows. */
function refusalOf(result: Extract<SendEmailResult, { sent: false }>): { status: number; error: string } {
  switch (result.reason) {
    case 'unconfigured':
      return { status: 503, error: 'Email isn’t set up here, so the invoice wasn’t sent.' }
    case 'rate-limited':
      return { status: 429, error: 'Too many emails are going out right now. Try again in a minute.' }
    case 'suppressed':
    case 'undeliverable':
      return { status: 409, error: 'This address can’t receive email, so the invoice wasn’t sent.' }
    case 'unverified-domain':
      return { status: 409, error: 'This site’s sending domain isn’t verified, so the invoice wasn’t sent. Check Email settings.' }
    case 'suspended':
      return { status: 423, error: 'This site can’t send email right now, so the invoice wasn’t sent.' }
    case 'held-for-review':
      return { status: 409, error: `The email was held for review, so it hasn’t gone out yet.${result.detail ? ` ${result.detail}` : ''}` }
    default:
      return { status: 502, error: 'The invoice email could not be sent. Try again.' }
  }
}

/** The invoice email, said and sent. */
export function invoiceMailer(deps: InvoiceMailerDeps = defaultInvoiceMailerDeps()): InvoiceMailer {
  return {
    configured: () => deps.configured(),
    suppression: (email) => deps.suppression(email),
    deliver: async (input) => {
      const { hostId, orderId, order, host } = input
      const businessName = quoteBusinessName(host)
      const subject = input.subject || CommerceModel.invoiceEmailDefaultSubject(order, businessName, orderId)
      const identity = await deps.sendingIdentity(hostId)
      const org = (input.owner?.org ?? null) as { timeZone?: string } | null
      const content = invoiceEmailContent({
        order,
        orderId,
        businessName,
        currency: String(input.store?.['currency'] ?? 'USD'),
        subject,
        message: input.message,
        payUrl: input.payUrl,
        timeZone: resolveSiteTimeZone(org, host as { timeZone?: string }),
      })

      // The PDF is what the email says is attached; without it nothing goes.
      let pdf: CommercePdfFile
      try {
        pdf = await deps.invoicePdf({
          hostId,
          orderId,
          order,
          host,
          store: input.store,
          owner: input.owner,
          payUrl: content.paid ? null : input.payUrl,
        })
      } catch (error) {
        console.error('[commerce/invoice-email] the PDF could not be made', { hostId, orderId, error })
        return { sent: false, status: 500, error: 'The invoice’s PDF could not be made, so nothing was sent. Try again.' }
      }

      const rendered = await deps.render(hostId, INVOICE_EMAIL_KEY, content.tokens)
      const thread = readEmailThread(CommerceModel.invoiceEmailThread(order))
      const siteHost = String(host['cname'] ?? '').trim() || null
      const messageId = mintEmailMessageId([identity?.domain, identity?.from, siteHost], {
        label: 'invoice',
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
        context: 'invoice',
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
      await deps.meter(hostId).catch((error) => console.error('[commerce/invoice-email] not metered', error))
      return {
        sent: true,
        messageId,
        providerId: (result as Extract<SendEmailResult, { sent: true }>).id ?? null,
        subject,
        replyTo,
        thread: emailThreadAfterSend(thread, { messageId, subject }),
        paid: content.paid,
        totalCents: content.totalCents,
      }
    },
  }
}
