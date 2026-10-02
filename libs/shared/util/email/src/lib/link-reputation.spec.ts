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
 * Link reputation (AGL-3451): which hosts are worth asking about, how a
 * listing becomes a strong signal, and the send seam holding a tenant
 * message that links to a listed host — for an established workspace, and
 * for mail the recipient is owed. And the addresses `'url'` mode looks up
 * (AGL-3459): what is kept of a link, what never is, and how many one
 * message may ask about. The lookup is a stand-in.
 */

import {
  foreignHostsForReputation,
  foreignLinksForReputation,
  MAX_REPUTATION_URL_PATH_LENGTH,
  normalizeReputationLink,
  pickReputationUrls,
  type LinkReputationLookup,
  linkReputationSignals,
  resetLinkReputationLookupForTests,
  setLinkReputationLookup,
  webRiskSignals,
} from './link-reputation'
import {
  describePhishingScreenSignals,
  linkUrlsIn,
  phishingSignalTier,
  signalsThatHold,
} from './outbound-phishing-screen'
import {
  type OutboundScreenGateRequest,
  resetOutboundScreenGateForTests,
  screenTenantMessage,
  setOutboundScreenGate,
  type SendingWorkspace,
} from './outbound-screen-gate'

const HARVESTER = 'temps-juenes.example'

/** A lookup that lists the harvester and nothing else, recording what it was asked. */
function listing(asked: string[][] = []): LinkReputationLookup {
  return async (hosts) => {
    asked.push([...hosts])
    return {
      hits: hosts.filter((host) => host === HARVESTER).map((host) => ({ host, threats: ['SOCIAL_ENGINEERING'] })),
      clean: hosts.filter((host) => host !== HARVESTER),
      unknown: [],
    }
  }
}

const ESTABLISHED: SendingWorkspace = {
  hostId: 'host-1',
  orgId: 'org-1',
  ageDays: 400,
  ownNames: ['Harbor View'],
  ownDomains: ['harborview.aglyn.app', 'harborview.example'],
}

afterEach(() => {
  resetLinkReputationLookupForTests()
  resetOutboundScreenGateForTests()
  jest.restoreAllMocks()
})

describe('which hosts are asked about', () => {
  it('only foreign ones: never the workspace’s own, the platform’s, a brand’s own or a common link', () => {
    expect(
      foreignHostsForReputation(
        [
          'www.harborview.example',
          'harborview.aglyn.app',
          'neighbour.aglyn.app',
          'www.paypal.com',
          'facebook.com',
          'TEMPS-JUENES.example.',
          'temps-juenes.example',
          'not a host',
          'conservascaorvi.example',
        ],
        { ownDomains: ESTABLISHED.ownDomains, excludeDomains: ['aglyn.app'] },
      ),
    ).toEqual(['temps-juenes.example', 'conservascaorvi.example'])
  })

  it('caps how many one page or message asks about', () => {
    const hosts = Array.from({ length: 30 }, (_, index) => `site${index}.example`)
    expect(foreignHostsForReputation(hosts)).toHaveLength(20)
    expect(foreignHostsForReputation(hosts, { max: 3 })).toEqual(['site0.example', 'site1.example', 'site2.example'])
  })
})

describe('a listing, as a signal', () => {
  it('is a STRONG web-risk-link that holds for every workspace, whatever host it is on', () => {
    const [signal] = webRiskSignals([{ host: 'acme.zendesk.com', threats: ['MALWARE', 'SOCIAL_ENGINEERING', 'MALWARE'] }])
    expect(signal).toEqual({ code: 'web-risk-link', host: 'acme.zendesk.com', threats: ['MALWARE', 'SOCIAL_ENGINEERING'] })
    expect(phishingSignalTier(signal)).toBe('strong')
    expect(signalsThatHold([signal], { ageDays: 900, owed: true })).toEqual([signal])
    expect(describePhishingScreenSignals([signal])).toEqual([
      'Links to acme.zendesk.com, which Google Web Risk lists as malware and phishing or social engineering.',
    ])
  })

  it('is looked up through the installed lookup, and nothing installed looks nothing up', async () => {
    await expect(linkReputationSignals([HARVESTER])).resolves.toEqual([])
    const asked: string[][] = []
    setLinkReputationLookup(listing(asked))
    await expect(linkReputationSignals([HARVESTER, 'bakery.example', 'facebook.com'])).resolves.toEqual([
      { code: 'web-risk-link', host: HARVESTER, threats: ['SOCIAL_ENGINEERING'] },
    ])
    expect(asked).toEqual([[HARVESTER, 'bakery.example']])
  })

  it('reads a lookup that fails as no signal — never as evidence', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    setLinkReputationLookup(async () => {
      throw new Error('timeout')
    })
    await expect(linkReputationSignals([HARVESTER])).resolves.toEqual([])
    setLinkReputationLookup(async (hosts) => ({ hits: [], clean: [], unknown: [...hosts] }))
    await expect(linkReputationSignals([HARVESTER])).resolves.toEqual([])
  })
})

describe('the send seam', () => {
  const gate = jest.fn(async (_request: OutboundScreenGateRequest) => ({ outcome: 'held' as const, reference: 'HS-1' }))

  beforeEach(() => {
    gate.mockClear()
    setOutboundScreenGate(gate)
  })

  it('holds an established workspace’s plain email that links to a listed host', async () => {
    setLinkReputationLookup(listing())
    const refusal = await screenTenantMessage({
      workspace: ESTABLISHED,
      subject: 'Your document',
      bodies: [`<p>Your file is ready.</p><a href="https://${HARVESTER}/view?id=1">Open</a>`],
    })
    expect(refusal).toMatchObject({ outcome: 'held', reference: 'HS-1' })
    expect(gate.mock.calls[0][0].signals).toEqual([
      { code: 'web-risk-link', host: HARVESTER, threats: ['SOCIAL_ENGINEERING'] },
    ])
  })

  it('holds mail the recipient is owed too: a listed link is not a receipt', async () => {
    setLinkReputationLookup(listing())
    const refusal = await screenTenantMessage({
      workspace: ESTABLISHED,
      subject: 'Your receipt',
      bodies: [`Thanks for your order. Track it at https://${HARVESTER}/track`],
      owed: true,
    })
    expect(refusal?.outcome).toBe('held')
  })

  it('sends a message whose links are clean, or could not be checked', async () => {
    setLinkReputationLookup(listing())
    await expect(
      screenTenantMessage({ workspace: ESTABLISHED, subject: 'Hi', bodies: ['See https://bakery.example/menu'] }),
    ).resolves.toBeNull()
    setLinkReputationLookup(async (hosts) => ({ hits: [], clean: [], unknown: [...hosts] }))
    await expect(
      screenTenantMessage({ workspace: ESTABLISHED, subject: 'Hi', bodies: [`See https://${HARVESTER}/`] }),
    ).resolves.toBeNull()
    expect(gate).not.toHaveBeenCalled()
  })
})

describe('an address, as it may be looked up (AGL-3459)', () => {
  it('drops the query string, the fragment and any user:password@', () => {
    expect(
      normalizeReputationLink('https://user:pw@Shop.Example/Order/Track?email=jane%40doe.example&t=abc#step-2'),
    ).toEqual({ host: 'shop.example', url: 'https://shop.example/Order/Track' })
  })

  it('lowercases the host, drops a default port, keeps another, and resolves dot segments', () => {
    expect(normalizeReputationLink('HTTP://Example.COM:80/a/./b/../c')?.url).toBe('http://example.com/a/c')
    expect(normalizeReputationLink('https://example.com:443/x')?.url).toBe('https://example.com/x')
    expect(normalizeReputationLink('https://example.com:8443/x')?.url).toBe('https://example.com:8443/x')
    expect(normalizeReputationLink('https://example.com./x/%2e%2e/y')?.url).toBe('https://example.com/y')
  })

  it('reads www., // and a bare host as https, and refuses anything that is not an http(s) link to a host', () => {
    expect(normalizeReputationLink('www.Shop.example/sale')?.url).toBe('https://www.shop.example/sale')
    expect(normalizeReputationLink('//cdn.example/kit.js')?.url).toBe('https://cdn.example/kit.js')
    expect(normalizeReputationLink('bakery.example')).toEqual({ host: 'bakery.example', url: 'https://bakery.example/' })
    for (const refused of [
      'mailto:jane@doe.example',
      'javascript:alert(1)',
      'ftp://files.example/x',
      'not a host',
      '',
      'https://localhost/x',
    ]) {
      expect([refused, normalizeReputationLink(refused)]).toEqual([refused, null])
    }
  })

  it('stops the path before a segment carrying an email address or an unrendered merge tag', () => {
    expect(normalizeReputationLink('https://kit.example/login/jane@doe.example/verify')?.url).toBe(
      'https://kit.example/login/',
    )
    expect(normalizeReputationLink('https://kit.example/login/jane%40doe.example')?.url).toBe(
      'https://kit.example/login/',
    )
    expect(normalizeReputationLink('https://shop.example/u/{{contact.id}}/prefs')?.url).toBe('https://shop.example/u/')
  })

  it(`cuts a path longer than ${MAX_REPUTATION_URL_PATH_LENGTH} characters back to a segment boundary`, () => {
    const long = `https://kit.example/${'abcdefghi/'.repeat(80)}end`
    const url = normalizeReputationLink(long)?.url ?? ''
    const path = url.slice('https://kit.example'.length)
    expect(path.length).toBeLessThanOrEqual(MAX_REPUTATION_URL_PATH_LENGTH)
    expect(path.endsWith('/')).toBe(true)
    expect(long.startsWith(url)).toBe(true)
  })

  it('reads every link in a message whole, without the prose around it', () => {
    expect(
      linkUrlsIn('See https://a.example/x?y=1. Or www.b.example/z, and <a href="https://c.example/">c</a>'),
    ).toEqual(['https://a.example/x?y=1', 'https://www.b.example/z', 'https://c.example/'])
  })

  it('takes addresses a host at a time, skips a front door and a repeat, and caps', () => {
    const links = [
      'https://a.example/1',
      'https://a.example/1?again',
      'https://a.example/2',
      'https://a.example/3',
      'https://b.example/',
      'https://b.example/1',
      'https://c.example/1',
    ]
    expect(pickReputationUrls(links, ['a.example', 'b.example'], 3)).toEqual([
      'https://a.example/1',
      'https://b.example/1',
      'https://a.example/2',
    ])
  })

  it('pairs the foreign hosts with their addresses, and never the workspace’s own', () => {
    expect(
      foreignLinksForReputation(
        [
          'https://harborview.example/about?ref=1',
          'https://bakery.example/wp/kit/?email=jane@doe.example',
          'https://facebook.com/harborview',
        ],
        { ownDomains: ESTABLISHED.ownDomains },
      ),
    ).toEqual({ hosts: ['bakery.example'], urls: ['https://bakery.example/wp/kit/'] })
  })

  it('hands the lookup each foreign address without its query, and a listed address is a signal naming it', async () => {
    const asked: Array<{ hosts: string[]; urls: string[] }> = []
    setLinkReputationLookup(async (hosts, options) => {
      asked.push({ hosts: [...hosts], urls: [...(options?.urls ?? [])] })
      return {
        hits: [{ host: 'bakery.example', url: 'https://bakery.example/wp/kit/', threats: ['SOCIAL_ENGINEERING'] }],
        clean: ['bakery.example'],
        unknown: [],
      }
    })
    const signals = await linkReputationSignals(
      ['https://bakery.example/wp/kit/?email=jane@doe.example', 'https://harborview.example/about'],
      { ownDomains: ESTABLISHED.ownDomains },
    )
    expect(asked).toEqual([{ hosts: ['bakery.example'], urls: ['https://bakery.example/wp/kit/'] }])
    expect(signals).toEqual([
      {
        code: 'web-risk-link',
        host: 'bakery.example',
        url: 'https://bakery.example/wp/kit/',
        threats: ['SOCIAL_ENGINEERING'],
      },
    ])
    expect(phishingSignalTier(signals[0])).toBe('strong')
    expect(describePhishingScreenSignals(signals)).toEqual([
      'Links to https://bakery.example/wp/kit/, which Google Web Risk lists as phishing or social engineering.',
    ])
  })

  it('holds an established workspace’s email that links to a listed page on a clean site', async () => {
    const gate = jest.fn(async (_request: OutboundScreenGateRequest) => ({ outcome: 'held' as const, reference: 'HS-2' }))
    setOutboundScreenGate(gate)
    setLinkReputationLookup(async (hosts, options) => ({
      hits: (options?.urls ?? [])
        .filter((url) => url.includes('/wp-content/'))
        .map((url) => ({ host: new URL(url).hostname, url, threats: ['SOCIAL_ENGINEERING' as const] })),
      clean: [...hosts],
      unknown: [],
    }))
    const refusal = await screenTenantMessage({
      workspace: ESTABLISHED,
      subject: 'Your invoice',
      bodies: ['<a href="https://bakery.example/wp-content/x/login.html?id=42#top">View invoice</a>'],
    })
    expect(refusal).toMatchObject({ outcome: 'held', reference: 'HS-2' })
    expect(gate.mock.calls[0][0].signals).toEqual([
      {
        code: 'web-risk-link',
        host: 'bakery.example',
        url: 'https://bakery.example/wp-content/x/login.html',
        threats: ['SOCIAL_ENGINEERING'],
      },
    ])
  })
})
