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
  registerPluginPersonEraser,
  resetPluginPersonErasersForTests,
  runPluginPersonErasers,
} from './plugin-person-erasure'

const REQUEST = {
  orgId: 'org-a',
  email: 'pat@example.com',
  key: 'k'.repeat(64),
  contactIds: ['contact-1'],
  dryRun: false,
}

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

    const reports = await runPluginPersonErasers(REQUEST)

    expect(seen).toEqual(['mail:org-a:contact-1:false', 'surveys:64'])
    expect(reports).toEqual({
      mail: { enrollments: 2 },
      'acme-surveys': { responses: 1, anonymized: true },
    })
    expect(listPluginPersonErasers()).toEqual(['mail', 'acme-surveys'])
  })

  it('hands a dry run to every eraser as a dry run', async () => {
    const mail = jest.fn(async () => ({ enrollments: 3, deleted: null as number | null }))
    registerPluginPersonEraser(mail, { pluginId: 'mail' })

    expect(await runPluginPersonErasers({ ...REQUEST, dryRun: true })).toEqual({
      mail: { enrollments: 3, deleted: null },
    })
    expect(mail).toHaveBeenCalledWith({ ...REQUEST, dryRun: true })
  })

  it('hands each eraser its own copy of the contact ids', async () => {
    registerPluginPersonEraser(
      async (request) => {
        ;(request.contactIds as string[]).push('injected')
        return {}
      },
      { pluginId: 'greedy' },
    )
    const second = jest.fn(async () => ({}))
    registerPluginPersonEraser(second, { pluginId: 'polite' })

    await runPluginPersonErasers(REQUEST)

    expect(second).toHaveBeenCalledWith(REQUEST)
    expect(REQUEST.contactIds).toEqual(['contact-1'])
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

    const reports = await runPluginPersonErasers(REQUEST)

    expect(reports).toEqual({ mail: null, 'acme-surveys': { responses: 0 } })
    expect(surveys).toHaveBeenCalledWith(REQUEST)
    expect(console.error).toHaveBeenCalledWith(
      '[plugins] mail failed to erase a person in org org-a',
      expect.any(Error),
    )
    expect(JSON.stringify((console.error as jest.Mock).mock.calls[0][0])).not.toContain(REQUEST.email)
  })

  it("replaces a plugin's eraser in place when it registers again", async () => {
    registerPluginPersonEraser(async () => ({ run: 1 }), { pluginId: 'mail' })
    registerPluginPersonEraser(async () => ({ responses: 1 }), { pluginId: 'acme-surveys' })
    registerPluginPersonEraser(async () => ({ run: 2 }), { pluginId: 'mail' })

    expect(listPluginPersonErasers()).toEqual(['mail', 'acme-surveys'])
    expect(await runPluginPersonErasers(REQUEST)).toEqual({
      mail: { run: 2 },
      'acme-surveys': { responses: 1 },
    })
  })

  it('refuses an eraser with no owner', () => {
    expect(() => registerPluginPersonEraser(async () => ({}))).toThrow(/no owner/)
    expect(() => registerPluginPersonEraser(async () => ({}), { pluginId: ' ' })).toThrow(/no owner/)
  })

  it('answers an empty record when no plugin registered one', async () => {
    expect(await runPluginPersonErasers(REQUEST)).toEqual({})
  })
})
