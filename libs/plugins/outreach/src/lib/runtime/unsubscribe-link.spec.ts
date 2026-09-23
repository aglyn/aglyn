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

import { signedLinkSignature } from '@aglyn/tenant-data-admin/server/email-unsubscribe-link'
import {
  mintOutreachUnsubscribeToken,
  OUTREACH_UNSUBSCRIBE_PATH,
  OUTREACH_UNSUBSCRIBE_PURPOSE,
  outreachListUnsubscribe,
  outreachUnsubscribeMailbox,
  outreachUnsubscribeUrl,
  readOutreachUnsubscribeToken,
} from './unsubscribe-link'

const SECRET = 'outreach-unsubscribe-spec-secret'
const TARGET = { orgId: 'org-1', enrollmentId: 'seq-1_contact-1' }

describe('the Outreach unsubscribe link (AGL-2981)', () => {
  it('names the organization and the enrollment, and nothing about the person', () => {
    const token = String(mintOutreachUnsubscribeToken(TARGET, SECRET))
    expect(readOutreachUnsubscribeToken(token, SECRET)).toEqual(TARGET)
    const payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'))
    expect(payload).toEqual({ v: 1, o: 'org-1', e: 'seq-1_contact-1' })
    expect(token).not.toContain('@')
  })

  it('refuses a token signed with another secret, for another purpose, or altered', () => {
    const token = String(mintOutreachUnsubscribeToken(TARGET, SECRET))
    const [payload, signature] = token.split('.')
    expect(readOutreachUnsubscribeToken(token, 'another-secret')).toBeNull()
    const otherPurpose = `${payload}.${signedLinkSignature('another-purpose', payload, SECRET)}`
    expect(readOutreachUnsubscribeToken(otherPurpose, SECRET)).toBeNull()
    const otherTarget = Buffer.from(JSON.stringify({ v: 1, o: 'org-2', e: 'seq-1_contact-1' })).toString('base64url')
    expect(readOutreachUnsubscribeToken(`${otherTarget}.${signature}`, SECRET)).toBeNull()
    for (const junk of ['', '.', 'abc', `${payload}.`, `.${signature}`, null, 42]) {
      expect(readOutreachUnsubscribeToken(junk, SECRET)).toBeNull()
    }
  })

  it('never expires: a token read years later still verifies', () => {
    // Nothing in the token dates it; only rotating the secret retires one.
    const token = String(mintOutreachUnsubscribeToken(TARGET, SECRET))
    jest.useFakeTimers({ now: Date.UTC(2031, 0, 1) })
    try {
      expect(readOutreachUnsubscribeToken(token, SECRET)).toEqual(TARGET)
    } finally {
      jest.useRealTimers()
    }
  })

  it('mints no token for ids that are not plain document ids, or without a secret', () => {
    expect(mintOutreachUnsubscribeToken({ orgId: 'org/1', enrollmentId: 'e' }, SECRET)).toBeNull()
    expect(mintOutreachUnsubscribeToken({ orgId: 'org-1', enrollmentId: '' }, SECRET)).toBeNull()
    expect(mintOutreachUnsubscribeToken(TARGET, '')).toBeNull()
  })

  it('is signed under Outreach’s own purpose', () => {
    const token = String(mintOutreachUnsubscribeToken(TARGET, SECRET))
    const [payload, signature] = token.split('.')
    expect(signature).toBe(signedLinkSignature(OUTREACH_UNSUBSCRIBE_PURPOSE, payload, SECRET))
  })

  it('builds the console link only on an HTTPS origin', () => {
    const url = String(outreachUnsubscribeUrl({ origin: 'https://app.example.com/', target: TARGET, secret: SECRET }))
    expect(url.startsWith(`https://app.example.com${OUTREACH_UNSUBSCRIBE_PATH}?t=`)).toBe(true)
    expect(OUTREACH_UNSUBSCRIBE_PATH).toBe('/api/outreach/unsubscribe')
    expect(readOutreachUnsubscribeToken(new URL(url).searchParams.get('t'), SECRET)).toEqual(TARGET)
    expect(outreachUnsubscribeUrl({ origin: 'http://localhost:4200', target: TARGET, secret: SECRET })).toBeNull()
    expect(outreachUnsubscribeUrl({ origin: '', target: TARGET, secret: SECRET })).toBeNull()
    expect(outreachUnsubscribeUrl({ origin: 'https://app.example.com', target: TARGET, secret: '' })).toBeNull()
  })

  it('writes the mailto to the account’s +unsubscribe subaddress', () => {
    expect(outreachUnsubscribeMailbox('Rep@Example.com')).toEqual({
      address: 'rep+unsubscribe@example.com',
      uri: 'mailto:rep+unsubscribe@example.com?subject=unsubscribe',
    })
    // An address that already carries a subaddress keeps its base.
    expect(outreachUnsubscribeMailbox('rep+sales@example.com')?.address).toBe('rep+unsubscribe@example.com')
    expect(outreachUnsubscribeMailbox('not-an-address')).toBeNull()
  })
})

describe('outreachListUnsubscribe (AGL-3296)', () => {
  const mintUrl = jest.fn(() => 'https://app.example.com/api/outreach/unsubscribe?t=abc')

  beforeEach(() => mintUrl.mockClear())

  it('is off, and mints nothing, unless the sequence stored it on', () => {
    for (const enabled of [false, undefined, null]) {
      expect(outreachListUnsubscribe({ enabled, mintUrl, mailboxEmail: 'rep@example.com' })).toEqual({ status: 'off' })
    }
    // Off is off even when no link could be minted: the send is not held.
    expect(outreachListUnsubscribe({ enabled: false, mintUrl: () => null, mailboxEmail: '' })).toEqual({ status: 'off' })
    expect(mintUrl).not.toHaveBeenCalled()
  })

  it('carries both halves when on', () => {
    expect(outreachListUnsubscribe({ enabled: true, mintUrl, mailboxEmail: 'rep@example.com' })).toEqual({
      status: 'ready',
      url: 'https://app.example.com/api/outreach/unsubscribe?t=abc',
      mailto: 'mailto:rep+unsubscribe@example.com?subject=unsubscribe',
    })
  })

  it('is unavailable when on and either half cannot be minted', () => {
    expect(outreachListUnsubscribe({ enabled: true, mintUrl: () => null, mailboxEmail: 'rep@example.com' })).toEqual({
      status: 'unavailable',
    })
    expect(outreachListUnsubscribe({ enabled: true, mintUrl, mailboxEmail: 'not-an-address' })).toEqual({
      status: 'unavailable',
    })
  })
})
