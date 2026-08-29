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
 * The site-users glance is gated on the ACCOUNTS switch (AGL-433).
 *
 * The console dashboard imported this card directly, so enablement was
 * nobody's decision: `Newest site users` rendered on every site, including
 * ones that have never turned member accounts on — permanently empty, and
 * advertising a `/signin` those sites answer with a 404.
 *
 * The gate is the registry key. `listConsoleWidgets` filters by the
 * workspace's effective plugin ids, so registering the widget under
 * `ACCOUNTS_PLUGIN_ID` — rather than as one more widget on the commerce
 * extension that ships it — is the whole fix. That distinction is invisible
 * on screen and is what these assertions are about.
 */

import * as Aglyn from '@aglyn/aglyn'
import { BUNDLE_ID } from './constants/bundle-common'
import { registerCommerceConsole } from './plugin'

const SITE_USERS_WIDGET = 'accounts-newest-site-users'

const widgetIds = (enabled?: readonly string[]) =>
  Aglyn.listConsoleWidgets(
    Aglyn.CONSOLE_WIDGET_SLOTS.hostDashboard,
    enabled,
  ).map(({ widget }) => widget.widgetId)

describe('the commerce package registers the accounts dashboard glance', () => {
  beforeEach(() => {
    Aglyn.unregisterConsoleExtension(BUNDLE_ID)
    Aglyn.unregisterConsoleExtension(Aglyn.ACCOUNTS_PLUGIN_ID)
    registerCommerceConsole()
  })

  it('THE CONTROL: the widget is registered at all', () => {
    // Guard the guard. Every refusal below would also hold if the card had
    // simply not been registered, which is the failure this file would then
    // be certifying as the fix.
    expect(widgetIds()).toContain(SITE_USERS_WIDGET)
  })

  it('renders for a site that has turned user accounts on', () => {
    expect(widgetIds([Aglyn.ACCOUNTS_PLUGIN_ID, BUNDLE_ID])).toContain(
      SITE_USERS_WIDGET,
    )
  })

  it('does NOT render for a site with commerce but no user accounts', () => {
    // `accounts` is default-OFF per site (AGL-2486), so this is the ordinary
    // case rather than an exotic one — a storefront that sells without
    // visitor accounts is most of them.
    expect(widgetIds([BUNDLE_ID])).not.toContain(SITE_USERS_WIDGET)
  })

  it('is not one more widget on the commerce extension', () => {
    // The shape that would pass the two assertions above by accident is a
    // card registered on `commerce` while a site happens to have both ids
    // enabled. Read the extension it actually rides on.
    const commerce = Aglyn.listConsoleExtensions().find(
      (entry) => entry.pluginId === BUNDLE_ID,
    )
    expect(
      (commerce?.widgets ?? []).map((widget) => widget.widgetId),
    ).not.toContain(SITE_USERS_WIDGET)
    const accounts = Aglyn.listConsoleExtensions().find(
      (entry) => entry.pluginId === Aglyn.ACCOUNTS_PLUGIN_ID,
    )
    expect(accounts?.displayName).toBe('User Accounts')
    expect((accounts?.widgets ?? []).map((widget) => widget.widgetId)).toEqual([
      SITE_USERS_WIDGET,
    ])
  })

  it('keeps the commerce glance on its own slot', () => {
    // The dashboard renders both, and they are different questions: this one
    // must not have been swept into the new slot along the way.
    expect(
      Aglyn.listConsoleWidgets('commerceGlance', [BUNDLE_ID]).map(
        ({ widget }) => widget.widgetId,
      ),
    ).toEqual(['commerce-glance'])
  })
})
