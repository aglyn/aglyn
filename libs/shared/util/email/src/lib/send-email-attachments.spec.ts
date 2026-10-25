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

import { mailWebhookBody } from './mail-provider-webhook'
import { resendSendPayload } from './mail-provider-resend'
import { checkEmailAttachments, EMAIL_ATTACHMENT_LIMITS } from './send-email'

/** Files carried with a message (AGL-4042): bounded, checked, and handed to each provider. */
describe('email attachments', () => {
  const pdf = { filename: 'signed-waiver.pdf', contentType: 'application/pdf', content: 'JVBERi0xLjQK' }

  it('passes a well-formed attachment through', () => {
    expect(checkEmailAttachments([pdf])).toEqual({ ok: true, attachments: [pdf] })
    expect(checkEmailAttachments(undefined)).toEqual({ ok: true, attachments: [] })
  })

  it('refuses a name with a path, a missing type, content that is not base64, and too many', () => {
    expect(checkEmailAttachments([{ ...pdf, filename: '../etc/passwd' }]).ok).toBe(false)
    expect(checkEmailAttachments([{ ...pdf, contentType: '' }]).ok).toBe(false)
    expect(checkEmailAttachments([{ ...pdf, content: 'not base64!' }]).ok).toBe(false)
    expect(checkEmailAttachments(Array(EMAIL_ATTACHMENT_LIMITS.count + 1).fill(pdf)).ok).toBe(false)
  })

  it('refuses attachments past the size bound', () => {
    const big = { ...pdf, content: 'A'.repeat(EMAIL_ATTACHMENT_LIMITS.totalBase64Chars + 4) }
    expect(checkEmailAttachments([big]).ok).toBe(false)
  })

  it('reaches Resend in its own field names, and the webhook as given', () => {
    const message = { from: 'Shop <hi@example.com>', to: ['ada@example.com'], subject: 'Signed', attachments: [pdf] }
    expect(resendSendPayload(message).attachments).toEqual([
      { filename: 'signed-waiver.pdf', content: 'JVBERi0xLjQK', content_type: 'application/pdf' },
    ])
    expect((mailWebhookBody(message).message as Record<string, unknown>).attachments).toEqual([pdf])
    expect(resendSendPayload({ ...message, attachments: [] })).not.toHaveProperty('attachments')
  })
})
