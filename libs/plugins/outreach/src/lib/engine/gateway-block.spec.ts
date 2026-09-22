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
 *
 * @jest-environment node
 */

import { isOutreachGatewayBlock, outreachGatewayBlockDetail } from './gateway-block'

const block = (diagnostic: string | null, status: string | null = null) =>
  isOutreachGatewayBlock({ status, diagnostic })

describe('isOutreachGatewayBlock (AGL-3244)', () => {
  it('reads a gateway refusing the sender as a block on the domain', () => {
    // The Barracuda that started this, as Gmail relayed it.
    expect(
      block('550 permanent failure for one or more recipients (morgan@kcorp.kendal.org:blocked)', '5.0.0'),
    ).toBe(true)
    expect(block('550 5.7.1 Service unavailable; Client host [203.0.113.7] blocked using Barracuda Reputation')).toBe(true)
    expect(block('554 5.7.1 [P4] Message blocked due to spam content in the message. Proofpoint')).toBe(true)
    expect(block('550 Rejected by header based Anti-Spoofing policy - mimecast.com/anti-spoofing')).toBe(true)
    expect(block('550 5.7.1 Message rejected due to recipient domain policy', '5.7.1')).toBe(true)
    expect(block('554 5.7.1 Service unavailable; Client host blocked using zen.spamhaus.org')).toBe(true)
    expect(block('550 5.7.1 Sender IP has poor reputation')).toBe(true)
  })

  it('reads a bare 5.7.0 or 5.7.1 with no address wording as a block too', () => {
    expect(block(null, '5.7.1')).toBe(true)
    expect(block('550 5.7.0 Delivery not authorized')).toBe(true)
  })

  it('keeps an unknown address an address problem, whatever else the server said', () => {
    expect(block('550 5.1.1 The email account that you tried to reach does not exist.', '5.1.1')).toBe(false)
    expect(block('550 5.1.10 RESOLVER.ADR.RecipientNotFound; Recipient riley@example.net not found', '5.1.10')).toBe(false)
    expect(block('550 5.1.1 <person@example.org>: no such user')).toBe(false)
    expect(block('550 Unknown user')).toBe(false)
    expect(block('550 5.2.1 Mailbox disabled')).toBe(false)
    expect(block('550 5.7.1 Recipient address rejected: User unknown in virtual mailbox table')).toBe(false)
    expect(block('550 5.7.1 policy: the mailbox does not exist')).toBe(false)
  })

  it('reads nothing into nothing', () => {
    expect(isOutreachGatewayBlock(null)).toBe(false)
    expect(block(null, null)).toBe(false)
    expect(block('550 5.0.0 Something else entirely', '5.0.0')).toBe(false)
  })
})

describe('outreachGatewayBlockDetail', () => {
  it('says the domain was blocked and is on the list, then what the server said', () => {
    expect(outreachGatewayBlockDetail('kcorp.kendal.org', '550 permanent failure (the address:blocked)')).toBe(
      "The mail gateway at kcorp.kendal.org blocked the email, so kcorp.kendal.org is on your organization's " +
        'do-not-contact list and no address there will be emailed. The server said: 550 permanent failure (the address:blocked)',
    )
    expect(outreachGatewayBlockDetail('example.net', null)).toMatch(/no address there will be emailed\.$/)
  })
})
