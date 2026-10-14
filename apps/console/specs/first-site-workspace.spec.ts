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
 * AGL-3761 · the workspace a first site needs, made before the site.
 *
 * Named as the server names one it provisions itself (`ensureOrgForUser`),
 * tried once more under a suffixed address when its own is held, and counted
 * once, awaited, because the caller navigates next (AGL-2587).
 */

import { isValidOrgSlug } from '@aglyn/aglyn'

const mockFetch = jest.fn()
const mockTrack = jest.fn(async () => undefined)
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  trackEventBeforeNavigation: (...args: unknown[]) => mockTrack(...(args as [])),
}))
jest.mock('../utils/account-acquisition', () => ({ firstTouchField: () => ({}) }))

import {
  createFirstSiteWorkspace,
  firstSiteWorkspaceFallbackSlug,
  firstSiteWorkspaceName,
} from '../utils/first-site-workspace'

const answer = (status: number, body: unknown) => ({
  ok: status < 400,
  status,
  json: async () => body,
})
const bodyOf = (call: number) => JSON.parse(mockFetch.mock.calls[call][2].body)

beforeEach(() => {
  mockFetch.mockReset()
  mockTrack.mockClear()
})

describe('the first site’s workspace is named as the server would name it', () => {
  it('takes the account’s name, else its email’s local part, else "workspace"', () => {
    expect(firstSiteWorkspaceName({ displayName: ' Royal Styles ', email: 'x@y.z' })).toBe('Royal Styles')
    expect(firstSiteWorkspaceName({ displayName: '', email: 'jo.smith@example.com' })).toBe('jo.smith')
    expect(firstSiteWorkspaceName(null)).toBe('workspace')
  })

  it('suffixes an address that is held, and always answers a valid one', () => {
    expect(firstSiteWorkspaceFallbackSlug('Royal Styles', () => 0.5)).toMatch(/^royal-styles-[0-9a-z]{4}$/)
    expect(isValidOrgSlug(firstSiteWorkspaceFallbackSlug('Royal Styles'))).toBe(true)
    expect(isValidOrgSlug(firstSiteWorkspaceFallbackSlug('✨'))).toBe(true)
  })
})

describe('createFirstSiteWorkspace', () => {
  it('creates it, counts it once, and answers its address', async () => {
    mockFetch.mockResolvedValueOnce(answer(200, { orgId: 'org-1', slug: 'royal-styles' }))
    await expect(
      createFirstSiteWorkspace({ uid: 'u-1' } as never, { displayName: 'Royal Styles' }),
    ).resolves.toEqual({ slug: 'royal-styles' })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0][1]).toBe('/api/orgs/create')
    expect(bodyOf(0)).toEqual({ name: 'Royal Styles' })
    expect(mockTrack).toHaveBeenCalledTimes(1)
    expect(mockTrack).toHaveBeenCalledWith('org_created', {})
  })

  it('tries once more under a suffixed address when its own is held', async () => {
    mockFetch
      .mockResolvedValueOnce(answer(409, { error: 'That workspace URL is taken' }))
      .mockResolvedValueOnce(answer(200, { orgId: 'org-2', slug: 'royal-styles-a1b2' }))
    await expect(
      createFirstSiteWorkspace({ uid: 'u-1' } as never, { displayName: 'Royal Styles' }),
    ).resolves.toEqual({ slug: 'royal-styles-a1b2' })
    expect(bodyOf(1).slug).toMatch(/^royal-styles-[0-9a-z]{4}$/)
    expect(mockTrack).toHaveBeenCalledTimes(1)
  })

  it('says why it could not, and counts nothing', async () => {
    mockFetch.mockResolvedValueOnce(answer(429, { error: 'Too many new workspaces' }))
    await expect(
      createFirstSiteWorkspace({ uid: 'u-1' } as never, { displayName: 'Royal Styles' }),
    ).resolves.toEqual({ error: 'Too many new workspaces' })
    mockFetch.mockRejectedValueOnce(new Error('offline'))
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(
      createFirstSiteWorkspace({ uid: 'u-1' } as never, { displayName: 'Royal Styles' }),
    ).resolves.toEqual({ error: 'Your workspace could not be set up. Try again.' })
    logged.mockRestore()
    expect(mockTrack).not.toHaveBeenCalled()
  })
})
