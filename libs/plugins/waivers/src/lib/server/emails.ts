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

import { resolveBrandingProfile } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { isEmailConfigured, sendEmail, type EmailAttachment } from '@aglyn/shared-util-email'
import { hostSendingIdentity, meterHostEmail, renderHostEmailWithTokens } from '@aglyn/tenant-data-admin'
import { WAIVERS_EMAIL_KEYS } from '../constants/bundle-common'
import { signatureWindowLabel, type StoredWaiverSignature } from '../model/waiver-signature'
import { waiversDb } from './db'
import { formatInstant, signatureNames, signaturePdf, signaturePdfFilename } from './documents'

/**
 * The signer's copy (AGL-4042): the `waiver-signed` catalog email, designed
 * in the Besigner in the site's theme, with a plain-text fallback for a site
 * that never designed one, and the signed PDF attached. Owed to the signer
 * for what they just did, so it is transactional and always sent when they
 * gave an address. A send never fails the signing: the signature is stored.
 */

export interface WaiverEmail {
  hostId: string
  org: Record<string, unknown> | null
  to: string
  tokens: Record<string, string>
  fallback: { subject: string; text: string }
  attachment: EmailAttachment
}

type Sender = (email: WaiverEmail) => Promise<boolean>

let senderOverride: Sender | null = null

/** Test seam: records what would be sent. */
export function setWaiversEmailSenderForTests(sender: Sender | null): void {
  senderOverride = sender
}

/**
 * How a signer reaches the business, as the signed-copy email says it
 * (AGL-4042): the e-sign consent promises a paper copy, a changed email or a
 * withdrawal by contacting the business, so the copy repeats how.
 */
export function waiverContactSentence(businessName: string, contact: string | null | undefined): string {
  const reach = String(contact ?? '').trim()
  return reach ? `Contact ${businessName} at ${reach}.` : `Contact ${businessName}.`
}

export function signedCopyEmail(input: {
  signature: StoredWaiverSignature
  org: Record<string, unknown> | null
  businessName: string
  /** The business's contact email or phone, as the signing page showed it. */
  contact?: string | null
}): WaiverEmail | null {
  const { signature } = input
  const to = signature.signer?.email
  if (!to) return null
  const tokens = {
    name: signature.signer.name,
    'waiver.title': signature.waiverTitle,
    'waiver.signedAt': formatInstant(signature.signedAtMs, signature.timeZone),
    'waiver.people': signatureNames(signature).join(', '),
    'waiver.validity': signatureWindowLabel(signature),
    'waiver.contact': waiverContactSentence(input.businessName, input.contact),
  }
  const bytes = signaturePdf(signature, input.businessName)
  return {
    hostId: signature.hostId,
    org: input.org,
    to,
    tokens,
    fallback: {
      subject: `Your signed waiver for ${input.businessName}`,
      text: [
        `Thanks, ${tokens.name}. You signed ${tokens['waiver.title']} for ${input.businessName}. Your signed copy is attached as a PDF.`,
        `Signed: ${tokens['waiver.signedAt']}\nCovers: ${tokens['waiver.people']}\n${tokens['waiver.validity']}`,
        'You don’t need to print it: staff can find your waiver by name when you arrive.',
        `You can ask ${input.businessName} for a paper copy at no charge, change the email address for your copy, or withdraw your agreement to sign electronically for anything not yet sent to you. Withdrawing doesn’t undo the signature you gave. ${tokens['waiver.contact']}`,
      ].join('\n\n'),
    },
    attachment: {
      filename: signaturePdfFilename(signature),
      contentType: 'application/pdf',
      content: Buffer.from(bytes).toString('base64'),
    },
  }
}

export async function sendWaiverEmail(email: WaiverEmail): Promise<boolean> {
  if (senderOverride) return senderOverride(email)
  if (!email.to || !isEmailConfigured()) return false
  try {
    const designed = await renderHostEmailWithTokens(
      waiversDb() as never,
      email.hostId,
      WAIVERS_EMAIL_KEYS.signed,
      email.tokens,
    )
    const outcome = await sendEmail({
      to: email.to,
      subject: designed?.subject ?? email.fallback.subject,
      text: designed?.text || email.fallback.text,
      ...(designed?.html ? { html: designed.html } : {}),
      fromName: resolveBrandingProfile(email.org as never).fromName,
      sendingIdentity: await hostSendingIdentity(email.hostId),
      audience: 'tenant',
      context: 'waivers',
      owedFor: 'booking',
      attachments: [email.attachment],
    })
    if (outcome && (outcome as { sent?: boolean }).sent === false) return false
    await meterHostEmail(email.hostId)
    return true
  } catch (error) {
    console.error('[waivers] signed copy not sent', email.hostId, error)
    return false
  }
}
