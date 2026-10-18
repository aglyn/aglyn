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
 * The registries the plugins' server declarations fill at boot (AGL-3947).
 *
 * Both apps run `registerPluginServerDeclarations()` from `instrumentation.ts`,
 * which Next compiles apart from the routes, so the boot and a route each hold
 * their own copy of every module below. Each copy is stood up here with
 * `jest.isolateModules`: registered through one, read through the other. A
 * registry at module scope fails the first case, and the route that reads it
 * runs no handler, sends no alert, meters nothing, without a word.
 *
 * The second case is why a shared registry is safe: a route that re-runs the
 * declarations in its own copy registers the same owner again, and every one
 * of these replaces by owner rather than appending.
 */

import type * as OperatorAlerts from './operator-alerts'
import type * as PluginConfig from './plugin-config'
import type * as ConsentGroupChange from './plugin-consent-group-change'
import type * as ConsoleCrons from './plugin-console-crons'
import type * as PluginEvents from './plugin-events'
import type * as LeadConversion from './plugin-lead-conversion'
import type * as MembershipDetach from './plugin-membership-detach'
import type * as PersonMatches from './plugin-person-matches'
import type * as UsageMeters from './plugin-usage-meters'
import type * as UsageAlertContributors from './usage-alert-contributors'

/** A fresh copy of a module, as a separately compiled graph holds it. */
function freshCopy<T>(path: string): T {
  let copy: T | undefined
  jest.isolateModules(() => {
    copy = jest.requireActual(path) as T
  })
  if (!copy) throw new Error('the module did not load')
  return copy
}

const PLUGIN = 'acme'

interface Case<T> {
  name: string
  path: string
  register: (copy: T) => void
  /** How many registrations the copy can see for {@link PLUGIN}. */
  count: (copy: T) => number
}

const cases: Array<Case<never>> = [
  {
    name: 'operator alerts',
    path: './operator-alerts',
    register: (copy: typeof OperatorAlerts) =>
      copy.registerOperatorAlerts([{ type: `${PLUGIN}.down`, label: 'Down' } as never], {
        pluginId: PLUGIN,
      }),
    count: (copy: typeof OperatorAlerts) =>
      copy.listOperatorAlerts().filter((entry) => entry.type === `${PLUGIN}.down`).length,
  },
  {
    name: 'plugin config schemas',
    path: './plugin-config',
    register: (copy: typeof PluginConfig) =>
      copy.registerPluginConfigSchema({ pluginId: PLUGIN, fields: [], defaults: {} }),
    count: (copy: typeof PluginConfig) =>
      copy.listPluginConfigSchemas().filter((entry) => entry.pluginId === PLUGIN).length,
  },
  {
    name: 'consent group participants',
    path: './plugin-consent-group-change',
    register: (copy: typeof ConsentGroupChange) =>
      copy.registerPluginConsentGroupParticipant({} as never, { pluginId: PLUGIN }),
    count: (copy: typeof ConsentGroupChange) =>
      copy.listPluginConsentGroupParticipants().filter((entry) => entry.pluginId === PLUGIN)
        .length,
  },
  {
    name: 'console crons',
    path: './plugin-console-crons',
    register: (copy: typeof ConsoleCrons) =>
      copy.registerPluginConsoleCron(
        { id: `${PLUGIN}-sweep`, label: 'Sweep', drives: 'the sweep', run: async () => undefined },
        { pluginId: PLUGIN },
      ),
    count: (copy: typeof ConsoleCrons) =>
      copy.listPluginConsoleCrons().filter((entry) => entry.pluginId === PLUGIN).length,
  },
  {
    name: 'plugin event handlers',
    path: './plugin-events',
    register: (copy: typeof PluginEvents) =>
      copy.registerPluginEventHandler('org.seatAddons.changed', () => undefined, {
        pluginId: PLUGIN,
      }),
    count: (copy: typeof PluginEvents) =>
      copy.listPluginEventHandlers('org.seatAddons.changed').filter((id) => id === PLUGIN)
        .length,
  },
  {
    name: 'lead conversion listeners',
    path: './plugin-lead-conversion',
    register: (copy: typeof LeadConversion) =>
      copy.registerPluginLeadConversionListener(async () => undefined, { pluginId: PLUGIN }),
    count: (copy: typeof LeadConversion) =>
      copy.listPluginLeadConversionListeners().filter((id) => id === PLUGIN).length,
  },
  {
    name: 'membership detachers',
    path: './plugin-membership-detach',
    register: (copy: typeof MembershipDetach) =>
      copy.registerPluginMembershipDetacher(async () => undefined as never, {
        pluginId: PLUGIN,
      }),
    count: (copy: typeof MembershipDetach) =>
      copy.listPluginMembershipDetachers().filter((id) => id === PLUGIN).length,
  },
  {
    name: 'person matchers',
    path: './plugin-person-matches',
    register: (copy: typeof PersonMatches) =>
      copy.registerPluginPersonMatcher(async () => [] as never, { pluginId: PLUGIN }),
    count: (copy: typeof PersonMatches) =>
      copy.listPluginPersonMatchers().filter((id) => id === PLUGIN).length,
  },
  {
    name: 'usage meters',
    path: './plugin-usage-meters',
    register: (copy: typeof UsageMeters) =>
      copy.registerPluginUsageMeter({
        pluginId: PLUGIN,
        id: 'sends',
        measure: async () => 0,
      } as never),
    count: (copy: typeof UsageMeters) =>
      copy.listPluginUsageMeters().filter((entry) => entry.pluginId === PLUGIN).length,
  },
  {
    name: 'usage alert contributors',
    path: './usage-alert-contributors',
    register: (copy: typeof UsageAlertContributors) =>
      copy.registerUsageAlertContributor({
        pluginId: PLUGIN,
        id: 'sends',
        evaluate: async () => [] as never[],
      } as never),
    count: (copy: typeof UsageAlertContributors) =>
      copy.listUsageAlertContributors().filter((entry) => entry.pluginId === PLUGIN).length,
  },
] as Array<Case<never>>

describe.each(cases)('the boot-filled $name registry', ({ path, register, count }) => {
  it('is read by every copy of the module, not only the one that registered it', () => {
    const boot = freshCopy<never>(path)
    const route = freshCopy<never>(path)
    expect(boot).not.toBe(route)
    expect(count(route)).toBe(0)
    register(boot)
    expect(count(route)).toBe(1)
  })

  it('holds one registration when the boot and a route both register the owner', () => {
    const route = freshCopy<never>(path)
    register(freshCopy<never>(path))
    register(route)
    expect(count(route)).toBe(1)
  })
})
