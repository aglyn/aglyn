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

import { SENDING_TRACKING_SUBDOMAIN, sendingDnsRecords, sendingTrackingHost } from './sending-domain'
import {
  isTrackingHostName,
  readTrackingHostProbe,
  TRACKING_HOST_PROBE_PATH,
  trackingHostDnsRecords,
  trackingHostLinkOrigin,
  trackingHostPath,
  trackingHostProbeBody,
  trackingHostTarget,
  type TrackingHostRecord,
} from './tracking-host'

/**
 * A CLICK-TRACKING HOST THIS DEPLOYMENT SERVES (AGL-3306): the same label and
 * the same records as a sending domain's campaign tracking, pointed at us.
 */

const env = { ...process.env }
afterEach(() => {
  process.env = { ...env }
})

const verified: TrackingHostRecord = {
  domain: 'acme.io',
  host: 'links.acme.io',
  status: 'verified',
  target: 'cname.vercel-dns.com',
}

describe('the host name', () => {
  it('is the sending domain under the one tracking label', () => {
    expect(SENDING_TRACKING_SUBDOMAIN).toBe('links')
    expect(sendingTrackingHost('Zach@Acme.IO')).toBe('links.acme.io')
    expect(sendingTrackingHost('acme.io.')).toBe('links.acme.io')
    expect(sendingTrackingHost('not a domain')).toBe('')
  })

  it('is the name campaign tracking prints too, so the two cannot drift', () => {
    const cname = sendingDnsRecords({ domain: 'acme.io', dkimSelector: 's', trackingTarget: 'links1.resend-dns.com' }).find(
      (entry) => entry.purpose === 'tracking',
    )
    expect(cname?.name).toBe(sendingTrackingHost('acme.io'))
  })

  it('recognizes only links. over a real domain', () => {
    expect(isTrackingHostName('links.acme.io')).toBe(true)
    expect(isTrackingHostName('LINKS.acme.io.')).toBe(true)
    expect(isTrackingHostName('links.co.uk')).toBe(true)
    for (const host of ['links', 'links.', 'app.acme.io', 'mylinks.acme.io', 'links.-bad.io', '', null]) {
      expect(isTrackingHostName(host)).toBe(false)
    }
  })
})

describe('what the host serves', () => {
  it('rewrites a link id to the redirector and answers its probe', () => {
    expect(trackingHostPath('/Ab3dE9xK2q')).toEqual({ kind: 'link', rewrite: '/api/outreach/l/Ab3dE9xK2q' })
    expect(trackingHostPath(TRACKING_HOST_PROBE_PATH)).toEqual({ kind: 'probe' })
  })

  it('404s everything else', () => {
    for (const path of ['/', '/api/outreach/l/Ab3dE9xK2q', '/Ab3dE9xK2q/', '/a/b', '/ab', '/Ab3dE9xK2q?x', '/%2e%2e']) {
      expect(trackingHostPath(path)).toEqual({ kind: 'not-found' })
    }
  })

  it('verifies only its own answer, for its own name', () => {
    const body = trackingHostProbeBody('links.acme.io')
    expect(readTrackingHostProbe(body, 'links.acme.io')).toBe(true)
    expect(readTrackingHostProbe(body, 'links.other.io')).toBe(false)
    expect(readTrackingHostProbe({ ...body, service: 'nginx' }, 'links.acme.io')).toBe(false)
    expect(readTrackingHostProbe('<html>', 'links.acme.io')).toBe(false)
  })
})

describe('the records and the link origin', () => {
  it('prints the tracking CNAME at this deployment, and the driver’s own records', () => {
    const rows = trackingHostDnsRecords({
      ...verified,
      verification: [{ type: 'TXT', domain: '_vercel.acme.io', value: 'vc-domain-verify=links.acme.io,abc' }],
    })
    expect(rows[0]).toMatchObject({ type: 'CNAME', name: 'links.acme.io', value: 'cname.vercel-dns.com', required: false })
    expect(rows[1]).toMatchObject({ type: 'CAA', value: '0 issue "letsencrypt.org"' })
    expect(rows[2]).toMatchObject({ type: 'TXT', name: '_vercel.acme.io', required: true })
  })

  it('prints no CNAME when the deployment names no target', () => {
    expect(trackingHostDnsRecords({ ...verified, target: null })).toEqual([])
  })

  it('names a target from the operator first, then the Vercel driver, then nothing', () => {
    delete process.env['AGLYN_LINK_HOST_TARGET']
    expect(trackingHostTarget('vercel')).toBe('cname.vercel-dns.com')
    expect(trackingHostTarget('none')).toBeNull()
    process.env['AGLYN_LINK_HOST_TARGET'] = 'proxy.example.net.'
    expect(trackingHostTarget('none')).toBe('proxy.example.net')
    expect(trackingHostTarget('vercel')).toBe('proxy.example.net')
  })

  it('is the host only once it is verified', () => {
    expect(trackingHostLinkOrigin(verified)).toBe('https://links.acme.io')
    for (const status of ['requested', 'records-issued', 'failed'] as const) {
      expect(trackingHostLinkOrigin({ ...verified, status })).toBeNull()
    }
    expect(trackingHostLinkOrigin({ ...verified, host: 'links.other.io' })).toBeNull()
    expect(trackingHostLinkOrigin(null)).toBeNull()
  })
})
