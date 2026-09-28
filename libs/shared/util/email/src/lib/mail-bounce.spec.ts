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

import { isMailGatewayBlock, readBounceText, scrubBounceDiagnostic } from './mail-bounce'

describe('readBounceText', () => {
  it('reads the status, the gateway’s server and the gateway out of a provider’s bounce sentence', () => {
    const text =
      "The recipient's email provider rejected the email. 550 5.7.1 <kristan@lifespire.example>: " +
      'Recipient address rejected: blocked by d78608a.ess.barracudanetworks.com (reputation)'
    expect(readBounceText(text)).toEqual({
      status: '5.7.1',
      diagnostic:
        "The recipient's email provider rejected the email. 550 5.7.1 <<address>>: Recipient address rejected: " +
        'blocked by d78608a.ess.barracudanetworks.com (reputation)',
      remoteMta: 'd78608a.ess.barracudanetworks.com',
      gateway: 'barracuda',
    })
  })

  it('falls back to a gateway named in words, and to a mail host that names none', () => {
    expect(readBounceText('554 5.7.1 Message blocked by Proofpoint policy')).toMatchObject({
      status: '5.7.1',
      remoteMta: null,
      gateway: 'proofpoint',
    })
    expect(readBounceText('550 5.1.1 mx1.acme.example said: no such user')).toMatchObject({
      status: '5.1.1',
      remoteMta: 'mx1.acme.example',
      gateway: null,
    })
    expect(readBounceText('')).toEqual({ status: null, diagnostic: null, remoteMta: null, gateway: null })
  })

  it('scrubs every address from a diagnostic before it is kept', () => {
    expect(scrubBounceDiagnostic('550 <a@b.example> and c.d@e.example refused')).toBe('550 <<address>> and <address> refused')
    expect(scrubBounceDiagnostic('   ')).toBeNull()
  })
})

describe('isMailGatewayBlock', () => {
  it('reads a policy refusal as a block on the sender, and an unknown address as the address', () => {
    expect(isMailGatewayBlock({ status: '5.7.1', diagnostic: 'blocked using Barracuda Reputation' })).toBe(true)
    expect(isMailGatewayBlock({ status: '5.7.1', diagnostic: null })).toBe(true)
    expect(isMailGatewayBlock({ status: '5.1.1', diagnostic: 'no such user' })).toBe(false)
    expect(isMailGatewayBlock({ status: '5.7.1', diagnostic: 'Recipient address rejected: User unknown' })).toBe(false)
    expect(isMailGatewayBlock(null)).toBe(false)
  })
})
