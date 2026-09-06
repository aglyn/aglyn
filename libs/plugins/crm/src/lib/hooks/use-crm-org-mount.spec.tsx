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

import type { ConsolePluginOrgMount } from '@aglyn/aglyn'
import { render, screen } from '@testing-library/react'
import { useCrmOrgMount, withCrmOrgMount } from './use-crm-org-mount'

/**
 * A card on the organization's dashboard slot is handed the org mount as a
 * PROP, because the sites page cannot mount this plugin's provider itself
 * (AGL-2636). `withCrmOrgMount` is what turns the prop back into the context
 * every CRM surface reads, and a wrapper that dropped it would leave the card
 * resolving to no org — reading nothing, forever, with no error to say why.
 */
const MOUNT: ConsolePluginOrgMount = {
  orgId: 'org-1',
  hosts: [
    { id: 'site-1', name: 'One', subdomain: 'one' },
    { id: 'site-2', name: 'Two', subdomain: 'two' },
  ],
  hostsReady: true,
  hostsPath: '/acme/hosts',
}

/** What a card sees: the mount's org, its site count, and the site it would create on. */
function Probe(props: { label: string }) {
  const mount = useCrmOrgMount()
  return (
    <div>
      <span data-testid="label">{props.label}</span>
      <span data-testid="org">{mount?.orgId ?? 'none'}</span>
      <span data-testid="sites">{mount ? String(mount.hosts.length) : 'none'}</span>
      <span data-testid="hub">{mount?.siteHubHref('site-2') ?? 'none'}</span>
    </div>
  )
}
Probe.displayName = 'Probe'

describe('withCrmOrgMount', () => {
  const Mounted = withCrmOrgMount(Probe)

  it('publishes the mount the shell handed as a prop to the card beneath it', () => {
    render(<Mounted label="org row" orgMount={MOUNT} />)
    expect(screen.getByTestId('label').textContent).toBe('org row')
    expect(screen.getByTestId('org').textContent).toBe('org-1')
    expect(screen.getByTestId('sites').textContent).toBe('2')
    // The derived helpers come with it — the same provider the hub mounts.
    expect(screen.getByTestId('hub').textContent).toBe('/acme/hosts/two/crm')
  })

  it('keeps the card off the mount prop and passes the rest through', () => {
    // Nothing the wrapper reads reaches the card: `orgMount` is the
    // provider's, and a card that received it would have a second source of
    // truth beside the context it already reads.
    const seen: unknown[] = []
    function Spy(props: Record<string, unknown>) {
      seen.push(props)
      return null
    }
    Spy.displayName = 'Spy'
    const Wrapped = withCrmOrgMount(Spy)
    render(<Wrapped hostId={null} basePath="/acme/crm" orgMount={MOUNT} />)
    expect(seen).toEqual([{ hostId: null, basePath: '/acme/crm' }])
  })

  it('renders the card as it is when no mount was handed over, as under a site', () => {
    render(<Mounted label="site row" />)
    expect(screen.getByTestId('org').textContent).toBe('none')
    expect(screen.getByTestId('sites').textContent).toBe('none')
  })

  it('names the wrapped card in its displayName, so a tree reads as the card', () => {
    expect(Mounted.displayName).toBe('CrmOrgMounted(Probe)')
  })
})
