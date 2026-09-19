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

import { FIRST_PARTY_PLUGINS } from './enabled-plugins'
import {
  listUsageAlertContributors,
  registerUsageAlertContributor,
  resetUsageAlertContributorsForTests,
  type UsageAlertContext,
  type UsageAlertContributor,
} from './usage-alert-contributors'

/** A fictional plugin outside the first-party catalog. */
const DELIVERABILITY = 'deliverability'

const quiet = async (): Promise<void> => undefined

function contributor(
  pluginId: string,
  id: string,
  evaluate: UsageAlertContributor['evaluate'] = quiet,
): UsageAlertContributor {
  return { pluginId, id, evaluate }
}

const names = () =>
  listUsageAlertContributors().map((entry) => `${entry.pluginId}:${entry.id}`)

const CONTEXT: UsageAlertContext = {
  orgId: 'org-1',
  orgSlug: 'acme',
  org: {},
  month: '2026-09',
  spend: {
    meteredUsd: 0,
    assistUsd: 0,
    totalUsd: 0,
    assistBilled: false,
    meteredFresh: false,
  },
  guards: {},
  recordAlert: () => true,
  alertStaff: async () => undefined,
}

beforeEach(() => {
  resetUsageAlertContributorsForTests()
})

describe('usage alert contributors', () => {
  it('lists two unrelated plugins in catalog order, whichever registered first', () => {
    // The premise: `ai` is in the catalog and the fictional plugin is not.
    const catalog = FIRST_PARTY_PLUGINS.map((plugin) => plugin.id)
    expect(catalog).toContain('ai')
    expect(catalog).not.toContain(DELIVERABILITY)

    registerUsageAlertContributor(contributor(DELIVERABILITY, 'bounce-rate'))
    registerUsageAlertContributor(contributor('ai', 'provider-spend'))
    expect(names()).toEqual(['ai:provider-spend', 'deliverability:bounce-rate'])

    resetUsageAlertContributorsForTests()
    registerUsageAlertContributor(contributor('ai', 'provider-spend'))
    registerUsageAlertContributor(contributor(DELIVERABILITY, 'bounce-rate'))
    expect(names()).toEqual(['ai:provider-spend', 'deliverability:bounce-rate'])
  })

  it('orders plugins outside the catalog by id, and a plugin\'s own contributors by registration', () => {
    registerUsageAlertContributor(contributor(DELIVERABILITY, 'spam-complaints'))
    registerUsageAlertContributor(contributor('backups', 'snapshot-storage'))
    registerUsageAlertContributor(contributor(DELIVERABILITY, 'bounce-rate'))
    expect(names()).toEqual([
      'backups:snapshot-storage',
      'deliverability:spam-complaints',
      'deliverability:bounce-rate',
    ])
  })

  it('replaces a re-registered contributor in place: one entry, the new rule, the old position', async () => {
    const first = jest.fn(quiet)
    const second = jest.fn(quiet)
    registerUsageAlertContributor(contributor(DELIVERABILITY, 'bounce-rate', first))
    registerUsageAlertContributor(contributor(DELIVERABILITY, 'spam-complaints'))
    registerUsageAlertContributor(contributor(DELIVERABILITY, 'bounce-rate', second))

    expect(names()).toEqual([
      'deliverability:bounce-rate',
      'deliverability:spam-complaints',
    ])
    await listUsageAlertContributors()[0].evaluate(CONTEXT)
    expect(second).toHaveBeenCalledWith(CONTEXT)
    expect(first).not.toHaveBeenCalled()
  })

  it('keeps one id registered by two plugins as two contributors', () => {
    registerUsageAlertContributor(contributor(DELIVERABILITY, 'monthly-spend'))
    registerUsageAlertContributor(contributor('ai', 'monthly-spend'))
    expect(names()).toEqual(['ai:monthly-spend', 'deliverability:monthly-spend'])
  })

  it('refuses a contributor with no plugin, no id or no evaluate', () => {
    expect(() =>
      registerUsageAlertContributor(contributor('  ', 'bounce-rate')),
    ).toThrow('needs a pluginId and an id')
    expect(() =>
      registerUsageAlertContributor(contributor(DELIVERABILITY, '')),
    ).toThrow('needs a pluginId and an id')
    expect(() =>
      registerUsageAlertContributor({
        pluginId: DELIVERABILITY,
        id: 'bounce-rate',
      } as unknown as UsageAlertContributor),
    ).toThrow('"deliverability:bounce-rate" has no evaluate function')
    expect(names()).toEqual([])
  })

  it('answers copies, so a reader cannot rename a registered contributor', () => {
    registerUsageAlertContributor(contributor('ai', 'provider-spend'))
    const [entry] = listUsageAlertContributors()
    entry.id = 'renamed'
    expect(names()).toEqual(['ai:provider-spend'])
  })

  it('forgets every contributor on reset', () => {
    registerUsageAlertContributor(contributor('ai', 'provider-spend'))
    registerUsageAlertContributor(contributor(DELIVERABILITY, 'bounce-rate'))
    resetUsageAlertContributorsForTests()
    expect(listUsageAlertContributors()).toEqual([])
  })
})
