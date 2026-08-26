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

import {
  ACCOUNTS_PLUGIN_ID,
  DEFAULT_OFF_PER_SITE_PLUGIN_IDS,
  FIRST_PARTY_PLUGINS,
  isDefaultOffPerSite,
  isHostPluginEnabled,
  resolveEnabledPlugins,
  resolveHostEnabledPlugins,
} from './enabled-plugins'

/**
 * The per-site user-accounts capability (AGL-2486).
 *
 *
 * The example is our own marketing site: `aglyn.com/signin` served a member
 * sign-in form while the real console sign-in lives on `app.aglyn.com`. A
 * sign-in-shaped page on a brand's marketing domain that is not the brand's
 * sign-in is a credential-confusion hazard, so "off" has to mean the address
 * does not exist — not that it is unlinked.
 *
 * The mechanism is the AGL-1014 per-site plugin switchboard, deliberately:
 * a second switching model for one capability is how the two diverge. But
 * that switchboard is a DENY-list — a host stores what it turns off, so
 * "absent means on" is its whole default. This capability inverts that for
 * one plugin, which is the only new idea here.
 */
describe('user accounts is a per-site capability (AGL-2486)', () => {
  /** An org that has never touched the switchboard: every plugin available. */
  const ORG: { enabledPlugins?: string[] } = {}

  it('is a first-party plugin, so it rides the existing switchboard', () => {
    const entry = FIRST_PARTY_PLUGINS.find(
      (plugin) => plugin.id === ACCOUNTS_PLUGIN_ID,
    )
    expect(entry).toBeDefined()
    expect(entry?.defaultOffPerSite).toBe(true)
    expect(entry?.alwaysOn).toBeFalsy()
  })

  it('declares itself default-off per site', () => {
    expect(isDefaultOffPerSite(ACCOUNTS_PLUGIN_ID)).toBe(true)
    expect([...DEFAULT_OFF_PER_SITE_PLUGIN_IDS]).toContain(ACCOUNTS_PLUGIN_ID)
  })

  it('no OTHER first-party plugin is default-off per site', () => {
    // Guards the blast radius: this inversion exists for one capability, and
    // a second one arriving silently would change what every existing site
    // serves. Adding one is a decision, so make it a failing test first.
    for (const plugin of FIRST_PARTY_PLUGINS) {
      if (plugin.id === ACCOUNTS_PLUGIN_ID) continue
      expect(isDefaultOffPerSite(plugin.id)).toBe(false)
    }
  })

  it('stays available at ORG level so an agency can hand it to a site', () => {
    // Off per SITE is not off per workspace: the org keeps it in its set, or
    // no site could ever opt in.
    expect(resolveEnabledPlugins(ORG)).toContain(ACCOUNTS_PLUGIN_ID)
  })

  it('a host that never touched the switch does NOT get it', () => {
    // The whole point. An absent field on the host doc means OFF for this
    // plugin, the opposite of every other id in the set.
    expect(resolveHostEnabledPlugins(ORG, {})).not.toContain(ACCOUNTS_PLUGIN_ID)
    expect(resolveHostEnabledPlugins(ORG, null)).not.toContain(
      ACCOUNTS_PLUGIN_ID,
    )
    expect(resolveHostEnabledPlugins(ORG, undefined)).not.toContain(
      ACCOUNTS_PLUGIN_ID,
    )
  })

  it('an empty deny-list still does NOT turn it on', () => {
    // `disabledPlugins: []` is what a site gets after toggling anything else
    // off and back on. It must not be mistaken for consent to member pages.
    expect(
      resolveHostEnabledPlugins(ORG, { disabledPlugins: [] }),
    ).not.toContain(ACCOUNTS_PLUGIN_ID)
  })

  it('a host opts in explicitly with `enabledPlugins`', () => {
    expect(
      resolveHostEnabledPlugins(ORG, { enabledPlugins: [ACCOUNTS_PLUGIN_ID] }),
    ).toContain(ACCOUNTS_PLUGIN_ID)
    expect(
      isHostPluginEnabled(ORG, { enabledPlugins: [ACCOUNTS_PLUGIN_ID] }, ACCOUNTS_PLUGIN_ID),
    ).toBe(true)
    expect(isHostPluginEnabled(ORG, {}, ACCOUNTS_PLUGIN_ID)).toBe(false)
  })

  it('the opt-in is still NARROW-ONLY: the org outranks the site', () => {
    // A site may not conjure a plugin the workspace switched off — the whole
    // invariant AGL-1014 was built on. The opt-in list is an un-defaulting,
    // not a second grant.
    const orgWithout = { enabledPlugins: ['mui'] }
    expect(
      resolveHostEnabledPlugins(orgWithout, {
        enabledPlugins: [ACCOUNTS_PLUGIN_ID],
      }),
    ).not.toContain(ACCOUNTS_PLUGIN_ID)
  })

  it('an explicit deny beats an explicit opt-in', () => {
    // Both fields set is a state the console cannot produce, but a stale
    // client or a hand-edited doc can. The safe reading wins.
    expect(
      resolveHostEnabledPlugins(ORG, {
        enabledPlugins: [ACCOUNTS_PLUGIN_ID],
        disabledPlugins: [ACCOUNTS_PLUGIN_ID],
      }),
    ).not.toContain(ACCOUNTS_PLUGIN_ID)
  })

  it('the opt-in list cannot un-default anything else', () => {
    // `enabledPlugins` on a host is scoped to default-off ids. Listing an
    // ordinary id there must not widen the org set, or the field becomes a
    // second, weaker copy of the org switchboard.
    const orgWithout = { enabledPlugins: ['mui'] }
    expect(
      resolveHostEnabledPlugins(orgWithout, { enabledPlugins: ['commerce'] }),
    ).not.toContain('commerce')
  })

  it('leaves every other plugin exactly as it was', () => {
    // Regression fence for the 12 existing bundles: this change must be
    // invisible to a site that has nothing to do with member accounts.
    const before = resolveHostEnabledPlugins(ORG, {}).filter(
      (id) => id !== ACCOUNTS_PLUGIN_ID,
    )
    const after = resolveHostEnabledPlugins(ORG, {
      enabledPlugins: [ACCOUNTS_PLUGIN_ID],
    }).filter((id) => id !== ACCOUNTS_PLUGIN_ID)
    expect(after).toEqual(before)
    expect(before).toContain('commerce')
  })
})
