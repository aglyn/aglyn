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

// The pure joins are under test; the SDK's ESM build is not needed for them.
jest.mock('firebase/firestore', () => ({}))

import { mobileConfigProblems, normalizeConsoleOrigin, readMobileConfig } from './config'
import { endConsoleSession, mintConsoleSession } from './console-session'
import { consoleSitePageUrl, joinWorkspaceSites } from './site-links'

describe('readMobileConfig', () => {
  it('defaults the console and hides Google until both client ids exist', () => {
    const config = readMobileConfig({ EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'ios' }, 'aglyn-pos')
    expect(config.consoleOrigin).toBe('https://app.aglyn.com')
    expect(config.google).toBeNull()
    expect(mobileConfigProblems(config)).toHaveLength(4)
  })

  it('reads emulator hosts only as host:port', () => {
    const config = readMobileConfig({
      EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: 'http://127.0.0.1:9099',
      EXPO_PUBLIC_FIRESTORE_EMULATOR_HOST: 'not a host',
    }, 'aglyn')
    expect(config.authEmulatorHost).toBe('127.0.0.1:9099')
    expect(config.firestoreEmulatorHost).toBeNull()
  })

  it('refuses an emulator under a live console', () => {
    const config = readMobileConfig(
      {
        EXPO_PUBLIC_CONSOLE_URL: 'https://app.aglyn.com',
        EXPO_PUBLIC_FIREBASE_API_KEY: 'k',
        EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: 'd',
        EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'p',
        EXPO_PUBLIC_FIREBASE_APP_ID: 'a',
        EXPO_PUBLIC_FIRESTORE_EMULATOR_HOST: '127.0.0.1:8082',
      },
      'aglyn',
    )
    expect(mobileConfigProblems(config)).toEqual(['The Firestore emulator is set for a non-local console.'])
  })

  it('allows http only for a local stack', () => {
    expect(normalizeConsoleOrigin('http://localhost:4200/')).toBe('http://localhost:4200')
    expect(normalizeConsoleOrigin('https://Studio.Example.com')).toBe('https://studio.example.com')
    expect(() => normalizeConsoleOrigin('http://app.aglyn.com')).toThrow(/https/)
    expect(() => normalizeConsoleOrigin('https://app.aglyn.com/path')).toThrow(/origin/)
  })
})

describe('console session', () => {
  it('mints with the ID token on the console route, cookies included', async () => {
    const fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response)
    await expect(mintConsoleSession({ origin: 'https://app.aglyn.com', idToken: 'tok', fetch })).resolves.toEqual({ ok: true })
    expect(fetch).toHaveBeenCalledWith('https://app.aglyn.com/api/auth/session', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok', Accept: 'application/json' },
      credentials: 'include',
    })
  })

  it('passes the route refusal through (unverified email)', async () => {
    const fetch = jest.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'Verify your email' }) }) as Response)
    await expect(mintConsoleSession({ origin: 'https://app.aglyn.com', idToken: 'tok', fetch })).resolves.toEqual({
      ok: false,
      status: 403,
      error: 'Verify your email',
    })
  })

  it('reports an unreachable server', async () => {
    const fetch = jest.fn(async () => {
      throw new Error('offline')
    })
    await expect(mintConsoleSession({ origin: 'https://app.aglyn.com', idToken: 'tok', fetch })).resolves.toMatchObject({
      ok: false,
      status: 0,
    })
  })

  it('ends with the route DELETE and never throws', async () => {
    const fetch = jest.fn(async () => {
      throw new Error('offline')
    })
    await expect(endConsoleSession({ origin: 'https://app.aglyn.com', fetch })).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledWith('https://app.aglyn.com/api/auth/session', { method: 'DELETE', credentials: 'include' })
  })
})

describe('joinWorkspaceSites', () => {
  it('joins sites to their workspace and drops what the console cannot address', () => {
    const sites = joinWorkspaceSites(
      [
        { id: 'o1', slug: 'acme', orgName: 'Acme' },
        { id: 'o2', orgName: 'No slug' },
      ],
      [
        { id: 'h2', orgId: 'o1', subdomain: 'zed', displayName: 'Zed Shop', role: 'editor' },
        { id: 'h1', orgId: 'o1', subdomain: 'alpha', role: 'admin' },
        { id: 'h3', orgId: 'o2', subdomain: 'hidden', role: 'admin' },
        { id: 'h4', orgId: 'o1', role: 'admin' },
        { id: 'h5', orgId: 'o1', subdomain: 'odd', role: 'owner' },
      ],
    )
    expect(sites.map((site) => [site.hostId, site.name, site.role])).toEqual([
      ['h1', 'alpha', 'admin'],
      ['h5', 'odd', null],
      ['h2', 'Zed Shop', 'editor'],
    ])
  })
})

describe('consoleSitePageUrl', () => {
  it('builds the console host route with each segment encoded', () => {
    expect(
      consoleSitePageUrl('https://app.aglyn.com/', { orgSlug: 'acme', subdomain: 'shop' }, '/pos', { register: 'r 1' }),
    ).toBe('https://app.aglyn.com/acme/hosts/shop/pos?register=r%201')
    expect(consoleSitePageUrl('https://app.aglyn.com', { orgSlug: '../x', subdomain: 'a/b' }, 'pos')).toBe(
      'https://app.aglyn.com/..%2Fx/hosts/a%2Fb/pos',
    )
  })
})
