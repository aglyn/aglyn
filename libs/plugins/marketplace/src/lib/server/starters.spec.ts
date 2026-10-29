/**
 * @jest-environment node
 */
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
 * THE STARTER SEARCH'S GATES, IN ORDER, AND WHAT IT HANDS OVER (AGL-4049).
 *
 * `GET /api/marketplace/starters` is the list "Choose your starter" draws.
 * What this file has to catch:
 *
 *  - a gate out of order. Each refusal is asserted against the log of what
 *    the route READ, so a gate that moved after a read it should precede —
 *    the flag after the source, the permission after the flag — is red even
 *    when the status it answers is still right;
 *  - the release flag leaking. Off for the workspace, the source is never
 *    resolved and never searched, and the words are the create route's own;
 *    staff pass it without it being asked at all;
 *  - more than a summary leaving. The source double hands back a paid AI
 *    starter's answers and a starter's pages beside each row, and the answer
 *    must carry neither.
 */

const calls: string[] = []
const mockVerifyIdToken = jest.fn()
const mockResolveOrgMembership = jest.fn()
const mockMemberHasOrgPermission = jest.fn()
const mockFlagOn = jest.fn()
const mockResolveSource = jest.fn()
const mockRepair = jest.fn()
const mockSearch = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => {
          calls.push('token')
          return mockVerifyIdToken(...args)
        },
      }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  resolveOrgMembership: (...args: unknown[]) => {
    calls.push('membership')
    return mockResolveOrgMembership(...args)
  },
  memberHasOrgPermission: (...args: unknown[]) => {
    calls.push('permission')
    return mockMemberHasOrgPermission(...args)
  },
  isServerReleaseFlagOnForOrg: (...args: unknown[]) => {
    calls.push('flag')
    return mockFlagOn(...args)
  },
}))
jest.mock('@aglyn/tenant-data-admin/server/id-token-refusal', () => ({
  invalidIdTokenResponse: (error: { code?: string }) =>
    error?.code === 'auth/argument-error'
      ? Response.json({ error: 'Unauthenticated' }, { status: 401 })
      : null,
}))
jest.mock('@aglyn/aglyn/plugin-manager/plugin-site-starters', () => ({
  resolveSiteStarterSource: () => {
    calls.push('source')
    return mockResolveSource()
  },
  // The real best-effort reader, so the route is held to what it promises.
  describeSiteStarter: jest.requireActual('@aglyn/aglyn/plugin-manager/plugin-site-starters')
    .describeSiteStarter,
}))
jest.mock('@aglyn/aglyn/plugin-manager/plugin-declarations-repair', () => ({
  runPluginDeclarationsRepair: () => {
    calls.push('repair')
    return mockRepair()
  },
}))
jest.mock('@aglyn/aglyn/plugin-manager/plugin-theme-presets', () => ({
  listServerThemePresets: () => [
    { id: 'theme-presets.material3', name: 'Material 3', theme: {} },
    { id: 'theme-presets.starter', name: 'Starter', theme: {} },
    { id: 'themes.someone-else', name: 'Not a base', theme: {} },
  ],
}))

import { SITE_STARTER_SEARCH_MAX } from '../model/site-starter-listing'
import {
  marketplaceStarterAnswers,
  marketplaceStarters,
  SITE_STARTERS_UNAVAILABLE,
  SITE_STARTERS_UNRELEASED,
} from './starters'

const MEMBER = { role: 'owner', allHosts: true }

const SUMMARY = {
  listingId: 'fp-starter-restaurant-base',
  displayName: 'Corner bistro',
  description: 'A starter',
  authorName: 'Aglyn',
  official: true,
  priceUsd: 0,
  previewImageUrl: 'https://console.example/_static/starter/styles/restaurant.webp',
  facets: { kind: 'restaurant', base: 'starter', fonts: 'jakarta', pages: 4, mode: 'base' },
  category: 'Restaurant & café',
}

const ask = (query = 'orgId=org-1', init: RequestInit & { token?: string | null } = {}) => {
  const { token = 'member-token', ...rest } = init
  return marketplaceStarters(
    new Request(`https://console.aglyn.com/api/marketplace/starters?${query}`, {
      ...rest,
      headers: token === null ? {} : { authorization: `Bearer ${token}` },
    }),
  )
}

const bodyOf = async (response: Response) => (await response.json()) as Record<string, any>

beforeEach(() => {
  calls.length = 0
  mockVerifyIdToken.mockReset().mockResolvedValue({
    uid: 'member-1',
    email: 'member@example.com',
    email_verified: true,
  })
  mockResolveOrgMembership.mockReset().mockResolvedValue({ orgId: 'org-1', member: MEMBER })
  mockMemberHasOrgPermission.mockReset().mockResolvedValue(true)
  mockFlagOn.mockReset().mockResolvedValue(true)
  mockSearch.mockReset().mockImplementation(async () => {
    calls.push('search')
    return [SUMMARY]
  })
  mockResolveSource.mockReset().mockReturnValue({ search: mockSearch, resolve: jest.fn() })
  mockRepair.mockReset().mockResolvedValue(true)
})

describe('the gates, in order, each before the next is read', () => {
  it('401s with no bearer token, having read nothing', async () => {
    const response = await ask('orgId=org-1', { token: null })
    expect(response.status).toBe(401)
    expect(calls).toEqual([])
  })

  it('401s for a token the verifier refuses', async () => {
    mockVerifyIdToken.mockRejectedValue(Object.assign(new Error('bad'), { code: 'auth/argument-error' }))
    const response = await ask()
    expect(response.status).toBe(401)
    expect(calls).toEqual(['token'])
  })

  it('403s an unverified address before the workspace is read', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'member-1', email_verified: false })
    const response = await ask()
    expect(response.status).toBe(403)
    expect(calls).toEqual(['token'])
  })

  it('400s a search that names no workspace, before any membership is read', async () => {
    const response = await ask('mode=base')
    expect(response.status).toBe(400)
    expect(await bodyOf(response)).toEqual({ error: 'Missing orgId' })
    expect(calls).toEqual(['token'])
  })

  it('400s a facet no starter can carry', async () => {
    const response = await ask('orgId=org-1&base=windows95')
    expect(response.status).toBe(400)
    expect(await bodyOf(response)).toEqual({ error: 'Unknown base theme' })
    expect(calls).toEqual(['token'])
  })

  it('403s a caller who is not a member, before the permission is read', async () => {
    mockResolveOrgMembership.mockResolvedValue(null)
    const response = await ask()
    expect(response.status).toBe(403)
    expect(mockResolveOrgMembership).toHaveBeenCalledWith('member-1', 'org-1')
    expect(calls).toEqual(['token', 'membership'])
  })

  it('403s a member without "Create sites", naming the permission and never a role, before the flag is read', async () => {
    mockMemberHasOrgPermission.mockResolvedValue(false)
    const response = await ask()
    expect(response.status).toBe(403)
    const { error } = await bodyOf(response)
    expect(error).toContain('"Create sites"')
    expect(error).not.toMatch(/\b(owner|admin role|editor|viewer)\b/i)
    expect(mockMemberHasOrgPermission).toHaveBeenCalledWith('org-1', MEMBER, 'hosts.create')
    expect(calls).toEqual(['token', 'membership', 'permission'])
  })

  it('403s with the flag off, in the create route’s words, before the source is read', async () => {
    mockFlagOn.mockResolvedValue(false)
    const response = await ask()
    expect(response.status).toBe(403)
    expect(await bodyOf(response)).toEqual({ error: SITE_STARTERS_UNRELEASED })
    expect(SITE_STARTERS_UNRELEASED).toBe('Site starters are not available for this workspace yet')
    // The flag is asked about the membership's workspace, by its own key.
    expect(mockFlagOn).toHaveBeenCalledWith('release_site_starters', 'org-1')
    expect(calls).toEqual(['token', 'membership', 'permission', 'flag'])
    expect(mockResolveSource).not.toHaveBeenCalled()
    expect(mockSearch).not.toHaveBeenCalled()
  })

  it('lets staff past the flag without asking it, and still asks their workspace permission', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'staff-1', email_verified: true, staff: true })
    mockFlagOn.mockResolvedValue(false)
    const response = await ask()
    expect(response.status).toBe(200)
    expect(calls).toEqual(['token', 'membership', 'permission', 'source', 'search'])
    expect(mockFlagOn).not.toHaveBeenCalled()
  })

  it('503s when no plugin serves starters, after asking the app to run its declarations once', async () => {
    mockResolveSource.mockReturnValue(null)
    const response = await ask()
    expect(response.status).toBe(503)
    expect(await bodyOf(response)).toEqual({ error: SITE_STARTERS_UNAVAILABLE })
    expect(calls).toEqual(['token', 'membership', 'permission', 'flag', 'source', 'repair', 'source'])
  })

  it('answers once the repair registers a source', async () => {
    mockResolveSource
      .mockReturnValueOnce(null)
      .mockReturnValue({ search: mockSearch, resolve: jest.fn() })
    const response = await ask()
    expect(response.status).toBe(200)
    expect(calls).toEqual([
      'token',
      'membership',
      'permission',
      'flag',
      'source',
      'repair',
      'source',
      'search',
    ])
  })

  it('refuses anything but GET', async () => {
    const response = await ask('orgId=org-1', { method: 'POST' })
    expect(response.status).toBe(405)
    expect(calls).toEqual([])
  })
})

describe('what it answers', () => {
  it('asks the source the search as read, for the membership’s workspace and the caller', async () => {
    await ask('orgId=org-1&mode=ai&q=%20bistro%20&kind=restaurant&fonts=inter&limit=7')
    expect(mockSearch).toHaveBeenCalledWith(
      {
        word: 'bistro',
        filter: { mode: 'ai', kind: 'restaurant', fonts: 'inter' },
        limit: 7,
      },
      { orgId: 'org-1', uid: 'member-1' },
    )
  })

  it('hands over summaries only — never an AI starter’s answers, its pages or its theme', async () => {
    mockSearch.mockResolvedValue([
      {
        ...SUMMARY,
        answers: { brief: 'what the buyer pays for' },
        screens: [{ slug: '/' }],
        layout: { name: 'Header and footer' },
        theme: { kind: 'full', theme: {} },
      },
    ])
    const response = await ask()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = await bodyOf(response)
    expect(body.rows).toEqual([SUMMARY])
    const raw = JSON.stringify(body)
    for (const leaked of ['answers', 'screens', 'layout', 'what the buyer pays for']) {
      expect(raw).not.toContain(leaked)
    }
  })

  it('names each built-in theme by its preset and each font pairing by its families', async () => {
    const { labels } = await bodyOf(await ask())
    expect(labels.base).toEqual({ starter: 'Starter', material3: 'Material 3' })
    expect(labels.fonts.inter).toBe('Inter')
    // A pairing of two families names both.
    expect(Object.values(labels.fonts as Record<string, string>).some((name) => name.includes(' & '))).toBe(true)
  })

  it('answers no more rows than were asked, whatever the source hands back', async () => {
    mockSearch.mockResolvedValue(
      Array.from({ length: 5 }, (_, index) => ({ ...SUMMARY, listingId: `s-${index}` })),
    )
    const { rows } = await bodyOf(await ask('orgId=org-1&limit=2'))
    expect(rows.map((row: { listingId: string }) => row.listingId)).toEqual(['s-0', 's-1'])
  })

  it('asks for the most a search answers when no limit is named', async () => {
    await ask()
    expect(mockSearch.mock.calls[0][0].limit).toBe(SITE_STARTER_SEARCH_MAX)
  })

  it('500s, in its own words, when the search fails', async () => {
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    mockSearch.mockRejectedValue(new Error('index missing: projects/x/indexes/y'))
    const response = await ask()
    expect(response.status).toBe(500)
    expect(await bodyOf(response)).toEqual({ error: 'Starters could not be loaded' })
    quiet.mockRestore()
  })
})

describe('a pick restored on the way back from paying for it (AGL-4049 lane 3)', () => {
  const PAID = { ...SUMMARY, listingId: 'northwind-studio', official: false, priceUsd: 12, owned: true }

  it('lists the named starter first, as the source describes it for this viewer, and once', async () => {
    const describe = jest.fn(async () => PAID)
    mockSearch.mockResolvedValue([SUMMARY, { ...PAID, owned: false }])
    mockResolveSource.mockReturnValue({ search: mockSearch, resolve: jest.fn(), describe })
    const { rows } = await bodyOf(await ask('orgId=org-1&include=northwind-studio'))
    expect(describe).toHaveBeenCalledWith({ listingId: 'northwind-studio' }, { orgId: 'org-1', uid: 'member-1' })
    expect(rows).toEqual([PAID, SUMMARY])
  })

  it('lists nothing extra for a starter this viewer may not pick, or a source that cannot describe one', async () => {
    mockResolveSource.mockReturnValue({ search: mockSearch, resolve: jest.fn(), describe: async () => null })
    expect((await bodyOf(await ask('orgId=org-1&include=gone'))).rows).toEqual([SUMMARY])
    mockResolveSource.mockReturnValue({ search: mockSearch, resolve: jest.fn() })
    expect((await bodyOf(await ask('orgId=org-1&include=gone'))).rows).toEqual([SUMMARY])
  })

  it('never describes anything for a caller the gates refuse', async () => {
    const describe = jest.fn(async () => PAID)
    mockResolveSource.mockReturnValue({ search: mockSearch, resolve: jest.fn(), describe })
    mockFlagOn.mockResolvedValue(false)
    expect((await ask('orgId=org-1&include=northwind-studio')).status).toBe(403)
    expect(describe).not.toHaveBeenCalled()
  })

  it('400s an id no listing can have', async () => {
    expect((await ask('orgId=org-1&include=a%2Fb')).status).toBe(400)
  })
})

/**
 * `GET /api/marketplace/starters/answers` (AGL-4049 phase 4): the answers an
 * AI starter carries, which fill the AI start's questions. They are what a
 * paid AI starter sells, so they come out of the seam's purchase-gated
 * `resolve` only, behind every gate the search holds, in the same order.
 */
describe('an AI starter’s answers', () => {
  const mockResolve = jest.fn()
  const ANSWERS = { kind: 'restaurant', style: { base: 'starter' }, fonts: 'inter', brandColors: { primary: '#8a3b12' }, pages: 4, brief: '' }
  const FACETS = { kind: 'restaurant', base: 'starter', fonts: 'inter', pages: 1, mode: 'ai' }
  const PAYLOAD = {
    mode: 'ai',
    facets: FACETS,
    theme: { kind: 'builtin', base: 'starter', brand: { light: {} }, fonts: 'inter' },
    screens: [{ displayName: 'Home', slug: '/', nodes: { secret: { componentId: 'text' } } }],
    layout: { displayName: 'Header and footer', nodes: {} },
    answers: ANSWERS,
  }
  const askAnswers = (query = 'orgId=org-1&listingId=fp-starter-restaurant-ai', init: RequestInit & { token?: string | null } = {}) => {
    const { token = 'member-token', ...rest } = init
    return marketplaceStarterAnswers(
      new Request(`https://console.aglyn.com/api/marketplace/starters/answers?${query}`, {
        ...rest,
        headers: token === null ? {} : { authorization: `Bearer ${token}` },
      }),
    )
  }

  beforeEach(() => {
    mockResolve.mockReset().mockImplementation(async () => {
      calls.push('resolve')
      return PAYLOAD
    })
    mockResolveSource.mockReturnValue({ search: mockSearch, resolve: mockResolve })
  })

  it('answers the starter’s answers and facets, for the membership’s workspace and the caller, and nothing else', async () => {
    const response = await askAnswers()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await bodyOf(response)).toEqual({ answers: ANSWERS, facets: FACETS })
    expect(mockResolve).toHaveBeenCalledWith({ listingId: 'fp-starter-restaurant-ai' }, { orgId: 'org-1', uid: 'member-1' })
    expect(calls).toEqual(['token', 'membership', 'permission', 'flag', 'source', 'resolve'])
  })

  it('holds the search’s gates, in the same order, each before the next is read', async () => {
    expect((await askAnswers(undefined, { token: null })).status).toBe(401)
    expect(calls).toEqual([])

    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'member-1', email_verified: false })
    expect((await askAnswers()).status).toBe(403)

    calls.length = 0
    const unnamed = await askAnswers('orgId=org-1')
    expect(unnamed.status).toBe(400)
    expect(await bodyOf(unnamed)).toEqual({ error: 'Unknown starter' })
    expect((await askAnswers('listingId=fp-starter-restaurant-ai')).status).toBe(400)
    expect((await askAnswers('orgId=org-1&listingId=a%2Fb')).status).toBe(400)
    expect(calls).toEqual(['token', 'token', 'token'])

    calls.length = 0
    mockResolveOrgMembership.mockResolvedValueOnce(null)
    expect((await askAnswers()).status).toBe(403)
    expect(calls).toEqual(['token', 'membership'])

    calls.length = 0
    mockMemberHasOrgPermission.mockResolvedValueOnce(false)
    const unpermitted = await askAnswers()
    expect(unpermitted.status).toBe(403)
    expect((await bodyOf(unpermitted)).error).toContain('"Create sites"')
    expect(calls).toEqual(['token', 'membership', 'permission'])

    calls.length = 0
    mockFlagOn.mockResolvedValueOnce(false)
    const unreleased = await askAnswers()
    expect(unreleased.status).toBe(403)
    expect(await bodyOf(unreleased)).toEqual({ error: SITE_STARTERS_UNRELEASED })
    expect(calls).toEqual(['token', 'membership', 'permission', 'flag'])

    calls.length = 0
    mockResolveSource.mockReturnValue(null)
    expect((await askAnswers()).status).toBe(503)
    expect(mockResolve).not.toHaveBeenCalled()
  })

  it('lets staff past the flag without asking it', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'staff-1', email_verified: true, staff: true })
    mockFlagOn.mockResolvedValue(false)
    expect((await askAnswers()).status).toBe(200)
    expect(mockFlagOn).not.toHaveBeenCalled()
  })

  it('402s a priced starter this workspace has not bought, with its price, and hands over no answers', async () => {
    mockResolve.mockResolvedValue({ error: 'Purchase required', status: 402, priceUsd: 12 })
    const response = await askAnswers()
    expect(response.status).toBe(402)
    const body = await bodyOf(response)
    expect(body).toEqual({
      error: 'Purchase required',
      code: 'purchase_required',
      listingId: 'fp-starter-restaurant-ai',
      priceUsd: 12,
    })
  })

  it.each([403, 404] as const)('passes a %i from the source on', async (status) => {
    mockResolve.mockResolvedValue({ error: 'No', status })
    const response = await askAnswers()
    expect(response.status).toBe(status)
    expect(await bodyOf(response)).toEqual({ error: 'No', listingId: 'fp-starter-restaurant-ai' })
  })

  it('409s a starter site, which has no questions to fill', async () => {
    mockResolve.mockResolvedValue({ ...PAYLOAD, mode: 'base', facets: { ...FACETS, mode: 'base' }, answers: undefined })
    const response = await askAnswers()
    expect(response.status).toBe(409)
    expect(await bodyOf(response)).toEqual({
      error: 'This starter is a ready-made site, with no questions to answer',
      listingId: 'fp-starter-restaurant-ai',
    })
  })

  it('never hands over a starter’s pages, layout or theme', async () => {
    const raw = JSON.stringify(await bodyOf(await askAnswers()))
    for (const leaked of ['screens', 'layout', 'secret', 'theme']) expect(raw).not.toContain(leaked)
  })

  it('refuses anything but GET, and 500s in its own words when the source fails', async () => {
    expect((await askAnswers(undefined, { method: 'POST' })).status).toBe(405)
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    mockResolve.mockRejectedValue(new Error('down'))
    const response = await askAnswers()
    expect(response.status).toBe(500)
    expect(await bodyOf(response)).toEqual({ error: 'This starter could not be read' })
    quiet.mockRestore()
  })
})
