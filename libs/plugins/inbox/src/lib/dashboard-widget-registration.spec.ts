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
 * The inbox glance reaches the dashboard the way every capability card does
 * (AGL-433): registered on the shell's zone, gated by the workspace's own
 * switchboard. A card imported by the page would render on workspaces with
 * the Inbox switched off, which is the defect the dashboard just stopped
 * having.
 */

import * as Aglyn from '@aglyn/aglyn'
import { BUNDLE_ID } from './constants/bundle-common'
import { registerInboxConsole } from './plugin'

const INBOX_WIDGET = 'inbox-glance'

const widgetIds = (enabled?: readonly string[]) =>
  Aglyn.listConsoleWidgets(
    Aglyn.CONSOLE_WIDGET_SLOTS.hostDashboard,
    enabled,
  ).map(({ widget }) => widget.widgetId)

describe('the inbox plugin registers a dashboard glance', () => {
  beforeEach(() => {
    Aglyn.unregisterConsoleExtension(BUNDLE_ID)
    registerInboxConsole()
  })

  it('THE CONTROL: the widget is registered at all', () => {
    // Guard the guard: the refusal below holds just as well for a card that
    // was never registered.
    expect(widgetIds()).toContain(INBOX_WIDGET)
  })

  it('renders for a workspace with the Inbox enabled', () => {
    expect(widgetIds([BUNDLE_ID])).toContain(INBOX_WIDGET)
  })

  it('does NOT render for a workspace with the Inbox switched off', () => {
    expect(widgetIds(['commerce', 'email'])).not.toContain(INBOX_WIDGET)
  })

  it('keeps the Inbox page it links to', () => {
    // The card's header sends the reader to /inbox. The widget and that page
    // ride one extension, so the link cannot outlive the surface.
    const extension = Aglyn.listConsoleExtensions().find(
      (entry) => entry.pluginId === BUNDLE_ID,
    )
    expect((extension?.widgets ?? []).map((widget) => widget.widgetId)).toEqual([
      INBOX_WIDGET,
    ])
    expect(extension?.navItems?.[0]?.href).toBe('/inbox')
  })
})
