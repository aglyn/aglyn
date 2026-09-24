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
 * The campaigns card in the Inbox's Campaigns section, at both levels
 * (AGL-3303).
 *
 * The card reads its org — which campaigns, the sites each is placed on —
 * through the Marketing org mount, and the organization's Inbox is a page this
 * plugin does not own. So the widget has to put the provider around the card
 * itself when the zone hands it an org mount, and must not when it hands a
 * site. What is asserted is what the CARD sees, because that is the only
 * thing either mistake changes.
 */

import { render, screen } from '@testing-library/react'
import type { ConsolePluginOrgMount } from '@aglyn/aglyn'

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useOrgDataScope: () => ({ orgId: null, ready: false, scope: null }),
}))

/** The card, reduced to what it receives and what the mount tells it. */
jest.mock('./campaigns-card', () => {
  const { useMarketingOrgMount } = jest.requireActual('./marketing-org-mount')
  function CardProbe(props: { hostId: string | null; basePath?: string }) {
    const mount = useMarketingOrgMount()
    return (
      <output aria-label="card">
        {JSON.stringify({
          hostId: props.hostId,
          basePath: props.basePath ?? null,
          mount: mount
            ? {
                orgId: mount.orgId,
                basePath: mount.basePath,
                hostsPath: mount.hostsPath,
                sites: mount.hosts.map((host: { id: string }) => host.id),
              }
            : null,
        })}
      </output>
    )
  }
  return { __esModule: true, default: CardProbe }
})

import InboxCampaignsWidget from './inbox-campaigns-widget'

const orgMount: ConsolePluginOrgMount = {
  orgId: 'org-1',
  orgSlug: 'acme',
  hosts: [
    { id: 'host-a', name: 'Shop', subdomain: 'shop' },
    { id: 'host-b', name: 'Blog', subdomain: 'blog' },
  ],
  hostsReady: true,
  hostsPath: '/acme/hosts',
}

const cardSaw = () =>
  JSON.parse(screen.getByLabelText('card').textContent ?? 'null')

describe('the Inbox campaigns widget', () => {
  it('under a site, is the site card and nothing around it', () => {
    render(<InboxCampaignsWidget hostId="host-a" />)
    expect(cardSaw()).toEqual({ hostId: 'host-a', basePath: null, mount: null })
  })

  it('on the organization’s Inbox, hands the card the org mount and the org hub', () => {
    render(<InboxCampaignsWidget hostId={null} orgMount={orgMount} />)
    expect(cardSaw()).toEqual({
      hostId: null,
      // A row opens on the org Marketing hub, where a campaign placed on
      // several sites is edited once — not on one of those sites.
      basePath: '/acme/marketing',
      mount: {
        orgId: 'org-1',
        basePath: '/acme/marketing',
        hostsPath: '/acme/hosts',
        sites: ['host-a', 'host-b'],
      },
    })
  })

  it('draws nothing handed neither a site nor an org', () => {
    const { container } = render(<InboxCampaignsWidget hostId={null} />)
    expect(container.innerHTML).toBe('')
  })
})
