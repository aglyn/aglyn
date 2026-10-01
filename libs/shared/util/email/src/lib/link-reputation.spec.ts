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
 * for mail the recipient is owed. The lookup is a stand-in.
 */

import {
  foreignHostsForReputation,
  type LinkReputationLookup,
  linkReputationSignals,
  resetLinkReputationLookupForTests,
  setLinkReputationLookup,
  webRiskSignals,
} from './link-reputation'
import {
  describePhishingScreenSignals,
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
