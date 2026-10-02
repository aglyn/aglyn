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

import { setRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  conversionDescriptionSentences,
  creditConversion,
  creditConversionOutcome,
  creditOrderConversion,
  eraseConversionCredits,
  pluginConversionCreditor,
  recordConversionClick,
  registerPluginConversionCreditor,
  resolveConversionTouch,
  reverseOrderConversion,
  type PluginConversionCreditor,
} from './plugin-conversion-credit'
import {
  registerPluginDeclarationsRepair,
  resetPluginDeclarationsRepairForTests,
} from './plugin-declarations-repair'
import { resetPluginServicesForTests } from './plugin-services'

/**
 * The conversion-credit contract (AGL-3080): a door asks whichever plugin
 * credits outcomes, and gets an empty answer — never a throw — when nobody
 * does or the creditor fails.
 */

const calls: Array<[string, unknown]> = []

function creditor(overrides: Partial<PluginConversionCreditor> = {}): PluginConversionCreditor {
  return {
    resolveTouch: async (request) => (calls.push(['resolveTouch', request]), { channel: 'web', touchedAtMs: 1 }),
    creditConversion: async (request) => (calls.push(['creditConversion', request]), true),
    creditOrder: async (request) => (calls.push(['creditOrder', request]), true),
    reverseOrder: async (request) => (calls.push(['reverseOrder', request]), true),
    recordClick: async (click) => (calls.push(['recordClick', click]), true),
    creditOutcome: async (request) => (calls.push(['creditOutcome', request]), 2),
    erasePerson: async (key) => (calls.push(['erasePerson', key]), 3),
    ...overrides,
  }
}

beforeEach(() => {
  calls.length = 0
  resetPluginServicesForTests()
  resetPluginDeclarationsRepairForTests()
  setRegisteringPluginId(undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('with a creditor', () => {
  beforeEach(() => registerPluginConversionCreditor(creditor(), { pluginId: 'credits' }))

  it('hands every door’s question to the one creditor', async () => {
    expect(pluginConversionCreditor()?.pluginId).toBe('credits')
    const touch = await resolveConversionTouch({ hostId: 'h1', wire: 'x', email: 'a@b.co' })
    expect(touch).toEqual({ channel: 'web', touchedAtMs: 1 })
    expect(await creditConversion({ hostId: 'h1', kind: 'form', refId: 's1', touch })).toBe(true)
    expect(await creditOrderConversion({ hostId: 'h1', orderId: 'o1', email: 'a@b.co', amountCents: 100 })).toBe(true)
    expect(await reverseOrderConversion({ hostId: 'h1', orderId: 'o1', amountCents: 50, closedTheOrder: false })).toBe(true)
    expect(await recordConversionClick({ hostId: 'h1', creditTo: 'c1', atMs: 1, email: 'a@b.co' })).toBe(true)
    expect(await creditConversionOutcome({ hostId: 'h1', containerIds: ['c1'], outcome: 'sent' })).toBe(2)
    expect(await eraseConversionCredits('key-1')).toBe(3)
    expect(calls.map(([name]) => name)).toEqual([
      'resolveTouch',
      'creditConversion',
      'creditOrder',
      'reverseOrder',
      'recordClick',
      'creditOutcome',
      'erasePerson',
    ])
  })

  it('credits nobody for a moment with no touch and no click, without asking', async () => {
    expect(await creditConversion({ hostId: 'h1', kind: 'form', refId: 's1', touch: null })).toBe(false)
    expect(await eraseConversionCredits('')).toBe(0)
    expect(calls).toEqual([])
  })

  it('refuses a second plugin’s creditor, naming both', () => {
    expect(() => registerPluginConversionCreditor(creditor(), { pluginId: 'other' })).toThrow(/credits/)
    expect(pluginConversionCreditor()?.pluginId).toBe('credits')
  })
})

describe('without one', () => {
  it('answers every door empty, after running the boot step once', async () => {
    const repair = jest.fn(async (): Promise<void> => undefined)
    registerPluginDeclarationsRepair(repair)

    expect(await resolveConversionTouch({ hostId: 'h1' })).toBeNull()
    expect(await creditOrderConversion({ hostId: 'h1', orderId: 'o1', email: 'a@b.co', amountCents: 1 })).toBe(false)
    expect(await creditConversionOutcome({ hostId: 'h1', containerIds: ['c1'], outcome: 'sent' })).toBe(0)
    expect(await eraseConversionCredits('key-1')).toBe(0)
    expect(repair).toHaveBeenCalled()
  })

  it('finds the creditor the boot step registers', async () => {
    registerPluginDeclarationsRepair(async () =>
      registerPluginConversionCreditor(creditor(), { pluginId: 'credits' }),
    )
    expect(await eraseConversionCredits('key-1')).toBe(3)
  })
})

it('answers a throwing creditor empty — the door’s outcome already happened', async () => {
  registerPluginConversionCreditor(
    creditor({
      resolveTouch: async () => {
        throw new Error('down')
      },
      creditOrder: async () => {
        throw new Error('down')
      },
    }),
    { pluginId: 'credits' },
  )
  await expect(resolveConversionTouch({ hostId: 'h1' })).resolves.toBeNull()
  await expect(
    creditOrderConversion({ hostId: 'h1', orderId: 'o1', email: 'a@b.co', amountCents: 1 }),
  ).resolves.toBe(false)
})

/*
 * A creditor's description, as the sentences a door's alert appends
 * (AGL-3461). What a record is credited to and what it is filed under are two
 * facts, and neither is ever worded as the other.
 */
describe('conversionDescriptionSentences', () => {
  it('says nothing for nothing', () => {
    expect(conversionDescriptionSentences(null)).toEqual([])
    expect(conversionDescriptionSentences({ filedUnder: [] })).toEqual([])
  })

  it('names what it is CREDITED to, and how the visitor was touched', () => {
    expect(
      conversionDescriptionSentences({
        credited: { label: 'One job — AI', how: 'viewed /ai-website-draft, a page filed under it' },
        filedUnder: [],
      }),
    ).toEqual([
      'Credited to “One job — AI”: the visitor viewed /ai-website-draft, a page filed under it.',
    ])
  })

  it('says what it is FILED under in a sentence of its own, never as a credit', () => {
    const sentences = conversionDescriptionSentences({
      filedUnder: [
        { id: 'a', label: 'Spring' },
        { id: 'b', label: 'Retargeting' },
      ],
    })

    expect(sentences).toEqual(['Filed under “Spring” and “Retargeting”.'])
    expect(sentences.join(' ')).not.toContain('Credited')
  })

  it('summarizes a long list rather than printing every container', () => {
    expect(
      conversionDescriptionSentences({
        filedUnder: ['A', 'B', 'C', 'D', 'E'].map((label) => ({ id: label, label })),
      }),
    ).toEqual(['Filed under “A”, “B” and 3 more.'])
  })

  it('keeps the credit first when it has both', () => {
    expect(
      conversionDescriptionSentences({
        credited: { label: 'Spring', how: 'clicked one of its emails' },
        filedUnder: [{ id: 'a', label: 'Spring' }],
      }),
    ).toEqual(['Credited to “Spring”: the visitor clicked one of its emails.', 'Filed under “Spring”.'])
  })
})
