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

/**
 * @jest-environment node
 */

import {
  classifyOutreachMailGateway,
  isOutreachGatewayFronted,
  outreachGatewayChip,
  outreachGatewayDay,
  outreachGatewayHoldReason,
  outreachGatewayHolds,
  outreachGatewayWindow,
  outreachMailGatewayOfHost,
  pruneOutreachGatewayDays,
  type OutreachGatewayStanding,
} from './mail-gateway'

const NOW = Date.parse('2026-09-24T15:00:00Z')

const standing = (overrides: Partial<OutreachGatewayStanding> = {}): OutreachGatewayStanding => ({
  gateway: 'barracuda',
  blocked7: 0,
  delivered7: 0,
  blocked30: 0,
  delivered30: 0,
  ...overrides,
})

describe('classifyOutreachMailGateway (AGL-3326)', () => {
  it('names the gateway by the MX host, whatever the case or the trailing dot', () => {
    expect(classifyOutreachMailGateway(['d152753a.ess.barracudanetworks.com.'])).toBe('barracuda')
    expect(classifyOutreachMailGateway(['MXA-00123456.gslb.pphosted.com'])).toBe('proofpoint')
    expect(classifyOutreachMailGateway(['mx1.ppe-hosted.com'])).toBe('proofpoint')
    expect(classifyOutreachMailGateway(['us-smtp-inbound-1.mimecast.com'])).toBe('mimecast')
    expect(classifyOutreachMailGateway(['aspmx.l.google.com', 'alt1.aspmx.l.google.com'])).toBe('google')
    expect(classifyOutreachMailGateway(['example-com.mail.protection.outlook.com'])).toBe('microsoft')
  })

  it('reads a self-hosted or unrecognized exchange as other, and no exchange as none', () => {
    expect(classifyOutreachMailGateway(['mail.example.com'])).toBe('other')
    expect(classifyOutreachMailGateway([])).toBe('none')
    expect(classifyOutreachMailGateway(['.'])).toBe('none')
    expect(classifyOutreachMailGateway(['', '  '])).toBe('none')
  })

  it('takes the first named gateway in MX order when a domain mixes them', () => {
    expect(classifyOutreachMailGateway(['mail.example.com', 'backup.mimecast.com'])).toBe('mimecast')
  })

  it('names one host, or nothing, for a bounce’s Remote-MTA', () => {
    expect(outreachMailGatewayOfHost('d78608a.ess.barracudanetworks.com')).toBe('barracuda')
    expect(outreachMailGatewayOfHost('mx.example.com')).toBeNull()
    expect(outreachMailGatewayOfHost(null)).toBeNull()
    // A bare suffix, as a host, is that gateway too.
    expect(outreachMailGatewayOfHost('mimecast.com')).toBe('mimecast')
  })

  it('counts the security gateways as gateway-fronted, and the hosted providers not', () => {
    expect(isOutreachGatewayFronted('barracuda')).toBe(true)
    expect(isOutreachGatewayFronted('proofpoint')).toBe(true)
    expect(isOutreachGatewayFronted('mimecast')).toBe(true)
    expect(isOutreachGatewayFronted('google')).toBe(false)
    expect(isOutreachGatewayFronted('other')).toBe(false)
    expect(isOutreachGatewayFronted(null)).toBe(false)
  })
})

describe('the ledger’s windows', () => {
  const day = (offset: number) => outreachGatewayDay(NOW - offset * 86_400_000)
  const days = {
    [day(0)]: { sent: 1, delivered: 0, blocked: 1 },
    [day(6)]: { sent: 2, delivered: 1, blocked: 1 },
    [day(7)]: { sent: 1, delivered: 1, blocked: 0 },
    [day(29)]: { sent: 1, delivered: 0, blocked: 1 },
    [day(30)]: { sent: 5, delivered: 5, blocked: 0 },
  }

  it('files a day in UTC', () => {
    expect(outreachGatewayDay(Date.parse('2026-09-24T23:30:00-06:00'))).toBe('2026-09-25')
  })

  it('sums the last N days, today included', () => {
    expect(outreachGatewayWindow(days, NOW, 7)).toEqual({ sent: 3, delivered: 1, blocked: 2 })
    expect(outreachGatewayWindow(days, NOW, 30)).toEqual({ sent: 5, delivered: 2, blocked: 3 })
    expect(outreachGatewayWindow(null, NOW, 30)).toEqual({ sent: 0, delivered: 0, blocked: 0 })
    expect(outreachGatewayWindow({ [day(0)]: { sent: 'x' as never } }, NOW, 7)).toEqual({ sent: 0, delivered: 0, blocked: 0 })
  })

  it('prunes the days older than the window it keeps', () => {
    expect(Object.keys(pruneOutreachGatewayDays(days, NOW, 30)).sort()).toEqual([day(29), day(7), day(6), day(0)].sort())
  })
})

describe('outreachGatewayHolds', () => {
  it('holds a named gateway at two blocks and no delivery in the window', () => {
    expect(outreachGatewayHolds(standing({ blocked30: 2 }))).toBe(true)
    expect(outreachGatewayHolds(standing({ gateway: 'google', blocked30: 4 }))).toBe(true)
    expect(outreachGatewayHolds(standing({ blocked30: 1 }))).toBe(false)
    expect(outreachGatewayHolds(standing({ blocked30: 2, delivered30: 1 }))).toBe(false)
  })

  it('never holds on the other bucket, and never on no MX', () => {
    expect(outreachGatewayHolds(standing({ gateway: 'other', blocked30: 9 }))).toBe(false)
    expect(outreachGatewayHolds(standing({ gateway: 'none', blocked30: 9 }))).toBe(false)
  })

  it('says why in a sentence the enrollment row can show', () => {
    expect(outreachGatewayHoldReason('barracuda', 2)).toBe(
      'Barracuda refused this sender twice in the last 30 days and delivered nothing, so this email is held. Resume the enrollment to send it anyway.',
    )
    expect(outreachGatewayHoldReason('mimecast', 4)).toMatch(/^Mimecast refused this sender 4 times/)
  })
})

describe('outreachGatewayChip', () => {
  it('is red for a gateway that refused this week, with the count of settled sends', () => {
    expect(outreachGatewayChip(standing({ blocked7: 2 }))).toEqual({
      label: 'Barracuda · 2 of 2 sends refused this week',
      tone: 'refused',
    })
    expect(outreachGatewayChip(standing({ blocked7: 1, delivered7: 0 }))).toEqual({
      label: 'Barracuda · 1 of 1 send refused this week',
      tone: 'refused',
    })
    expect(outreachGatewayChip(standing({ blocked7: 1, delivered7: 3 }))?.label).toBe(
      'Barracuda · 1 of 4 sends refused this week',
    )
  })

  it('is green for a gateway that delivered, neutral for one with no verdict, blocked for no MX', () => {
    expect(outreachGatewayChip(standing({ gateway: 'proofpoint', delivered7: 1 }))).toEqual({
      label: 'Proofpoint · 1 of 1 delivered this week',
      tone: 'delivered',
    })
    expect(outreachGatewayChip(standing({ gateway: 'google' }))).toEqual({ label: 'Google Workspace', tone: 'neutral' })
    expect(outreachGatewayChip(standing({ gateway: 'microsoft' }))).toEqual({ label: 'Microsoft 365', tone: 'neutral' })
    expect(outreachGatewayChip(standing({ gateway: 'mimecast' }))).toEqual({ label: 'Mimecast', tone: 'neutral' })
    expect(outreachGatewayChip(standing({ gateway: 'none' }))).toEqual({
      label: 'No MX record — cannot receive mail',
      tone: 'blocked',
    })
  })

  it('shows nothing for an unrecognized exchange with no verdict this week, and nothing for no reading', () => {
    expect(outreachGatewayChip(standing({ gateway: 'other' }))).toBeNull()
    expect(outreachGatewayChip(standing({ gateway: 'other', delivered7: 2 }))?.label).toBe(
      'Other mail gateway · 2 of 2 delivered this week',
    )
    expect(outreachGatewayChip(null)).toBeNull()
  })
})
