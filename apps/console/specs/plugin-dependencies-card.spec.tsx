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
 * What a plugin needs and what needs it, on both plugin pages (AGL-2486).
 *
 * The case the site half exists for is the third `describe` below: a
 * requirement the WORKSPACE enables and this ONE site has switched off. The
 * dependent stays switched on, its workspace page looks perfectly healthy, and
 * the code behind it is not loaded on that site — its elements stop rendering
 * on published pages and its API paths 404. A fixture where everything is
 * running never reaches that state, which is why the "all green" case is here
 * as a control rather than as the main assertion.
 */

import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { resolveDisableCascade, resolveHostEnabledPlugins } from '@aglyn/aglyn'

let mockOrg: Record<string, unknown> = {}

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ header, children }: { header?: ReactNode; children: ReactNode }) => (
    <section>
      <h2>{header}</h2>
      {children}
    </section>
  ),
  AppLink: ({ children, href }: { children: ReactNode; href?: string }) => (
    <a href={href}>{children}</a>
  ),
  MdiIcon: () => <span aria-hidden="true" />,
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: mockOrg, orgId: 'org-1', ready: true }),
}))

import PluginDependenciesCard from '../components/plugin-dependencies-card.component'

/** The workspace runs everything it can. */
const FULL_ORG = {
  enabledPlugins: ['mui', 'commerce', 'accounts', 'redirects'],
}

/**
 * The warning, by ROLE rather than by MUI's severity class. `Alert` only
 * carries `role="alert"` for the severities it considers urgent, which is
 * exactly the distinction being asserted — a neutral `info` card would not
 * match, and matching it is the failure this suite exists to catch.
 */
const warning = () => document.querySelector('[role="alert"]')

const linkTo = (label: string) =>
  Array.from(document.querySelectorAll('a')).find(
    (anchor) => anchor.textContent?.trim() === label,
  )

describe('PluginDependenciesCard — workspace scope', () => {
  beforeEach(() => {
    mockOrg = FULL_ORG
  })

  it('names what the plugin needs, and links it at the same scope', () => {
    render(<PluginDependenciesCard pluginId="accounts" orgSlug="acme" />)
    expect(screen.getByText('Needs')).toBeTruthy()
    expect(linkTo('Commerce')?.getAttribute('href')).toBe('/acme/plugins/commerce')
  })

  it('names what needs the plugin, and links that at the same scope', () => {
    render(<PluginDependenciesCard pluginId="commerce" orgSlug="acme" />)
    expect(screen.getByText('Needed by')).toBeTruthy()
    expect(linkTo('User Accounts')?.getAttribute('href')).toBe('/acme/plugins/accounts')
  })

  it('does not borrow the per-site vocabulary at workspace scope', () => {
    render(<PluginDependenciesCard pluginId="commerce" orgSlug="acme" />)
    // "Runs on this site" is a claim the workspace scope cannot make: there
    // is no site here to be running on.
    expect(document.body.textContent).not.toContain('this site')
  })

  it('warns when the workspace itself has a requirement switched off', () => {
    mockOrg = { enabledPlugins: ['mui', 'accounts'] }
    render(<PluginDependenciesCard pluginId="accounts" orgSlug="acme" />)
    expect(warning()).toBeTruthy()
    expect(warning()?.textContent).toContain('Commerce')
  })

  /**
   * The CONTROL. Every assertion above would pass for a card that warned on
   * sight, and a card that always warns is a card nobody reads.
   */
  it('says nothing alarming when every requirement is on', () => {
    render(<PluginDependenciesCard pluginId="accounts" orgSlug="acme" />)
    expect(warning()).toBeNull()
  })
})

describe('PluginDependenciesCard — a plugin with no declared edges', () => {
  beforeEach(() => {
    mockOrg = FULL_ORG
  })

  /**
   * The second CONTROL. Most plugins declare nothing in either direction, so
   * a card that listed something for them would be inventing a graph — the
   * exact failure the declared-only model exists to avoid.
   */
  it('says so in both directions rather than inventing edges', () => {
    render(<PluginDependenciesCard pluginId="redirects" orgSlug="acme" />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('This plugin declares no requirements')
    expect(text).toContain('Nothing declares that it depends on this plugin')
    expect(warning()).toBeNull()
  })
})

describe('PluginDependenciesCard — site scope', () => {
  beforeEach(() => {
    mockOrg = FULL_ORG
  })

  /**
   * THE CASE. The workspace enables Commerce; this one site has switched it
   * off; User Accounts is still on here. Nothing else in the console can see
   * this, because at every other scope the answer is "Commerce is enabled".
   */
  it('warns when a requirement is enabled at the workspace and off for THIS site', () => {
    render(
      <PluginDependenciesCard
        pluginId="accounts"
        orgSlug="acme"
        site={{
          host: 'shop',
          hostDoc: {
            enabledPlugins: ['accounts'],
            disabledPlugins: ['commerce'],
          },
        }}
      />,
    )
    expect(warning()).toBeTruthy()
    expect(warning()?.textContent).toContain('Commerce')
    // It says what it MEANS here, not merely that a switch is off.
    expect(warning()?.textContent).toContain('404')
    expect(screen.getByText('Off for this site')).toBeTruthy()
  })

  /**
   * The CONTROL for that case, and the one the coordinator's brief calls out:
   * the same plugin on a site where everything is running must read
   * differently, or the warning is decoration.
   */
  it('renders no warning on a site where the requirement runs', () => {
    render(
      <PluginDependenciesCard
        pluginId="accounts"
        orgSlug="acme"
        site={{ host: 'shop', hostDoc: { enabledPlugins: ['accounts'] } }}
      />,
    )
    expect(warning()).toBeNull()
    expect(screen.getByText('Runs on this site')).toBeTruthy()
  })

  it('distinguishes "never turned on here" from "turned off here"', () => {
    // User Accounts is `defaultOffPerSite`: a site that never opted in has not
    // made a decision, and telling it that it switched something off would be
    // a different (and false) statement.
    render(
      <PluginDependenciesCard
        pluginId="commerce"
        orgSlug="acme"
        site={{ host: 'shop', hostDoc: {} }}
      />,
    )
    expect(screen.getByText('Not turned on for this site')).toBeTruthy()
  })

  it('links each related plugin to its page for THIS site', () => {
    render(
      <PluginDependenciesCard
        pluginId="commerce"
        orgSlug="acme"
        site={{ host: 'shop', hostDoc: { enabledPlugins: ['accounts'] } }}
      />,
    )
    expect(linkTo('User Accounts')?.getAttribute('href')).toBe(
      '/acme/hosts/shop/admin/plugins/accounts',
    )
  })

  /**
   * The card and the cascade dialog are the same question asked at two
   * moments. If they ever disagree it will be the dialog that drifted, because
   * nobody looks at it until it fires — so the set the card calls "goes off
   * with it" is pinned against the resolver the dialog is built from.
   */
  it('agrees with what the disable dialog would list', () => {
    const hostDoc = { enabledPlugins: ['accounts'] }
    render(
      <PluginDependenciesCard
        pluginId="commerce"
        orgSlug="acme"
        site={{ host: 'shop', hostDoc }}
      />,
    )
    const cascade = resolveDisableCascade(
      'commerce',
      resolveHostEnabledPlugins(FULL_ORG, hostDoc),
    )
    expect(cascade).toEqual(['accounts'])
    expect(document.body.textContent).toContain(
      'Switching this plugin off for this site switches that one off here too',
    )
  })

  it('does not claim a cascade for a dependent that is already off here', () => {
    render(
      <PluginDependenciesCard
        pluginId="commerce"
        orgSlug="acme"
        site={{ host: 'shop', hostDoc: {} }}
      />,
    )
    expect(document.body.textContent).toContain(
      'Already off, so nothing more happens to it',
    )
  })
})
