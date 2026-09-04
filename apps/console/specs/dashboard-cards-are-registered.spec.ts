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
 * The host dashboard mounts capability cards through the slot (AGL-433).
 *
 * `Newest site users` and `Last campaign` were imported by the page, which
 * made the dashboard the one console surface where plugin enablement was
 * nobody's decision — the site-users card rendered on sites that have never
 * turned member accounts on, and the campaign card on workspaces with the
 * email plugin switched off.
 *
 * The plugin-side specs assert the gate itself. What they cannot see is a
 * page that adds the slot and keeps its imports, which would put the card on
 * screen twice for an enabled workspace and once for a disabled one — so
 * this reads the two pages.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONSOLE_WIDGET_SLOTS } from '@aglyn/aglyn'

const REPO = join(__dirname, '..', '..', '..')
const read = (path: string) => readFileSync(join(REPO, path), 'utf8')

const DASHBOARD = 'apps/console/app/(app)/[orgSlug]/hosts/[host]/page.tsx'
const ANALYTICS =
  'apps/console/app/(app)/[orgSlug]/hosts/[host]/analytics/page.tsx'

/** An import of a card that belongs to a plugin capability. */
const CAPABILITY_CARD_IMPORT =
  /import\s+\w*(?:SiteUsers|CampaignGlance)\w*\s+from/

describe('the dashboard cards are registered, not imported (AGL-433)', () => {
  it('THE CONTROL: the import pattern catches what it is meant to catch', () => {
    // Guard the guard. A pattern that matched nothing would pass on a page
    // that had gone back to importing both cards.
    expect(
      CAPABILITY_CARD_IMPORT.test(
        "import NewestSiteUsersCard from '../components/x.component'",
      ),
    ).toBe(true)
    expect(
      CAPABILITY_CARD_IMPORT.test(
        "import CampaignGlanceCard from '../components/y.component'",
      ),
    ).toBe(true)
    expect(
      CAPABILITY_CARD_IMPORT.test(
        "import PluginWidgetSlot from '../components/plugin-widget-slot.component'",
      ),
    ).toBe(false)
  })

  it.each([
    ['the host dashboard', DASHBOARD],
    ['the analytics page', ANALYTICS],
  ])('%s renders the capability slot', (_label, path) => {
    const source = read(path)
    expect(source).toContain('CONSOLE_WIDGET_SLOTS.hostDashboard')
    expect(source).toContain('<PluginWidgetSlot')
  })

  it.each([
    ['the host dashboard', DASHBOARD],
    ['the analytics page', ANALYTICS],
  ])('%s imports no capability card of its own', (_label, path) => {
    expect(read(path)).not.toMatch(CAPABILITY_CARD_IMPORT)
  })

  it('leaves no console copy of a card a plugin now owns', () => {
    // A copy left behind is not dead code that merely wastes a file: the next
    // reader wires the nearer one back in, and the gate is gone again with
    // nothing failing.
    expect(existsSync(join(REPO, 'apps/console/components/dashboard'))).toBe(
      false,
    )
  })

  it('the slot the pages name is the catalog one', () => {
    // A typo'd slot string renders nothing and looks exactly like a workspace
    // with no plugins enabled.
    expect(CONSOLE_WIDGET_SLOTS.hostDashboard).toBe('hostDashboard')
  })
})

/**
 * The capability cards share one grid, so each is its own cell.
 *
 * A slot renders a variable number of widgets — four for a site that sells,
 * takes bookings, mails and has forms; none for a brochure site. Grid ITEMS
 * cannot express that: an item declares one width for the whole slot, so
 * every card the slot holds lands in a single column, stacked beside the one
 * card a different slot holds. That is the layout the dashboard would have
 * grown into as widgets were added, which is why it is asserted rather than
 * left to the next reader's judgement.
 */
describe('the dashboard lays its capability cards out as one row', () => {
  /** From the grid container to the first thing after it. */
  const capabilityGrid = () => {
    const source = read(DASHBOARD)
    const grid = source.indexOf("display: 'grid'")
    return source.slice(grid, source.indexOf('slot="hostActivity"'))
  }

  it('puts both capability slots in the same grid', () => {
    expect(capabilityGrid()).toContain('slot="commerceGlance"')
    expect(capabilityGrid()).toContain('CONSOLE_WIDGET_SLOTS.hostDashboard')
  })

  it('does not stretch a short card to its neighbour’s height', () => {
    // The grid default is `stretch`, which makes a three-line card as tall as
    // the five-row one beside it and draws the empty space as part of it.
    expect(capabilityGrid()).toContain("alignItems: 'start'")
  })

  it('THE CONTROL: the slice really is the grid, and it ends', () => {
    const source = read(DASHBOARD)
    expect(source.indexOf("display: 'grid'")).toBeGreaterThan(0)
    expect(source.indexOf('slot="hostActivity"')).toBeGreaterThan(
      source.indexOf("display: 'grid'"),
    )
    // The activity feed is NOT in the capability row: it is full width, and a
    // slice that ran past it would be asserting over the whole page.
    expect(capabilityGrid()).not.toContain('hostActivity')
  })
})
