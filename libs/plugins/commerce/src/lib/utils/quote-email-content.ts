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

import {
  currentQuoteProofs,
  formatOrderMoney,
  formatQuoteNumber,
  quotePaymentBlockedByApproval,
  type HostOrder,
  type OrderQuote,
} from '../model'
import { escapeHtml } from './escape-html'

/*==========================================
 * WHAT THE QUOTE EMAIL SAYS (AGL-4097).
 *
 * The `quote-sent` catalog email's tokens, composed per send: its heading,
 * what this email is (a new quote, or an updated revision), the business's
 * own message, the quote's number, revision and total, up to three proof
 * images, the other proof files by name, what to do next and the button. The
 * next step and the button follow the business's approval control
 * (`quotePaymentBlockedByApproval`): while the customer must approve the
 * proof first, the button is "Review and approve"; otherwise it is "View and
 * pay" with the total. Both go to the quote's pay link, where the customer
 * does either.
 *
 * Prices appear only in the tokens the catalog names for them
 * (`quote.total`, `quote.buttonLabel`); the composed markup
 * (`quote.proofImages`) carries pictures and file names, nothing else.
 *
 * Pure: the send route and the sample renders call the same function.
 *=========================================*/

/** The catalog key the quote email is sent and designed under. */
export const QUOTE_EMAIL_KEY = 'quote-sent'

/** The most proof images drawn in the email; the rest are named. */
export const QUOTE_EMAIL_MAX_IMAGES = 3

/**
 * The column's inner width in the built-in copy: the 600px column less the
 * section's padding on each side.
 */
export const QUOTE_EMAIL_IMAGE_WIDTH = 552

/**
 * Pictures every inbox draws. WebP is left to the quote page, where it shows:
 * Outlook for Windows draws no WebP.
 */
const EMAIL_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif'])

/** The most file names listed before "and N more". */
const MAX_NAMED_FILES = 5

/** The theme's colors the composed markup draws with, resolved by the sender. */
export interface QuoteEmailColors {
  /** The images' outline: the theme's divider. */
  border: string
  /** The caption under each image: the theme's secondary text. */
  muted: string
}

export interface QuoteEmailContentInput {
  order: HostOrder
  quoteId: string
  businessName: string
  currency: string
  /** The subject the email goes under. */
  subject: string
  /** The business's message, as typed; may be empty. */
  message: string
  /** The quote's pay link, at the version this email carries. */
  payUrl: string
  /** A proof's address behind that link, or null when it has none. */
  proofUrl: (proofId: string) => string | null
  /** This email gives the customer a new pay link, and the earlier email's no longer opens the quote. */
  linkReplaced: boolean
  colors: QuoteEmailColors
  /** The theme's corner radius in px, for the images. */
  radius?: number
}

export interface QuoteEmailContent {
  /** The catalog email's merge tokens. */
  tokens: Record<string, string>
  /** The same email as plain text, for a send whose design cannot be rendered. */
  text: string
  /** The customer approves the proof before they can pay: the button reads "Review and approve". */
  approvalFirst: boolean
}

/** `a`, `a and b`, `a, b and c`. */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** The quote email's tokens and its plain-text twin. */
export function quoteEmailContent(input: QuoteEmailContentInput): QuoteEmailContent {
  const { order, businessName } = input
  const quote = (order.quote ?? {}) as OrderQuote
  const business = businessName.trim() || 'the business'
  const revision = Math.max(1, Math.floor(Number(quote.revision ?? 1)) || 1)
  const number = formatQuoteNumber(order, input.quoteId).replace(/^Quote\s+/, '')
  const taxAtPayment = quote.tax?.kind === 'at-payment'
  const money = formatOrderMoney(Number(order.totals?.totalCents ?? 0), input.currency)
  const total = taxAtPayment ? `${money} before tax` : money
  const approvalFirst = quotePaymentBlockedByApproval(quote)

  // The proofs: pictures an inbox draws, up to three, then every other file by name.
  const proofs = currentQuoteProofs(quote)
  const pictured: Array<{ name: string; url: string }> = []
  const named: string[] = []
  let morePictures = 0
  for (const proof of proofs) {
    const url = EMAIL_IMAGE_TYPES.has(String(proof.contentType ?? '').toLowerCase()) ? input.proofUrl(proof.id) : null
    if (url && pictured.length < QUOTE_EMAIL_MAX_IMAGES) pictured.push({ name: proof.name, url })
    else if (url) morePictures += 1
    else named.push(proof.name)
  }
  const listed = named.slice(0, MAX_NAMED_FILES)
  const overflow = named.length - listed.length + morePictures
  const parts = [...listed, ...(overflow > 0 ? [`${plural(overflow, 'more file', 'more files')}`] : [])]
  const lead = pictured.length ? 'Also with this revision' : named.length === 1 ? 'Proof' : 'Proofs'
  const seeIt = named.length + morePictures === 1 ? 'See it on your quote page.' : 'See them on your quote page.'
  const proofFiles = parts.length ? `${lead}: ${joinNames(parts)}. ${seeIt}` : ''

  const radius = Math.max(0, Math.round(Number(input.radius ?? 4)) || 0)
  const proofImages = proofImagesHtml(pictured, input.payUrl, input.colors, radius)

  const heading = revision >= 2 ? 'Your updated quote' : businessName.trim() ? `Your quote from ${businessName.trim()}` : 'Your quote'
  const intro =
    revision >= 2
      ? `${capitalize(business)} updated your quote. This is revision ${revision}, and it replaces the one sent before.` +
        (input.linkReplaced ? ' The link in the earlier email no longer opens the quote, so use the button below.' : '') +
        ' The new version is attached as a PDF.'
      : `${capitalize(business)} put together a quote for you. The details are below, and the quote is attached as a PDF.`

  const proofed = proofs.length > 0
  const approved = proofed && Number(quote.approvedRevision) === revision
  const nextStep = approvalFirst
    ? 'Look over the proof, then approve it on your quote page. Once you approve it, you can pay there.'
    : approved
      ? 'You approved the proof. Pay on your quote page whenever you’re ready.'
      : proofed
        ? 'Look over your quote and the proof. On your quote page you can approve the proof or ask for changes, and pay whenever you’re ready.'
        : 'Look over your quote, and pay it on your quote page whenever you’re ready.'
  const buttonLabel = approvalFirst ? 'Review and approve' : `View and pay ${money}${taxAtPayment ? ' plus tax' : ''}`
  const message = input.message.trim()

  const tokens: Record<string, string> = {
    'quote.subject': input.subject,
    'quote.number': number,
    'quote.revision': String(revision),
    'quote.total': total,
    'quote.heading': heading,
    'quote.intro': intro,
    'quote.message': message,
    'quote.proofImages': proofImages,
    'quote.proofFiles': proofFiles,
    'quote.nextStep': nextStep,
    'quote.buttonLabel': buttonLabel,
    'quote.url': input.payUrl,
  }

  const text = [
    heading,
    intro,
    message,
    `Quote: ${number}\nRevision: ${revision}\nTotal: ${total}`,
    pictured.length ? `Proof: ${joinNames(pictured.map((proof) => proof.name))}` : '',
    proofFiles,
    nextStep,
    `${buttonLabel}: ${input.payUrl}`,
    `Reply to this email to reach ${business}.`,
  ]
    .filter(Boolean)
    .join('\n\n')

  return { tokens, text, approvalFirst }
}

/** The space between two pictures side by side, in px. */
const IMAGE_GAP = 12

/**
 * The proof pictures, each linked to the quote page with its file name under
 * it: one across the column, or two or three side by side, so the button
 * stays near. A table, the layout every inbox keeps.
 */
function proofImagesHtml(
  pictured: ReadonlyArray<{ name: string; url: string }>,
  payUrl: string,
  colors: QuoteEmailColors,
  radius: number,
): string {
  if (!pictured.length) return ''
  const count = pictured.length
  const width = Math.floor((QUOTE_EMAIL_IMAGE_WIDTH - IMAGE_GAP * (count - 1)) / count)
  const cells = pictured.map((proof, index) => {
    const left = index === 0 ? 0 : IMAGE_GAP / 2
    const right = index === count - 1 ? 0 : IMAGE_GAP / 2
    return (
      `<td style="width:${Math.round(100 / count)}%;vertical-align:top;padding:4px ${right}px 12px ${left}px;">` +
      `<a href="${escapeHtml(payUrl)}">` +
      `<img src="${escapeHtml(proof.url)}" alt="${escapeHtml(`Proof: ${proof.name}`)}" width="${width}" ` +
      `style="display:block;width:100%;max-width:${width}px;height:auto;box-sizing:border-box;` +
      `border:1px solid ${colors.border};border-radius:${radius}px;" />` +
      `</a>` +
      `<div style="font-size:13px;line-height:1.4;color:${colors.muted};padding-top:6px;word-break:break-word;">${escapeHtml(proof.name)}</div>` +
      `</td>`
    )
  })
  return (
    `<table role="presentation" style="width:100%;border-collapse:collapse;">` +
    `<tr>${cells.join('')}</tr>` +
    `</table>`
  )
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value
}
