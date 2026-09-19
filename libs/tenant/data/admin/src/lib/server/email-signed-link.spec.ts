/**
 * @jest-environment node
 *
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
  confirmSignature,
  signedLinkSignature,
  signedLinkSignatureMatches,
  unsubscribeSignature,
} from './email-unsubscribe-link'

const SECRET = 'a-secret-only-this-spec-knows'

describe('a signed link of a sender’s own (AGL-2981)', () => {
  it('verifies the payload it signed, for the purpose it signed it under', () => {
    const signature = signedLinkSignature('mail-unsubscribe', '{"o":"org-1","e":"enr-1"}', SECRET)
    expect(signature).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(
      signedLinkSignatureMatches({
        purpose: 'mail-unsubscribe',
        payload: '{"o":"org-1","e":"enr-1"}',
        signature,
        secret: SECRET,
      }),
    ).toBe(true)
  })

  it('refuses a changed payload, another purpose, another secret and a truncated signature', () => {
    const payload = '{"o":"org-1","e":"enr-1"}'
    const signature = signedLinkSignature('mail-unsubscribe', payload, SECRET)
    const matches = (overrides: Partial<{ purpose: string; payload: string; signature: string; secret: string }>) =>
      signedLinkSignatureMatches({ purpose: 'mail-unsubscribe', payload, signature, secret: SECRET, ...overrides })
    expect(matches({ payload: '{"o":"org-2","e":"enr-1"}' })).toBe(false)
    expect(matches({ purpose: 'mail-preferences' })).toBe(false)
    expect(matches({ secret: 'another-secret' })).toBe(false)
    expect(matches({ signature: signature.slice(0, -1) })).toBe(false)
    expect(matches({ signature: '' })).toBe(false)
  })

  it('is a different key from the platform’s own forms, whatever the payload spells', () => {
    // A payload spelled exactly like a platform subject still signs with the
    // purpose's key, so neither signature can stand in for the other.
    const hostEmail = 'host-1:pat@example.com'
    expect(signedLinkSignature('unsubscribe', hostEmail, SECRET)).not.toBe(
      Buffer.from(unsubscribeSignature('host-1', 'pat@example.com', SECRET), 'hex').toString('base64url'),
    )
    const confirm = confirmSignature('host-1', 'pat@example.com', 'sales', SECRET)
    expect(
      signedLinkSignatureMatches({
        purpose: 'confirm',
        payload: 'confirm:host-1:pat@example.com:sales',
        signature: Buffer.from(confirm, 'hex').toString('base64url'),
        secret: SECRET,
      }),
    ).toBe(false)
  })

  it('signs nothing without a secret, a purpose or a payload', () => {
    expect(signedLinkSignature('mail-unsubscribe', 'payload', '')).toBe('')
    expect(signedLinkSignature(' ', 'payload', SECRET)).toBe('')
    expect(signedLinkSignature('mail-unsubscribe', '', SECRET)).toBe('')
    expect(
      signedLinkSignatureMatches({ purpose: 'mail-unsubscribe', payload: 'p', signature: '', secret: '' }),
    ).toBe(false)
  })

  it('reads the deployment’s secret when none is passed', () => {
    const previous = { unsub: process.env['EMAIL_UNSUBSCRIBE_SECRET'], cron: process.env['CRON_SECRET'] }
    process.env['EMAIL_UNSUBSCRIBE_SECRET'] = SECRET
    try {
      const signature = signedLinkSignature('mail-unsubscribe', 'payload')
      expect(signature).toBe(signedLinkSignature('mail-unsubscribe', 'payload', SECRET))
      expect(signedLinkSignatureMatches({ purpose: 'mail-unsubscribe', payload: 'payload', signature })).toBe(true)
    } finally {
      if (previous.unsub === undefined) delete process.env['EMAIL_UNSUBSCRIBE_SECRET']
      else process.env['EMAIL_UNSUBSCRIBE_SECRET'] = previous.unsub
      if (previous.cron === undefined) delete process.env['CRON_SECRET']
      else process.env['CRON_SECRET'] = previous.cron
    }
  })
})
