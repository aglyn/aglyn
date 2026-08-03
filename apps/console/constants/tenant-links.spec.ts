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

import {
  buildScreenLiveUrl,
  hostDisplayDomain,
  isLocalConsole,
  isPreviewConsole,
} from './tenant-links'

const host = {
  subdomain: 'aglyn-marketing',
  screens: { 'scr-1': '/product/besigner', 'scr-home': '/' },
} as any


describe('tenant-links', () => {
  describe('isLocalConsole (AGL-1204)', () => {
    it('matches localhost and its subdomains only', () => {
      expect(isLocalConsole('localhost')).toBe(true)
      expect(isLocalConsole('app.localhost')).toBe(true)
      expect(isLocalConsole('aglyn-console.vercel.app')).toBe(false)
      expect(isLocalConsole('app.aglyn.com')).toBe(false)
    })

    it('is a subset of isPreviewConsole, which still covers both', () => {
      for (const hostname of ['localhost', 'app.localhost']) {
        expect(isPreviewConsole(hostname)).toBe(true)
      }
    })
  })

  describe('buildScreenLiveUrl', () => {
    it('sends a LOCAL console to the local tenant, not the Vercel preview', () => {
      const hostname = 'localhost'
      const url = buildScreenLiveUrl(host, 'scr-1' as any, hostname)
      // The bug: a local console linked at the remote preview deployment, so
      // every Live link 404'd for work that had not been deployed yet.
      expect(url).toBe(
        'http://localhost:4500/product/besigner?tenantHost=aglyn-marketing',
      )
      expect(url).not.toContain('vercel.app')
    })

    it('still sends a deployed preview console to the tenant preview host', () => {
      const hostname = 'aglyn-console-git-main-aglyn.vercel.app'
      expect(buildScreenLiveUrl(host, 'scr-1' as any, hostname)).toContain(
        'https://aglyn-tenant-git-main-aglyn.vercel.app/',
      )
    })

    it('uses the production domain from a production console', () => {
      const hostname = 'app.aglyn.com'
      expect(buildScreenLiveUrl(host, 'scr-1' as any, hostname)).toBe(
        'https://aglyn-marketing.aglyn.app/product/besigner',
      )
    })

    it('serves the home screen at the origin root', () => {
      expect(buildScreenLiveUrl(host, 'scr-home' as any, 'app.aglyn.com')).toBe(
        'https://aglyn-marketing.aglyn.app/',
      )
    })

    it('returns undefined for a screen with no published route', () => {
      const hostname = 'localhost'
      expect(buildScreenLiveUrl(host, 'scr-missing' as any, hostname)).toBeUndefined()
    })
  })

  it('hostDisplayDomain prefers the custom domain', () => {
    expect(hostDisplayDomain({ cname: 'aglyn.com', subdomain: 'x' })).toBe(
      'aglyn.com',
    )
    expect(hostDisplayDomain({ subdomain: 'x' })).toBe('x.aglyn.app')
    expect(hostDisplayDomain(undefined)).toBeUndefined()
  })
})
