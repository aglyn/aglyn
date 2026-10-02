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
 * The Marketing plugin's answer to the platform's conversion-credit contract
 * (AGL-3080): which of its joins each door's question reaches, and the one
 * check it makes of a touch that came back from a door unread. What each
 * join writes is that join's own spec's claim.
 */

const attributeCampaignConversion = jest.fn(async (_options: unknown) => ({ kind: 'form' }))
const creditCampaignSequenceOutcome = jest.fn(async (_options: unknown) => 1)
const eraseCampaignAttributionsForPersonKey = jest.fn(async (_key: unknown) => 2)
const resolveCampaignTouch = jest.fn(async (_options: unknown) => ({
  channel: 'web',
  campaign: 'spring',
  touchedAtMs: 10,
}))
jest.mock('./campaign-conversion-attribution', () => ({
  __esModule: true,
  attributeCampaignConversion: (options: unknown) => attributeCampaignConversion(options),
  creditCampaignSequenceOutcome: (options: unknown) => creditCampaignSequenceOutcome(options),
  eraseCampaignAttributionsForPersonKey: (key: unknown) => eraseCampaignAttributionsForPersonKey(key),
  resolveCampaignTouch: (options: unknown) => resolveCampaignTouch(options),
}))

const recordEmailCampaignTouch = jest.fn(async (_touch: unknown) => true)
const eraseEmailCampaignTouches = jest.fn(async (_key: unknown) => true)
jest.mock('./email-campaign-touch', () => ({
  __esModule: true,
  recordEmailCampaignTouch: (touch: unknown) => recordEmailCampaignTouch(touch),
  eraseEmailCampaignTouches: (key: unknown) => eraseEmailCampaignTouches(key),
}))

const attributeOrderToEmail = jest.fn(async (_options: unknown) => null as unknown)
const reverseEmailAttributedRevenue = jest.fn(async (_options: unknown) => true)
jest.mock('./email-revenue-attribution', () => ({
  __esModule: true,
  attributeOrderToEmail: (options: unknown) => attributeOrderToEmail(options),
  reverseEmailAttributedRevenue: (options: unknown) => reverseEmailAttributedRevenue(options),
}))

import { marketingConversionCreditor as creditor } from './conversion-creditor'

beforeEach(() => jest.clearAllMocks())

describe('a door’s identify moment', () => {
  it('credits the touch the join resolved, handed back unread', async () => {
    const touch = await creditor.resolveTouch({ hostId: 'h1', wire: 'w', email: 'a@b.co' })
    expect(await creditor.creditConversion({ hostId: 'h1', kind: 'lead', refId: 'l1', touch })).toBe(true)
    expect(attributeCampaignConversion).toHaveBeenCalledWith(
      expect.objectContaining({ hostId: 'h1', kind: 'lead', refId: 'l1', touch }),
    )
  })

  it('credits a click on a sequence’s mail as the sequence’s touch', async () => {
    await creditor.creditConversion({
      hostId: 'h1',
      kind: 'contact',
      refId: 'c1',
      click: { hostId: 'h1', creditTo: 'camp-1', atMs: 5, via: { sequenceId: 'q1', enrollmentId: 'e1' } },
      convertedAtMs: 5,
    })
    expect(attributeCampaignConversion).toHaveBeenCalledWith(
      expect.objectContaining({
        touch: {
          channel: 'sequence',
          campaignId: 'camp-1',
          sequenceId: 'q1',
          enrollmentId: 'e1',
          touchedAtMs: 5,
        },
        convertedAtMs: 5,
      }),
    )
  })

  it('credits nobody for a kind it does not keep, or a touch it did not write', async () => {
    expect(
      await creditor.creditConversion({ hostId: 'h1', kind: 'review', refId: 'r1', touch: { channel: 'web', touchedAtMs: 1 } }),
    ).toBe(false)
    expect(
      await creditor.creditConversion({ hostId: 'h1', kind: 'form', refId: 's1', touch: { channel: 'carrier-pigeon', touchedAtMs: 1 } }),
    ).toBe(false)
    expect(
      await creditor.creditConversion({ hostId: 'h1', kind: 'form', refId: 's1', touch: { channel: 'web' } }),
    ).toBe(false)
    expect(attributeCampaignConversion).not.toHaveBeenCalled()
  })
})

describe('money, mail and outcomes', () => {
  it('answers whether an order was credited', async () => {
    expect(await creditor.creditOrder({ hostId: 'h1', orderId: 'o1', email: 'a@b.co', amountCents: 100 })).toBe(false)
    attributeOrderToEmail.mockResolvedValueOnce({ campaignId: 'c1' })
    expect(await creditor.creditOrder({ hostId: 'h1', orderId: 'o2', email: 'a@b.co', amountCents: 100 })).toBe(true)
    expect(await creditor.reverseOrder({ hostId: 'h1', orderId: 'o2', amountCents: 50, closedTheOrder: true })).toBe(true)
  })

  it('stamps a click with its sequence only when both of the mail’s facts are there', async () => {
    await creditor.recordClick({ hostId: 'h1', creditTo: 'c1', atMs: 1, email: 'a@b.co', via: { sequenceId: 'q1' } })
    expect(recordEmailCampaignTouch).toHaveBeenLastCalledWith({
      email: 'a@b.co',
      hostId: 'h1',
      campaignId: 'c1',
      atMs: 1,
    })
  })

  it('counts an outcome under the containers the record is filed in', async () => {
    expect(
      await creditor.creditOutcome({ hostId: 'h1', orgId: 'o1', containerIds: ['c1'], outcome: 'replied', atMs: 3 }),
    ).toBe(1)
    expect(creditCampaignSequenceOutcome).toHaveBeenCalledWith({
      hostId: 'h1',
      orgId: 'o1',
      campaignIds: ['c1'],
      outcome: 'replied',
      atMs: 3,
    })
  })
})

it('erases the person’s touches and every credit drawn from them', async () => {
  expect(await creditor.erasePerson('key-1')).toBe(3)
  expect(eraseEmailCampaignTouches).toHaveBeenCalledWith('key-1')
  expect(eraseCampaignAttributionsForPersonKey).toHaveBeenCalledWith('key-1')
})
