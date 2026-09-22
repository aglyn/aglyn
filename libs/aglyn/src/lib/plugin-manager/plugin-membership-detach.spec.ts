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
  listPluginMembershipDetachers,
  registerPluginMembershipDetacher,
  resetPluginMembershipDetachersForTests,
  runPluginMembershipDetachers,
} from './plugin-membership-detach'

const REQUEST = { hostId: 'host-a', orgId: 'org-a', field: 'campaignIds', id: 'spring' }

beforeEach(() => {
  resetPluginMembershipDetachersForTests()
  setRegisteringPluginId(undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('plugin membership detachers (AGL-3254)', () => {
  it("runs two plugins' detachers in order, each report under its plugin", async () => {
    const seen: string[] = []
    setRegisteringPluginId('outreach')
    registerPluginMembershipDetacher(async ({ hostId, orgId, field, id }) => {
      seen.push(`outreach:${hostId}:${orgId}:${field}:${id}`)
      return { detached: 2, remaining: false }
    })
    setRegisteringPluginId(undefined)
    registerPluginMembershipDetacher(
      async ({ id }) => {
        seen.push(`surveys:${id}`)
        return { detached: 0, remaining: true }
      },
      { pluginId: 'acme-surveys' },
    )

    const reports = await runPluginMembershipDetachers(REQUEST)

    expect(seen).toEqual(['outreach:host-a:org-a:campaignIds:spring', 'surveys:spring'])
    expect(reports).toEqual({
      outreach: { detached: 2, remaining: false },
      'acme-surveys': { detached: 0, remaining: true },
    })
    expect(listPluginMembershipDetachers()).toEqual(['outreach', 'acme-surveys'])
  })

  it('isolates a detacher that throws, reports it as null, and runs the next', async () => {
    registerPluginMembershipDetacher(
      async () => {
        throw new Error('boom')
      },
      { pluginId: 'broken' },
    )
    const next = jest.fn(async () => ({ detached: 1, remaining: false }))
    registerPluginMembershipDetacher(next, { pluginId: 'fine' })

    const reports = await runPluginMembershipDetachers(REQUEST)

    expect(reports).toEqual({ broken: null, fine: { detached: 1, remaining: false } })
    expect(next).toHaveBeenCalledTimes(1)
    expect(console.error).toHaveBeenCalledTimes(1)
  })

  it('replaces a plugin’s earlier detacher rather than running it twice', async () => {
    const first = jest.fn(async () => ({ detached: 9, remaining: false }))
    const second = jest.fn(async () => ({ detached: 1, remaining: false }))
    registerPluginMembershipDetacher(first, { pluginId: 'outreach' })
    registerPluginMembershipDetacher(second, { pluginId: 'outreach' })

    const reports = await runPluginMembershipDetachers(REQUEST)

    expect(first).not.toHaveBeenCalled()
    expect(reports).toEqual({ outreach: { detached: 1, remaining: false } })
  })

  it('refuses a detacher with no owner', () => {
    expect(() => registerPluginMembershipDetacher(async () => ({ detached: 0, remaining: false }))).toThrow(
      /no owner/,
    )
  })

  it('reads a malformed report as zero detached and nothing remaining', async () => {
    registerPluginMembershipDetacher(async () => ({ detached: -3, remaining: 'yes' }) as never, {
      pluginId: 'odd',
    })
    expect(await runPluginMembershipDetachers(REQUEST)).toEqual({ odd: { detached: 0, remaining: false } })
  })
})
