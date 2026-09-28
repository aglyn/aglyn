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
  googleMailboxSenderExpectation,
  resendSenderExpectation,
  type SenderReadinessExpectation,
} from '@aglyn/shared-util-email'
import {
  readSenderReadiness,
  resetSenderReadinessMemoryForTests,
  SENDER_READINESS_MEMORY_MS,
  type SenderReadinessTxtLookup,
} from './sender-readiness'

const NOW = Date.parse('2026-09-28T15:00:00Z')
const KEY = 'v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEB'

/** A zone as TXT answers by name; a name mapped to `null` goes unanswered. */
function zone(records: Record<string, string[] | null>) {
  const asked: string[] = []
  const lookup: SenderReadinessTxtLookup = async (host) => {
    asked.push(host)
    const answer = records[host]
    return answer === null ? { answered: false, records: [] } : { answered: true, records: answer ?? [] }
  }
  return { lookup, asked }
}

const workspace = googleMailboxSenderExpectation('rep@acme.com') as SenderReadinessExpectation

beforeEach(() => resetSenderReadinessMemoryForTests())

describe('readSenderReadiness', () => {
  it('asks SPF at the envelope, the provider’s selector and DMARC at the From domain', async () => {
    const { lookup, asked } = zone({
      'send.acme.com': ['v=spf1 include:amazonses.com ~all'],
      's1._domainkey.acme.com': [KEY],
      '_dmarc.acme.com': ['v=DMARC1; p=reject; rua=mailto:d@acme.com'],
    })
    const expectation = resendSenderExpectation({ domain: 'acme.com', dkimSelector: 's1' }) as SenderReadinessExpectation
    const readiness = await readSenderReadiness(expectation, {}, { lookupTxt: lookup, nowMs: NOW })
    expect(asked.sort()).toEqual(['_dmarc.acme.com', 's1._domainkey.acme.com', 'send.acme.com'])
    expect(readiness.overall).toBe('pass')
    expect(readiness.alignment.dkimAligned).toBe(true)
  })

  it('asks the organizational domain only for a subdomain that publishes no policy of its own', async () => {
    const { lookup, asked } = zone({
      'mail.acme.com': ['v=spf1 include:_spf.google.com -all'],
      'google._domainkey.mail.acme.com': [KEY],
      '_dmarc.mail.acme.com': [],
      '_dmarc.acme.com': ['v=DMARC1; p=quarantine; rua=mailto:d@acme.com'],
    })
    const expectation = googleMailboxSenderExpectation('rep@mail.acme.com') as SenderReadinessExpectation
    const readiness = await readSenderReadiness(expectation, {}, { lookupTxt: lookup, nowMs: NOW })
    expect(asked).toContain('_dmarc.acme.com')
    expect(readiness.dmarc.policyDomain).toBe('acme.com')
    expect(readiness.dmarc.policy).toBe('quarantine')
  })

  it('remembers a complete answer for ten minutes, and asks again when told to', async () => {
    const records = {
      'acme.com': ['v=spf1 include:_spf.google.com ~all'],
      'google._domainkey.acme.com': [KEY],
      '_dmarc.acme.com': ['v=DMARC1; p=none; rua=mailto:d@acme.com'],
    }
    const { lookup, asked } = zone(records)
    await readSenderReadiness(workspace, {}, { lookupTxt: lookup, nowMs: NOW })
    await readSenderReadiness(workspace, {}, { lookupTxt: lookup, nowMs: NOW + 60_000 })
    expect(asked).toHaveLength(3)
    await readSenderReadiness(workspace, { fresh: true }, { lookupTxt: lookup, nowMs: NOW + 120_000 })
    expect(asked).toHaveLength(6)
    await readSenderReadiness(workspace, {}, { lookupTxt: lookup, nowMs: NOW + 120_000 + SENDER_READINESS_MEMORY_MS })
    expect(asked).toHaveLength(9)
  })

  it('reads an unanswered or throwing lookup as unknown, and does not remember it', async () => {
    const { lookup, asked } = zone({ 'acme.com': null, 'google._domainkey.acme.com': [KEY], '_dmarc.acme.com': [] })
    const first = await readSenderReadiness(workspace, {}, { lookupTxt: lookup, nowMs: NOW })
    expect(first.spf.state).toBe('unknown')
    await readSenderReadiness(workspace, {}, { lookupTxt: lookup, nowMs: NOW + 1_000 })
    expect(asked.filter((host) => host === 'acme.com')).toHaveLength(2)

    const thrown = await readSenderReadiness(
      workspace,
      { fresh: true },
      {
        lookupTxt: async () => {
          throw new Error('boom')
        },
        nowMs: NOW,
      },
    )
    expect(thrown.overall).toBe('unknown')
  })
})
