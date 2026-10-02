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
 * The form door, asked without writing (AGL-2586, AGL-3080): what the funnel
 * probe on `/api/health/funnel` learns about the next submission, from this
 * plugin's own gates over the month's count the door reads — the site's
 * Forms switch, then the plan's allowance, then the flood ceiling, in the
 * order the door clears them.
 */

let mockMonthCount: number | undefined
const mockCounterReads: string[] = []

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (root: string) => ({
          doc: (hostId: string) => ({
            collection: (sub: string) => ({
              doc: (id: string) => ({
                get: async () => {
                  mockCounterReads.push(`${root}/${hostId}/${sub}/${id}`)
                  return { get: () => mockMonthCount }
                },
              }),
            }),
          }),
        }),
      }),
    }),
  },
}))

import { pluginIntakeGate } from '@aglyn/aglyn/plugin-manager/plugin-intake-gates'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { registerFormsServerDeclarations } from '../declarations.server'
import { formIntakeGate } from './form-intake-gate'

const starter = { plan: 'starter' }
const free = { plan: 'free' }

beforeEach(() => {
  mockMonthCount = undefined
  mockCounterReads.length = 0
  resetPluginServicesForTests()
})

describe('the form door’s intake gate', () => {
  it('is open on a site that would take the next submission', async () => {
    mockMonthCount = 3
    expect(await formIntakeGate({ hostId: 'h1', host: {}, org: starter })).toBe('open')
    expect(mockCounterReads).toEqual(['hosts/h1/counters/formSubmissions'])
  })

  it('is switched off on a site that turned Forms off, before reading any count', async () => {
    expect(
      await formIntakeGate({ hostId: 'h1', host: { disabledPlugins: ['forms'] }, org: starter }),
    ).toBe('switched-off')
    expect(mockCounterReads).toEqual([])
  })

  it('walls a plan that has spent its allowance and is not sold past it', async () => {
    mockMonthCount = 20
    expect(await formIntakeGate({ hostId: 'h1', host: {}, org: free })).toBe('plan-exhausted')
    mockMonthCount = 19
    expect(await formIntakeGate({ hostId: 'h1', host: {}, org: free })).toBe('open')
  })

  it('trips the flood ceiling at the ceiling, not one past it', async () => {
    mockMonthCount = 5_000
    expect(await formIntakeGate({ hostId: 'h1', host: {}, org: starter })).toBe('flood-ceiling')
    mockMonthCount = 4_999
    expect(await formIntakeGate({ hostId: 'h1', host: {}, org: starter })).toBe('open')
  })

  it('is registered for the `form` door from this plugin’s server declarations', async () => {
    registerFormsServerDeclarations()
    const door = pluginIntakeGate('form')
    expect(door?.pluginId).toBe('forms')
    mockMonthCount = 0
    expect(await door?.gate({ hostId: 'h1', host: {}, org: starter })).toBe('open')
  })
})
