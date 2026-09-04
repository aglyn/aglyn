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
 * `Last campaign` belongs to the marketing plugin (AGL-433).
 *
 * The console dashboard and the analytics page both imported the card, so a
 * workspace with the plugin that owns campaigns switched off got a card about
 * campaigns on two surfaces, with no page to open them on. Registering it as
 * a widget is what puts it behind the workspace's own switchboard.
 */

import * as Aglyn from '@aglyn/aglyn'
import { BUNDLE_ID } from './constants/bundle-common'
import { registerMarketingConsole } from './plugin'

/**
 * The widget id, which a reader's dashboard preferences name: hiding the card
 * and its position in the customize order are both keyed on this string, so
 * it is persisted and does not track the plugin that registers it.
 */
const CAMPAIGN_WIDGET = 'email-campaign-glance'

const widgetIds = (enabled?: readonly string[]) =>
  Aglyn.listConsoleWidgets(
    Aglyn.CONSOLE_WIDGET_SLOTS.hostDashboard,
    enabled,
  ).map(({ widget }) => widget.widgetId)

describe('the marketing plugin registers the campaign glance', () => {
  beforeEach(() => {
    Aglyn.unregisterConsoleExtension(BUNDLE_ID)
    registerMarketingConsole()
  })

  it('THE CONTROL: the widget is registered at all', () => {
    // Guard the guard: the refusal below holds just as well for a card that
    // was never registered.
    expect(widgetIds()).toContain(CAMPAIGN_WIDGET)
  })

  it('renders for a workspace with the marketing plugin enabled', () => {
    expect(widgetIds([BUNDLE_ID])).toContain(CAMPAIGN_WIDGET)
  })

  it('does NOT render for a workspace with marketing switched off', () => {
    expect(widgetIds(['commerce', 'workflows'])).not.toContain(CAMPAIGN_WIDGET)
  })

  it('rides the same extension as the Campaigns page it links to', () => {
    // The card's header sends the reader to `/marketing/campaigns`. If the
    // widget were registered under an id the page does not belong to, the
    // link could outlive the surface it points at.
    const extension = Aglyn.listConsoleExtensions().find(
      (entry) => entry.pluginId === BUNDLE_ID,
    )
    expect((extension?.widgets ?? []).map((widget) => widget.widgetId)).toEqual([
      CAMPAIGN_WIDGET,
    ])
    expect(extension?.navItems?.[0]?.href).toBe('/marketing')
  })
})
