/**
 * @jest-environment node
 *
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

/**
 * Discovery (AGL-3963): the zone a typed domain sits in, and whether its DNS
 * provider applies our template. Every failure is the same quiet answer —
 * `supported: false` — because the button only ever helps and its absence
 * leaves the printed records, which always work.
 */

import {
  discoverDomainConnect,
  domainConnectZoneOf,
  parseDomainConnectSettings,
  resetDomainConnectDiscoveryCache,
  type DomainConnectDiscoveryDeps,
} from './discovery'

const SETTINGS = {
  providerId: 'provider.example',
  providerName: 'Provider',
  providerDisplayName: 'Provider DNS',
  urlSyncUX: 'https://dash.provider.example/domainconnect',
  urlAPI: 'https://api.provider.example/domainconnect',
  width: 640,
  height: 700,
}

interface World {
  txt: { answered: boolean; records: string[] } | Error
  replies: Record<string, { status: number; body: string | null } | { refused: true } | Error>
}

function deps(world: World) {
  const asked: string[] = []
  const fake: DomainConnectDiscoveryDeps = {
    lookupTxt: async (name) => {
      asked.push(`txt ${name}`)
      if (world.txt instanceof Error) throw world.txt
      return world.txt
    },
    read: async (url) => {
      asked.push(`get ${url}`)
      const reply = world.replies[url]
      if (!reply) return { ok: true, status: 404, body: '' }
      if (reply instanceof Error) throw reply
      if ('refused' in reply) return { ok: false, refusal: 'private-address', host: new URL(url).hostname }
      return { ok: true, ...reply }
    },
    now: () => 1_000,
  }
  return { fake, asked }
}

const SETTINGS_URL = 'https://api.provider.example/domainconnect/v2/example.com/settings'
const TEMPLATE_URL = (service: string) =>
  `https://api.provider.example/domainconnect/v2/domainTemplates/providers/aglyn.com/services/${service}`

function supportedWorld(): World {
  return {
    txt: { answered: true, records: ['api.provider.example/domainconnect'] },
    replies: {
      [SETTINGS_URL]: { status: 200, body: JSON.stringify(SETTINGS) },
      [TEMPLATE_URL('website')]: { status: 200, body: '{}' },
      [TEMPLATE_URL('website-subdomain')]: { status: 200, body: '{}' },
    },
  }
}

beforeEach(() => resetDomainConnectDiscoveryCache())

describe('where a domain sits in its zone', () => {
  it('applies the apex template at the root for the bare domain, with www as its twin', () => {
    expect(domainConnectZoneOf('example.com')).toEqual({
      root: 'example.com',
      host: '',
      template: 'apex',
      serviceId: 'website',
      twin: 'www.example.com',
    })
  })

  it('applies the apex template at the root for www too, with the bare domain as its twin', () => {
    expect(domainConnectZoneOf('www.example.com')).toMatchObject({
      root: 'example.com',
      host: '',
      template: 'apex',
      twin: 'example.com',
    })
  })

  it('applies the subdomain template at any other name, with no twin', () => {
    expect(domainConnectZoneOf('shop.example.com')).toEqual({
      root: 'example.com',
      host: 'shop',
      template: 'subdomain',
      serviceId: 'website-subdomain',
      twin: null,
    })
    expect(domainConnectZoneOf('eu.shop.example.co.uk')).toMatchObject({
      root: 'example.co.uk',
      host: 'eu.shop',
    })
  })

  it('sees through a two-label suffix, so example.co.uk is a root', () => {
    expect(domainConnectZoneOf('example.co.uk')).toMatchObject({ root: 'example.co.uk', host: '', template: 'apex' })
  })

  it('has no zone for a single label', () => {
    expect(domainConnectZoneOf('localhost')).toBeNull()
  })
})

describe('reading a provider’s settings', () => {
  it('names the provider by its display name and keeps its popup size', () => {
    expect(parseDomainConnectSettings(SETTINGS)).toEqual({
      providerId: 'provider.example',
      providerName: 'Provider DNS',
      urlSyncUX: 'https://dash.provider.example/domainconnect',
      urlAPI: 'https://api.provider.example/domainconnect',
      width: 640,
      height: 700,
    })
  })

  it('falls back to providerName and the spec’s 750 when the optional fields are absent', () => {
    const bare: Record<string, unknown> = { ...SETTINGS }
    delete bare['providerDisplayName']
    delete bare['width']
    delete bare['height']
    expect(parseDomainConnectSettings(bare)).toMatchObject({ providerName: 'Provider', width: 750, height: 750 })
  })

  it('refuses a provider with no synchronous flow, or an apply page that is not https', () => {
    const noSync: Record<string, unknown> = { ...SETTINGS }
    delete noSync['urlSyncUX']
    expect(parseDomainConnectSettings(noSync)).toBeNull()
    expect(parseDomainConnectSettings({ ...SETTINGS, urlSyncUX: 'http://dash.provider.example' })).toBeNull()
    expect(parseDomainConnectSettings({ ...SETTINGS, urlAPI: 'javascript:alert(1)' })).toBeNull()
    expect(parseDomainConnectSettings(null)).toBeNull()
    expect(parseDomainConnectSettings([])).toBeNull()
  })
})

describe('discovery', () => {
  it('is supported when the TXT, the settings and the template check all answer', async () => {
    const { fake, asked } = deps(supportedWorld())
    const found = await discoverDomainConnect('example.com', 'aglyn.com', fake)
    expect(found).toMatchObject({ supported: true, provider: { providerName: 'Provider DNS' }, zone: { root: 'example.com' } })
    expect(asked).toEqual([
      'txt _domainconnect.example.com',
      `get ${SETTINGS_URL}`,
      `get ${TEMPLATE_URL('website')}`,
    ])
  })

  it('asks for the subdomain template for a subdomain, at the zone root', async () => {
    const { fake, asked } = deps(supportedWorld())
    const found = await discoverDomainConnect('shop.example.com', 'aglyn.com', fake)
    expect(found).toMatchObject({ supported: true, zone: { host: 'shop', serviceId: 'website-subdomain' } })
    expect(asked).toContain('txt _domainconnect.example.com')
    expect(asked).toContain(`get ${TEMPLATE_URL('website-subdomain')}`)
  })

  it('caches per zone and template for ten minutes, so typing is not a request per key', async () => {
    const { fake, asked } = deps(supportedWorld())
    await discoverDomainConnect('example.com', 'aglyn.com', fake)
    await discoverDomainConnect('www.example.com', 'aglyn.com', fake)
    expect(asked.filter((line) => line.startsWith('txt'))).toHaveLength(1)
    const later = { ...fake, now: () => 1_000 + 10 * 60 * 1000 }
    await discoverDomainConnect('example.com', 'aglyn.com', later)
    expect(asked.filter((line) => line.startsWith('txt'))).toHaveLength(2)
  })

  it('a cached subdomain answer carries the name asked about, not the first one', async () => {
    const { fake } = deps(supportedWorld())
    await discoverDomainConnect('shop.example.com', 'aglyn.com', fake)
    const second = await discoverDomainConnect('blog.example.com', 'aglyn.com', fake)
    expect(second).toMatchObject({ supported: true, zone: { host: 'blog' } })
  })

  const unsupported: Array<[string, (world: World) => void, string]> = [
    ['no _domainconnect record', (w) => (w.txt = { answered: true, records: [] }), 'no-provider'],
    ['DNS that did not answer', (w) => (w.txt = { answered: false, records: [] }), 'dns-unreachable'],
    ['a TXT lookup that throws', (w) => (w.txt = new Error('boom')), 'dns-unreachable'],
    ['a TXT that is not a host', (w) => (w.txt = { answered: true, records: ['not a host!'] }), 'no-provider'],
    ['a provider that does not host the zone (404)', (w) => delete w.replies[SETTINGS_URL], 'no-settings'],
    ['settings that are not JSON', (w) => (w.replies[SETTINGS_URL] = { status: 200, body: '<html>' }), 'no-sync-flow'],
    ['settings past the size ceiling', (w) => (w.replies[SETTINGS_URL] = { status: 200, body: null }), 'no-settings'],
    ['a TXT naming a private address', (w) => (w.replies[SETTINGS_URL] = { refused: true }), 'no-settings'],
    ['a request that throws (a timeout)', (w) => (w.replies[SETTINGS_URL] = new Error('timeout')), 'no-settings'],
    ['a provider that has not onboarded our template', (w) => delete w.replies[TEMPLATE_URL('website')], 'no-template'],
  ]

  it.each(unsupported)('answers not supported, and never throws, for %s', async (_label, change, reason) => {
    const world = supportedWorld()
    change(world)
    const { fake } = deps(world)
    await expect(discoverDomainConnect('example.com', 'aglyn.com', fake)).resolves.toEqual({
      supported: false,
      reason,
    })
  })
})
