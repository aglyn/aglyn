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
  applyMailGatewayOutcome,
  classifyMailGateway,
  MAIL_GATEWAY_DAILY_DELIVERY_CAP,
  mailGatewayHolds,
  mailGatewayLedgerKey,
  mailGatewayOfHost,
  mailGatewayStanding,
  normalizeLedgerSendingDomain,
  readStoredMailGatewayLedger,
} from './mail-gateway'

const NOW = Date.parse('2026-09-24T15:00:00Z')
const DAY = 86_400_000

describe('the gateway an MX names', () => {
  it('names the security gateways and the hosted providers, and buckets the rest', () => {
    expect(classifyMailGateway(['d152753a.ess.barracudanetworks.com.'])).toBe('barracuda')
    expect(classifyMailGateway(['mx1.pphosted.com'])).toBe('proofpoint')
    expect(classifyMailGateway(['us-smtp-inbound-1.mimecast.com'])).toBe('mimecast')
    expect(classifyMailGateway(['aspmx.l.google.com'])).toBe('google')
    expect(classifyMailGateway(['acme-com.mail.protection.outlook.com'])).toBe('microsoft')
    expect(classifyMailGateway(['mail.acme.example'])).toBe('other')
    expect(classifyMailGateway([])).toBe('none')
    expect(mailGatewayOfHost('mx.acme.example')).toBeNull()
  })
})

describe('the ledger, keyed sending domain × gateway', () => {
  it('keys a ledger by the sending domain and the gateway, and reads the key back', () => {
    expect(mailGatewayLedgerKey('aglyn.io', 'barracuda')).toBe('aglyn.io~barracuda')
    expect(normalizeLedgerSendingDomain('"Zach" <Zach@Aglyn.IO>')).toBe('aglyn.io')
    expect(normalizeLedgerSendingDomain('aglyn.io.')).toBe('aglyn.io')
    expect(normalizeLedgerSendingDomain('nope')).toBeNull()
    expect(readStoredMailGatewayLedger('aglyn.io~barracuda', { blocked: 2, days: { '2026-09-24': { blocked: 2 } } })).toEqual({
      sendingDomain: 'aglyn.io',
      gateway: 'barracuda',
      sent: 0,
      delivered: 0,
      blocked: 2,
      lastBlockedAtMs: null,
      lastBlockedDetail: null,
      days: { '2026-09-24': { sent: 0, delivered: 0, blocked: 2 } },
      updatedAtMs: 0,
    })
    expect(readStoredMailGatewayLedger('aglyn.io~bogus', {})).toBeNull()
  })

  it('counts an outcome by day, keeps the last refusal’s words, and prunes to the window', () => {
    const first = applyMailGatewayOutcome(null, {
      sendingDomain: 'aglyn.io',
      gateway: 'barracuda',
      outcome: 'blocked',
      atMs: NOW - 40 * DAY,
      detail: 'old',
    })
    const second = applyMailGatewayOutcome(first, {
      sendingDomain: 'aglyn.io',
      gateway: 'barracuda',
      outcome: 'blocked',
      atMs: NOW,
      detail: '550 5.7.1 blocked using Barracuda Reputation',
    })
    expect(second).toEqual({
      sendingDomain: 'aglyn.io',
      gateway: 'barracuda',
      sent: 0,
      delivered: 0,
      blocked: 2,
      lastBlockedAtMs: NOW,
      lastBlockedDetail: '550 5.7.1 blocked using Barracuda Reputation',
      days: { '2026-09-24': { sent: 0, delivered: 0, blocked: 1 } },
      updatedAtMs: NOW,
    })
  })

  it('stops counting deliveries at the day’s cap, and answers null for a write that changes nothing', () => {
    const capped = applyMailGatewayOutcome(null, {
      sendingDomain: 'aglyn.io',
      gateway: 'google',
      outcome: 'delivered',
      count: MAIL_GATEWAY_DAILY_DELIVERY_CAP + 10,
      atMs: NOW,
    })
    expect(capped?.days['2026-09-24'].delivered).toBe(MAIL_GATEWAY_DAILY_DELIVERY_CAP)
    expect(
      applyMailGatewayOutcome(capped, { sendingDomain: 'aglyn.io', gateway: 'google', outcome: 'delivered', atMs: NOW }),
    ).toBeNull()
    expect(
      applyMailGatewayOutcome(capped, { sendingDomain: 'aglyn.io', gateway: 'google', outcome: 'delivered', atMs: NOW + DAY }),
    ).not.toBeNull()
    expect(
      applyMailGatewayOutcome(null, { sendingDomain: 'aglyn.io', gateway: 'google', outcome: 'sent', count: 0, atMs: NOW }),
    ).toBeNull()
  })

  it('holds after two refusals and no delivery in the window, and never for other or none', () => {
    const ledger = applyMailGatewayOutcome(
      applyMailGatewayOutcome(null, { sendingDomain: 'aglyn.io', gateway: 'barracuda', outcome: 'blocked', atMs: NOW - 3 * DAY }),
      { sendingDomain: 'aglyn.io', gateway: 'barracuda', outcome: 'blocked', atMs: NOW },
    )
    const standing = mailGatewayStanding('barracuda', ledger, NOW)
    expect(standing).toEqual({ gateway: 'barracuda', blocked7: 2, delivered7: 0, blocked30: 2, delivered30: 0 })
    expect(mailGatewayHolds(standing)).toBe(true)
    expect(mailGatewayHolds({ ...standing, gateway: 'other' })).toBe(false)
    expect(mailGatewayHolds({ ...standing, gateway: 'none' })).toBe(false)
    expect(mailGatewayHolds(mailGatewayStanding('barracuda', ledger, NOW + 31 * DAY))).toBe(false)
  })
})
