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

import { isFirstPartyHost } from '@aglyn/shared-util-first-touch'
import {
  builtInFirstPartyHosts,
  FIRST_PARTY_HOSTS_MAX,
  mergeFirstPartyHosts,
  normalizeFirstPartyHostEntry,
  type PlatformHostInputs,
} from './first-party-hosts'

const production: PlatformHostInputs = {
  workspaceDomain: 'example.com',
  consoleUrl: 'https://app.example.com',
  docsUrl: 'https://docs.example.com',
  homeUrl: 'https://example.com',
  tenantDomain: 'example.app',
  development: false,
}

describe('the built-in registry', () => {
  it('covers the workspace domain and everything under it, from configuration alone', () => {
    const hosts = builtInFirstPartyHosts(production)
    expect(hosts).toEqual(['example.com', '*.example.com', 'app.example.com', 'docs.example.com', 'www.example.com'])
    for (const host of ['example.com', 'www.example.com', 'app.example.com', 'auth.example.com', 'acme.example.com']) {
      expect(isFirstPartyHost(host, hosts)).toBe(true)
    }
  })

  it('never counts a customer site as ours', () => {
    const hosts = builtInFirstPartyHosts(production)
    expect(isFirstPartyHost('shop.example.app', hosts)).toBe(false)
  })

  it('excludes a tenant domain an install nests under its own', () => {
    const hosts = builtInFirstPartyHosts({ ...production, tenantDomain: 'sites.example.com' })
    expect(isFirstPartyHost('app.example.com', hosts)).toBe(true)
    expect(isFirstPartyHost('shop.sites.example.com', hosts)).toBe(false)
    expect(isFirstPartyHost('sites.example.com', hosts)).toBe(false)
  })

  it('names console, docs and home hosts that live on other apexes', () => {
    const hosts = builtInFirstPartyHosts({
      ...production,
      consoleUrl: 'https://console.example-app.io',
      docsUrl: 'https://example.dev/docs',
      homeUrl: 'https://www.example.org',
    })
    for (const host of ['console.example-app.io', 'example.dev', 'www.example.org']) {
      expect(isFirstPartyHost(host, hosts)).toBe(true)
    }
    expect(isFirstPartyHost('other.example-app.io', hosts)).toBe(false)
  })

  it('adds localhost only in development', () => {
    expect(builtInFirstPartyHosts({ ...production, development: true })).toEqual(
      expect.arrayContaining(['localhost', '*.localhost']),
    )
    expect(builtInFirstPartyHosts(production)).not.toContain('localhost')
  })

  it('is empty rather than wrong when nothing is configured', () => {
    expect(
      builtInFirstPartyHosts({
        workspaceDomain: null,
        consoleUrl: null,
        docsUrl: null,
        homeUrl: null,
        tenantDomain: null,
        development: false,
      }),
    ).toEqual([])
  })
})

describe('what staff may register', () => {
  it.each([
    ['forum.example.com', 'forum.example.com'],
    [' https://Status.Example.com/incidents ', 'status.example.com'],
    ['*.example.community', '*.example.community'],
    ['!*.sites.example.com', '!*.sites.example.com'],
    ['status.example.com/', 'status.example.com'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeFirstPartyHostEntry(input)).toBe(expected)
  })

  it.each(['com', '*.com', '', 'not a host', '!', 42])('refuses %p', (input) => {
    expect(normalizeFirstPartyHostEntry(input)).toBe('')
  })

  it('merges, de-duplicates and caps the configured list after the built-in one', () => {
    const configured = ['forum.example.com', 'example.com', 'bad host', ...Array.from({ length: 60 }, (_, i) => `h${i}.example.net`)]
    const merged = mergeFirstPartyHosts(['example.com', '*.example.com'], configured)
    expect(merged.slice(0, 3)).toEqual(['example.com', '*.example.com', 'forum.example.com'])
    expect(merged).not.toContain('bad host')
    expect(merged.length).toBeLessThanOrEqual(2 + FIRST_PARTY_HOSTS_MAX)
    expect(mergeFirstPartyHosts(['example.com'], 'not a list')).toEqual(['example.com'])
  })
})
