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
  listPluginPersonErasers,
  PLUGIN_REQUIRED_PERSON_ERASERS,
  registerPluginPersonEraser,
  registerPluginPersonRecordsEraser,
  resetPluginPersonErasersForTests,
  runPluginPersonErasure,
  standInRequiredPersonErasersForTests,
  type PluginPersonErasureRequest,
} from './plugin-person-erasure'

const TARGET = {
  orgId: 'org-a',
  email: 'pat@example.com',
  key: 'k'.repeat(64),
  dryRun: false,
  atMs: 1_000,
}

/** No share is required unless a case says so. */
const NONE: readonly string[] = []

beforeEach(() => {
  resetPluginPersonErasersForTests()
  setRegisteringPluginId(undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('plugin person erasers (AGL-2981)', () => {
  it("runs two unrelated plugins' erasers in order, each report under its plugin", async () => {
    const seen: string[] = []
    setRegisteringPluginId('mail')
    registerPluginPersonEraser(async ({ orgId, contactIds, dryRun }) => {
      seen.push(`mail:${orgId}:${contactIds.join(',')}:${dryRun}`)
      return { enrollments: 2 }
    })
    setRegisteringPluginId(undefined)
    registerPluginPersonEraser(
      async ({ key }) => {
        seen.push(`surveys:${key.length}`)
        return { responses: 1, anonymized: true }
      },
      { pluginId: 'acme-surveys' },
    )

    const { reports, contactIds } = await runPluginPersonErasure(TARGET, NONE)

    expect(seen).toEqual(['mail:org-a::false', 'surveys:64'])
    expect(contactIds).toEqual([])
    expect(reports).toEqual({
      mail: { enrollments: 2 },
      'acme-surveys': { responses: 1, anonymized: true },
    })
    expect(listPluginPersonErasers()).toEqual(['mail', 'acme-surveys'])
  })

  it('hands a dry run to every eraser as a dry run, with the erasure’s one time', async () => {
    const mail = jest.fn(async () => ({ enrollments: 3, deleted: null as number | null }))
    registerPluginPersonEraser(mail, { pluginId: 'mail' })

    expect((await runPluginPersonErasure({ ...TARGET, dryRun: true }, NONE)).reports).toEqual({
      mail: { enrollments: 3, deleted: null },
    })
    expect(mail).toHaveBeenCalledWith({ ...TARGET, dryRun: true, contactIds: [] })
  })

  it('records a failing eraser as null, never zero, logs it without the address, and runs the next', async () => {
    registerPluginPersonEraser(
      async () => {
        throw new Error('store down')
      },
      { pluginId: 'mail' },
    )
    const surveys = jest.fn(async () => ({ responses: 0 }))
    registerPluginPersonEraser(surveys, { pluginId: 'acme-surveys' })

    const { reports } = await runPluginPersonErasure(TARGET, NONE)

    expect(reports).toEqual({ mail: null, 'acme-surveys': { responses: 0 } })
    expect(surveys).toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith(
      '[plugins] mail failed to erase a person in org org-a',
      expect.any(Error),
    )
    expect(JSON.stringify((console.error as jest.Mock).mock.calls[0][0])).not.toContain(TARGET.email)
  })

  it("replaces a plugin's eraser in place when it registers again", async () => {
    registerPluginPersonEraser(async () => ({ run: 1 }), { pluginId: 'mail' })
    registerPluginPersonEraser(async () => ({ responses: 1 }), { pluginId: 'acme-surveys' })
    registerPluginPersonEraser(async () => ({ run: 2 }), { pluginId: 'mail' })

    expect(listPluginPersonErasers()).toEqual(['mail', 'acme-surveys'])
    expect((await runPluginPersonErasure(TARGET, NONE)).reports).toEqual({
      mail: { run: 2 },
      'acme-surveys': { responses: 1 },
    })
  })

  it('refuses an eraser with no owner', () => {
    expect(() => registerPluginPersonEraser(async () => ({}))).toThrow(/no owner/)
    expect(() => registerPluginPersonEraser(async () => ({}), { pluginId: ' ' })).toThrow(/no owner/)
    expect(() =>
      registerPluginPersonRecordsEraser({ locate: async () => [], erase: async () => ({}) }),
    ).toThrow(/no owner/)
  })

  it('answers an empty record when no plugin registered one', async () => {
    expect(await runPluginPersonErasure(TARGET, NONE)).toEqual({ contactIds: [], reports: {} })
  })
})

describe('the plugin that keeps the people (AGL-3080)', () => {
  it('names the records before anybody erases, and erases its own after everybody else', async () => {
    const order: string[] = []
    const handed: Record<string, readonly string[]> = {}
    const people = {
      locate: jest.fn(async () => {
        order.push('people:locate')
        return ['contact-1', 'contact-2']
      }),
      erase: jest.fn(async (request: PluginPersonErasureRequest) => {
        order.push('people:erase')
        handed['people'] = request.contactIds
        return { contacts: 2 }
      }),
    }
    // Registered FIRST, and still last to erase.
    registerPluginPersonRecordsEraser(people, { pluginId: 'people' })
    registerPluginPersonEraser(
      async (request) => {
        order.push('mail')
        handed['mail'] = request.contactIds
        // Its own copy: what it does to the list reaches nobody else.
        ;(request.contactIds as string[]).push('injected')
        return { enrollments: 1 }
      },
      { pluginId: 'mail' },
    )
    registerPluginPersonEraser(
      async (request) => {
        order.push('shop')
        handed['shop'] = request.contactIds
        return { orders: 1 }
      },
      { pluginId: 'shop' },
    )

    const outcome = await runPluginPersonErasure(TARGET, NONE)

    expect(order).toEqual(['people:locate', 'mail', 'shop', 'people:erase'])
    expect(people.locate).toHaveBeenCalledWith({ ...TARGET })
    expect(handed).toEqual({
      mail: ['contact-1', 'contact-2', 'injected'],
      shop: ['contact-1', 'contact-2'],
      people: ['contact-1', 'contact-2'],
    })
    expect(outcome).toEqual({
      contactIds: ['contact-1', 'contact-2'],
      reports: { mail: { enrollments: 1 }, shop: { orders: 1 }, people: { contacts: 2 } },
    })
    expect(listPluginPersonErasers()).toEqual(['mail', 'shop', 'people'])
  })

  it('keeps one records eraser: the same plugin replaces its own, another is refused naming both', () => {
    registerPluginPersonRecordsEraser({ locate: async () => [], erase: async () => ({}) }, { pluginId: 'people' })
    registerPluginPersonRecordsEraser({ locate: async () => ['x'], erase: async () => ({}) }, { pluginId: 'people' })
    expect(() =>
      registerPluginPersonRecordsEraser({ locate: async () => [], erase: async () => ({}) }, { pluginId: 'rival' }),
    ).toThrow(/"people".*"rival"/)
  })

  it('erases nothing when the records cannot be named', async () => {
    const mail = jest.fn(async () => ({}))
    registerPluginPersonEraser(mail, { pluginId: 'mail' })
    registerPluginPersonRecordsEraser(
      {
        locate: async () => {
          throw new Error('store down')
        },
        erase: async () => ({}),
      },
      { pluginId: 'people' },
    )
    await expect(runPluginPersonErasure(TARGET, NONE)).rejects.toThrow('store down')
    expect(mail).not.toHaveBeenCalled()
  })
})

describe('a share the erasure promises (AGL-3080)', () => {
  it('refuses to start while a required eraser is not registered, and erases nothing', async () => {
    const mail = jest.fn(async () => ({}))
    registerPluginPersonEraser(mail, { pluginId: 'mail' })
    await expect(runPluginPersonErasure(TARGET, ['people', 'shop'])).rejects.toThrow(
      /refused: people, shop declared a required person eraser/,
    )
    expect(mail).not.toHaveBeenCalled()
  })

  it('counts the records eraser as registered', async () => {
    registerPluginPersonRecordsEraser({ locate: async () => [], erase: async () => ({ contacts: 0 }) }, { pluginId: 'people' })
    await expect(runPluginPersonErasure(TARGET, ['people'])).resolves.toMatchObject({
      reports: { people: { contacts: 0 } },
    })
  })

  it('fails the erasure after every share ran, when a required one threw', async () => {
    const after = jest.fn(async () => ({ ok: true }))
    registerPluginPersonEraser(
      async () => {
        throw new Error('orders unavailable')
      },
      { pluginId: 'shop' },
    )
    registerPluginPersonEraser(after, { pluginId: 'mail' })
    const people = { locate: async () => ['contact-1'], erase: jest.fn(async () => ({ contacts: 1 })) }
    registerPluginPersonRecordsEraser(people, { pluginId: 'people' })

    await expect(runPluginPersonErasure(TARGET, ['shop', 'people'])).rejects.toThrow(
      /incomplete: the required eraser of shop failed/,
    )
    // Everything else still ran — the retry has less to do, never more.
    expect(after).toHaveBeenCalled()
    expect(people.erase).toHaveBeenCalled()
  })

  it('is compiled from the plugins’ declarations, and stood in for a spec of the erasure’s own sweeps', async () => {
    expect(PLUGIN_REQUIRED_PERSON_ERASERS).toEqual(['bookings', 'commerce', 'crm', 'email'])
    standInRequiredPersonErasersForTests()
    expect((await runPluginPersonErasure(TARGET)).reports).toEqual({
      bookings: { standIn: true },
      commerce: { standIn: true },
      crm: { standIn: true },
      email: { standIn: true },
    })
  })
})
