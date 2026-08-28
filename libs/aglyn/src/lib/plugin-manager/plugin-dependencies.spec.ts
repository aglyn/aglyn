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
 * The AGL-2486 disable-cascade model: disabling a plugin another plugin
 * depends on disables that one too, and the reader is told before it happens.
 *
 * These tests pin the DECLARED model — not an inferred one. A warning derived
 * from guesswork is worse than no warning, because it claims a completeness it
 * does not have.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ACCOUNTS_PLUGIN_ID,
  FIRST_PARTY_PLUGINS,
  pluginDependents,
  pluginRequirements,
  PUBLISHED_SITE_IMPACT,
  resolveDisableCascade,
  resolvePluginSiteState,
  strandedDependents,
} from './enabled-plugins'

describe('the declared first-party dependency graph', () => {
  it('records that User Accounts requires Commerce', () => {
    // The real edge, found on `aglyn-org`: the Members blocks and every
    // `membership/*` API handler ship INSIDE the commerce bundle, so a site
    // with Commerce off serves member pages that cannot log anybody in.
    const accounts = FIRST_PARTY_PLUGINS.find(
      (plugin) => plugin.id === ACCOUNTS_PLUGIN_ID,
    )
    expect(accounts?.requires).toEqual(['commerce'])
  })

  it('declares a requirement only on ids that exist in the catalog', () => {
    // A typo'd id would silently make a dependent uncascadable — the warning
    // would be complete-looking and wrong.
    const ids = new Set(FIRST_PARTY_PLUGINS.map((plugin) => plugin.id))
    for (const plugin of FIRST_PARTY_PLUGINS) {
      for (const required of plugin.requires ?? []) {
        expect(ids.has(required)).toBe(true)
      }
    }
  })
})

describe('resolveDisableCascade', () => {
  const allOn = FIRST_PARTY_PLUGINS.map((plugin) => plugin.id)

  it('names User Accounts when Commerce is switched off', () => {
    expect(resolveDisableCascade('commerce', allOn)).toEqual([
      ACCOUNTS_PLUGIN_ID,
    ])
  })

  it('names nothing when the plugin nothing depends on is switched off', () => {
    expect(resolveDisableCascade('redirects', allOn)).toEqual([])
  })

  it('never names the plugin being disabled', () => {
    expect(resolveDisableCascade('commerce', allOn)).not.toContain('commerce')
  })

  it('omits a dependent that is already off', () => {
    // Cascading something already disabled would overstate the consequence.
    const withoutAccounts = allOn.filter((id) => id !== ACCOUNTS_PLUGIN_ID)
    expect(resolveDisableCascade('commerce', withoutAccounts)).toEqual([])
  })

  it('closes transitively: C requires B requires A', () => {
    const extra = { b: ['a'], c: ['b'] }
    expect(resolveDisableCascade('a', ['a', 'b', 'c'], extra).sort()).toEqual([
      'b',
      'c',
    ])
  })

  it('stops on a longer transitive chain rather than reporting only step one', () => {
    const extra = { b: ['a'], c: ['b'], d: ['c'] }
    expect(
      resolveDisableCascade('a', ['a', 'b', 'c', 'd'], extra).sort(),
    ).toEqual(['b', 'c', 'd'])
  })

  it('terminates on a two-node cycle', () => {
    const extra = { a: ['b'], b: ['a'] }
    expect(resolveDisableCascade('a', ['a', 'b'], extra)).toEqual(['b'])
  })

  it('terminates on a three-node cycle', () => {
    const extra = { a: ['c'], b: ['a'], c: ['b'] }
    expect(resolveDisableCascade('a', ['a', 'b', 'c'], extra).sort()).toEqual([
      'b',
      'c',
    ])
  })

  it('terminates on a self-edge', () => {
    expect(resolveDisableCascade('a', ['a'], { a: ['a'] })).toEqual([])
  })

  it('accepts marketplace requirements the catalog has never heard of', () => {
    // A third-party listing id riding the same `enabledPlugins` field.
    const extra = { 'listing-abc': ['commerce'] }
    expect(
      resolveDisableCascade('commerce', [...allOn, 'listing-abc'], extra).sort(),
    ).toEqual([ACCOUNTS_PLUGIN_ID, 'listing-abc'].sort())
  })

  it('lets a marketplace declaration extend, never shrink, the catalog graph', () => {
    // Supplying an unrelated extra map must not lose the built-in edge.
    expect(
      resolveDisableCascade('commerce', allOn, { 'listing-x': ['inbox'] }),
    ).toEqual([ACCOUNTS_PLUGIN_ID])
  })
})

describe('the published-site consequence of a disable', () => {
  it('says Commerce stops rendering elements on published pages', () => {
    expect(PUBLISHED_SITE_IMPACT['commerce']).toBe('elements')
  })

  it('says User Accounts stops serving routes, not elements', () => {
    // `accounts` registers NO components, so no node can be owned by it and
    // nothing on a published page blanks. What it does is stop /signin,
    // /signup and /recover being served. Two different sentences, and the
    // dialog must not use one for the other.
    expect(PUBLISHED_SITE_IMPACT[ACCOUNTS_PLUGIN_ID]).toBe('routes')
  })

  it('classifies every catalog plugin', () => {
    for (const plugin of FIRST_PARTY_PLUGINS) {
      expect(PUBLISHED_SITE_IMPACT[plugin.id]).toBeDefined()
    }
  })

  it('marks every site-registering bundle as element-breaking', () => {
    // The drift guard. A plugin that registers site components has its
    // already-placed elements stop rendering when the site stops loading its
    // bundle (AGL-1014) — so it cannot be introduced without saying so here.
    // Read from disk rather than imported: `plugins.config.json` sits at the
    // repo root, and importing it from inside this lib is an nx module-boundary
    // violation (and a dependency edge that would poison other projects' lint).
    const pluginsConfig = JSON.parse(
      readFileSync(
        join(__dirname, '../../../../../plugins.config.json'),
        'utf8',
      ),
    ) as { plugins: { id: string; register?: Record<string, string> }[] }
    for (const plugin of pluginsConfig.plugins) {
      if (!plugin.register?.['site']) continue
      if (plugin.id === 'mui') continue // always-on; cannot be disabled
      expect(PUBLISHED_SITE_IMPACT[plugin.id]).toBe('elements')
    }
  })

  it('marks a console-only plugin as console-only', () => {
    expect(PUBLISHED_SITE_IMPACT['contacts']).toBe('console-only')
  })
})

/**
 * The graph, read in both directions by the console's dependency card
 * (AGL-2486). Same declared edges the cascade walks — a second traversal
 * would be a second answer, and the two surfaces would eventually disagree
 * about which plugins are coupled.
 */
describe('pluginRequirements / pluginDependents', () => {
  it('reads the declared edge forwards and backwards', () => {
    expect(pluginRequirements(ACCOUNTS_PLUGIN_ID)).toEqual(['commerce'])
    expect(pluginDependents('commerce')).toEqual([ACCOUNTS_PLUGIN_ID])
  })

  it('answers empty for a plugin on neither end of an edge', () => {
    // The CONTROL. Without it both assertions above would pass for functions
    // that returned the whole catalog, which is what an inferred graph looks
    // like when it goes wrong.
    expect(pluginRequirements('redirects')).toEqual([])
    expect(pluginDependents('redirects')).toEqual([])
  })

  it('takes a marketplace listing\'s extra edges without letting it erase one', () => {
    const extra = { 'listing-abc': ['commerce'] }
    expect(pluginDependents('commerce', extra)).toEqual(
      expect.arrayContaining([ACCOUNTS_PLUGIN_ID, 'listing-abc']),
    )
    // A listing cannot declare away a first-party edge by omitting it.
    expect(pluginRequirements(ACCOUNTS_PLUGIN_ID, extra)).toEqual(['commerce'])
  })
})

/**
 * The WRITE-side question, which is the one that can be enforced.
 * `/api/orgs/settings` refuses a set this reports on, so the boundary does
 * not live in a dialog any caller can skip.
 */
describe('strandedDependents', () => {
  it('names a dependent left running with its requirement off', () => {
    expect(strandedDependents(['mui', ACCOUNTS_PLUGIN_ID])).toEqual([
      { pluginId: ACCOUNTS_PLUGIN_ID, missing: ['commerce'] },
    ])
  })

  it('is silent on a set where the requirement is present', () => {
    // The CONTROL: a checker that refused every set would pass the test above
    // and would be a far worse bug than the one it guards.
    expect(strandedDependents(['mui', ACCOUNTS_PLUGIN_ID, 'commerce'])).toEqual([])
  })

  it('is silent when the dependent is off too', () => {
    expect(strandedDependents(['mui', 'redirects'])).toEqual([])
  })

  it('ignores a requirement naming an id nothing knows about', () => {
    // A stale or typo\'d edge must not lock a workspace out of its own
    // switchboard by refusing every set it can post.
    expect(
      strandedDependents(['listing-abc'], { 'listing-abc': ['not-a-plugin'] }),
    ).toEqual([])
  })
})

/**
 * Where one plugin stands on one site — the resolution the site plugin page
 * and its dependency card both read, rather than deriving twice.
 */
describe('resolvePluginSiteState', () => {
  const org = { enabledPlugins: ['mui', 'commerce', ACCOUNTS_PLUGIN_ID, 'redirects'] }

  it('always-on beats everything, including an explicit deny', () => {
    expect(resolvePluginSiteState(org, { disabledPlugins: ['mui'] }, 'mui')).toBe(
      'always-on',
    )
  })

  it('an org-disabled plugin is off for the workspace, not off for the site', () => {
    expect(resolvePluginSiteState({ enabledPlugins: ['mui'] }, {}, 'commerce')).toBe(
      'off-for-workspace',
    )
  })

  it('a plugin the site has not denied runs here', () => {
    expect(resolvePluginSiteState(org, {}, 'commerce')).toBe('runs-here')
  })

  it('THE CASE: enabled at the workspace, denied by this site', () => {
    expect(
      resolvePluginSiteState(org, { disabledPlugins: ['commerce'] }, 'commerce'),
    ).toBe('off-for-site')
  })

  it('a default-off plugin nobody asked for is awaiting an opt-in, not switched off', () => {
    // Two different sentences to an operator: nobody decided, versus somebody
    // decided against.
    expect(resolvePluginSiteState(org, {}, ACCOUNTS_PLUGIN_ID)).toBe(
      'awaiting-opt-in',
    )
    expect(
      resolvePluginSiteState(
        org,
        { disabledPlugins: [ACCOUNTS_PLUGIN_ID] },
        ACCOUNTS_PLUGIN_ID,
      ),
    ).toBe('off-for-site')
  })

  it('an opted-in default-off plugin runs here', () => {
    expect(
      resolvePluginSiteState(org, { enabledPlugins: [ACCOUNTS_PLUGIN_ID] }, ACCOUNTS_PLUGIN_ID),
    ).toBe('runs-here')
  })
})
