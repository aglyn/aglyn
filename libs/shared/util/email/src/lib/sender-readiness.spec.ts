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
  assessSenderReadiness,
  dmarcDomainsAlign,
  googleMailboxSenderExpectation,
  microsoftMailboxSenderExpectation,
  parseDmarcRecord,
  parseSpf,
  resendSenderExpectation,
  senderReadinessHosts,
  spfNamesInclude,
  worstSenderReadinessState,
  type SenderReadinessExpectation,
  type SenderReadinessObservation,
} from './sender-readiness'

const NOW = Date.parse('2026-09-28T15:00:00Z')

const WORKSPACE = googleMailboxSenderExpectation('rep@acme.com') as SenderReadinessExpectation
const KEY = 'v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC'

const healthy: SenderReadinessObservation = {
  spfTxt: ['google-site-verification=abc', 'v=spf1 include:_spf.google.com ~all'],
  dkimTxt: [KEY],
  dmarcTxt: ['v=DMARC1; p=quarantine; rua=mailto:dmarc@acme.com'],
}

describe('reading SPF', () => {
  it('reads the includes, the redirect and the closing all', () => {
    const policy = parseSpf(['v=spf1 ip4:192.0.2.1 include:_spf.google.com include:amazonses.com. -all'])
    expect(policy.count).toBe(1)
    expect(policy.includes).toEqual(['_spf.google.com', 'amazonses.com'])
    expect(policy.all).toBe('-all')
    expect(spfNamesInclude(policy, '_spf.google.com')).toBe(true)
    expect(spfNamesInclude(policy, 'sendgrid.net')).toBe(false)
    expect(parseSpf(['v=spf1 redirect=_spf.example.net']).redirect).toBe('_spf.example.net')
    expect(parseSpf(['v=spf1 include:x.example ~all']).all).toBe('~all')
    expect(parseSpf(['v=spf1 include:x.example all']).all).toBe('+all')
  })

  it('ignores TXT records that are not SPF, and counts duplicates', () => {
    expect(parseSpf(['site-verification=1', 'v=spf10 nonsense']).record).toBeNull()
    const twice = parseSpf(['v=spf1 include:a.example ~all', 'v=spf1 include:b.example -all'])
    expect(twice.count).toBe(2)
    expect(twice.record).toBeNull()
  })
})

describe('reading DMARC', () => {
  it('reads p=, sp=, rua=, pct= and the alignment modes', () => {
    const policy = parseDmarcRecord([
      'v=DMARC1; p=reject; sp=quarantine; adkim=s; aspf=r; pct=50; rua=mailto:a@acme.com, mailto:b@acme.com',
    ])
    expect(policy.policy).toBe('reject')
    expect(policy.subdomainPolicy).toBe('quarantine')
    expect(policy.adkim).toBe('s')
    expect(policy.aspf).toBe('r')
    expect(policy.pct).toBe(50)
    expect(policy.rua).toEqual(['mailto:a@acme.com', 'mailto:b@acme.com'])
  })

  it('reads an absent record as absent and an unreadable p= as none', () => {
    expect(parseDmarcRecord(['some-token']).policy).toBe('absent')
    expect(parseDmarcRecord(['v=DMARC1; p=bogus']).policy).toBe('none')
    expect(parseDmarcRecord(['v=DMARC1; p=none']).rua).toEqual([])
  })
})

describe('alignment', () => {
  it('relaxed is the organizational domain; strict is the exact name', () => {
    expect(dmarcDomainsAlign('send.acme.com', 'acme.com', 'r')).toBe(true)
    expect(dmarcDomainsAlign('send.acme.com', 'acme.com', 's')).toBe(false)
    expect(dmarcDomainsAlign('mail.acme.co.uk', 'acme.co.uk', 'r')).toBe(true)
    expect(dmarcDomainsAlign('evil.co.uk', 'acme.co.uk', 'r')).toBe(false)
    expect(dmarcDomainsAlign('gappssmtp.com', 'acme.com', 'r')).toBe(false)
  })
})

describe('the expectations', () => {
  it('a Resend domain: envelope on send., signed d=<domain> with its own selector', () => {
    const expectation = resendSenderExpectation({ domain: 'Acme.com', dkimSelector: 'aglyn-org1' })
    expect(expectation).toMatchObject({
      fromDomain: 'acme.com',
      envelopeDomain: 'send.acme.com',
      dkimSelector: 'aglyn-org1',
      dkimDomain: 'acme.com',
    })
    expect(senderReadinessHosts(expectation as SenderReadinessExpectation)).toEqual({
      spf: 'send.acme.com',
      dkim: 'aglyn-org1._domainkey.acme.com',
      dmarc: '_dmarc.acme.com',
      organizationalDmarc: null,
    })
  })

  it('a Workspace mailbox reads the google selector; a consumer Gmail address has nothing to publish', () => {
    expect(WORKSPACE).toMatchObject({ fromDomain: 'acme.com', spfInclude: '_spf.google.com', dkimSelector: 'google' })
    expect(googleMailboxSenderExpectation('someone@gmail.com')).toBeNull()
    expect(googleMailboxSenderExpectation('not an address')).toBeNull()
  })

  it('a Microsoft 365 mailbox reads selector1 and Exchange Online’s SPF; Microsoft’s own domains have nothing to publish (AGL-3489)', () => {
    const expectation = microsoftMailboxSenderExpectation('Rep@GetAcme.com') as SenderReadinessExpectation
    expect(expectation).toMatchObject({
      provider: 'Microsoft 365',
      fromDomain: 'getacme.com',
      envelopeDomain: 'getacme.com',
      spfInclude: 'spf.protection.outlook.com',
      dkimSelector: 'selector1',
    })
    expect(senderReadinessHosts(expectation).dkim).toBe('selector1._domainkey.getacme.com')
    expect(microsoftMailboxSenderExpectation('someone@outlook.com')).toBeNull()
    expect(microsoftMailboxSenderExpectation('rep@acmecold.onmicrosoft.com')).toBeNull()
    expect(microsoftMailboxSenderExpectation('not an address')).toBeNull()
  })

  it('asks the organizational domain’s DMARC for a subdomain From', () => {
    const hosts = senderReadinessHosts(resendSenderExpectation({ domain: 'mail.acme.com' }) as SenderReadinessExpectation)
    expect(hosts.dmarc).toBe('_dmarc.mail.acme.com')
    expect(hosts.organizationalDmarc).toBe('_dmarc.acme.com')
  })
})

describe('assessSenderReadiness', () => {
  it('passes a sender whose records are published and whose DKIM aligns', () => {
    const readiness = assessSenderReadiness(WORKSPACE, healthy, NOW)
    expect(readiness.spf.state).toBe('pass')
    expect(readiness.spf.all).toBe('~all')
    expect(readiness.dkim.state).toBe('pass')
    expect(readiness.dmarc.state).toBe('pass')
    expect(readiness.dmarc.policy).toBe('quarantine')
    expect(readiness.dmarc.rua).toEqual(['mailto:dmarc@acme.com'])
    expect(readiness.alignment).toMatchObject({ state: 'pass', dkimAligned: true, spfAligned: true })
    expect(readiness.overall).toBe('pass')
    expect(readiness.checkedAtMs).toBe(NOW)
  })

  it('-all passes; +all fails; ?all and a missing all warn', () => {
    const with_ = (spf: string) => assessSenderReadiness(WORKSPACE, { ...healthy, spfTxt: [spf] }, NOW).spf
    expect(with_('v=spf1 include:_spf.google.com -all').state).toBe('pass')
    expect(with_('v=spf1 include:_spf.google.com +all').state).toBe('fail')
    expect(with_('v=spf1 include:_spf.google.com ?all').state).toBe('warn')
    expect(with_('v=spf1 include:_spf.google.com').state).toBe('warn')
  })

  it('warns when SPF does not name the provider, and fails when there is no SPF at all', () => {
    const other = assessSenderReadiness(WORKSPACE, { ...healthy, spfTxt: ['v=spf1 include:spf.protection.outlook.com -all'] }, NOW)
    expect(other.spf.state).toBe('warn')
    expect(other.spf.authorizes).toBe(false)
    expect(other.alignment.spfAligned).toBe(false)
    const none = assessSenderReadiness(WORKSPACE, { ...healthy, spfTxt: [] }, NOW)
    expect(none.spf.state).toBe('fail')
  })

  it('fails DKIM for a missing selector and for a revoked (empty) key', () => {
    expect(assessSenderReadiness(WORKSPACE, { ...healthy, dkimTxt: [] }, NOW).dkim.state).toBe('fail')
    expect(assessSenderReadiness(WORKSPACE, { ...healthy, dkimTxt: ['v=DKIM1; p='] }, NOW).dkim.state).toBe('fail')
  })

  it('DMARC: absent warns, p=none without rua warns, p=none with rua passes', () => {
    expect(assessSenderReadiness(WORKSPACE, { ...healthy, dmarcTxt: [] }, NOW).dmarc.state).toBe('warn')
    expect(assessSenderReadiness(WORKSPACE, { ...healthy, dmarcTxt: ['v=DMARC1; p=none'] }, NOW).dmarc.state).toBe('warn')
    expect(
      assessSenderReadiness(WORKSPACE, { ...healthy, dmarcTxt: ['v=DMARC1; p=none; rua=mailto:r@acme.com'] }, NOW).dmarc.state,
    ).toBe('pass')
  })

  it('a subdomain with no record takes its organizational domain’s, under sp=', () => {
    const expectation = resendSenderExpectation({ domain: 'mail.acme.com', dkimSelector: 's1' }) as SenderReadinessExpectation
    const readiness = assessSenderReadiness(
      expectation,
      {
        spfTxt: ['v=spf1 include:amazonses.com ~all'],
        dkimTxt: [KEY],
        dmarcTxt: [],
        organizationalDmarcTxt: ['v=DMARC1; p=reject; sp=none; rua=mailto:d@acme.com'],
      },
      NOW,
    )
    expect(readiness.dmarc.policy).toBe('none')
    expect(readiness.dmarc.policyDomain).toBe('acme.com')
    expect(readiness.dmarc.host).toBe('_dmarc.acme.com')
  })

  it('passes on SPF alone with a warning when the DKIM key is missing', () => {
    const readiness = assessSenderReadiness(WORKSPACE, { ...healthy, dkimTxt: [] }, NOW)
    expect(readiness.alignment).toMatchObject({ state: 'warn', dkimAligned: false, spfAligned: true })
  })

  it('a Resend envelope on send. does not align under aspf=s, and DKIM carries DMARC', () => {
    const expectation = resendSenderExpectation({ domain: 'acme.com', dkimSelector: 's1' }) as SenderReadinessExpectation
    const observation = {
      spfTxt: ['v=spf1 include:amazonses.com ~all'],
      dkimTxt: [KEY],
      dmarcTxt: ['v=DMARC1; p=reject; aspf=s; rua=mailto:d@acme.com'],
    }
    expect(assessSenderReadiness(expectation, observation, NOW).alignment).toMatchObject({
      state: 'pass',
      spfAligned: false,
      dkimAligned: true,
    })
    const unsigned = assessSenderReadiness(expectation, { ...observation, dkimTxt: [] }, NOW)
    expect(unsigned.alignment.state).toBe('fail')
    expect(unsigned.alignment.detail).toContain('p=reject refuses the mail')
    expect(unsigned.alignment.detail).toContain('strict alignment')
  })

  it('reads an unanswered lookup as unknown, never as a failure', () => {
    const readiness = assessSenderReadiness(WORKSPACE, { spfTxt: null, dkimTxt: null, dmarcTxt: null }, NOW)
    expect(readiness.spf.state).toBe('unknown')
    expect(readiness.dkim.state).toBe('unknown')
    expect(readiness.dmarc.state).toBe('unknown')
    expect(readiness.alignment.state).toBe('unknown')
    expect(readiness.overall).toBe('unknown')
  })

  it('ranks fail over warn over unknown over pass', () => {
    expect(worstSenderReadinessState(['pass', 'unknown'])).toBe('unknown')
    expect(worstSenderReadinessState(['unknown', 'warn'])).toBe('warn')
    expect(worstSenderReadinessState(['warn', 'fail', 'pass'])).toBe('fail')
    expect(worstSenderReadinessState([])).toBe('pass')
  })
})
