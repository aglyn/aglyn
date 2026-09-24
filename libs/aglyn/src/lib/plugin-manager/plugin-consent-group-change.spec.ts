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

import { planConsentGroupChange } from '../app-utils/consent-group-change'
import { setRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  type ConsentGroupChangeParticipant,
  listPluginConsentGroupParticipants,
  previewPluginConsentGroupChange,
  registerPluginConsentGroupParticipant,
  resetPluginConsentGroupParticipantsForTests,
} from './plugin-consent-group-change'

const PLAN = planConsentGroupChange({ g: { name: 'G', hostIds: ['a', 'b'] } }, {})

const participant = (
  overrides: Partial<ConsentGroupChangeParticipant> = {},
): ConsentGroupChangeParticipant => ({
  preview: async () => [],
  run: async () => ({ done: true, cursor: null, counts: {} }),
  ...overrides,
})

beforeEach(() => {
  resetPluginConsentGroupParticipantsForTests()
  setRegisteringPluginId(undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('consent group participants (AGL-3320)', () => {
  it('lists participants in registration order, owned by the register fn or the option', () => {
    setRegisteringPluginId('records')
    registerPluginConsentGroupParticipant(participant())
    setRegisteringPluginId(undefined)
    registerPluginConsentGroupParticipant(participant(), { pluginId: 'acme-sms' })

    expect(listPluginConsentGroupParticipants().map((entry) => entry.pluginId)).toEqual([
      'records',
      'acme-sms',
    ])
  })

  it('replaces a plugin’s participant in place when it registers again', () => {
    const first = participant()
    const second = participant()
    registerPluginConsentGroupParticipant(first, { pluginId: 'records' })
    registerPluginConsentGroupParticipant(participant(), { pluginId: 'acme-sms' })
    registerPluginConsentGroupParticipant(second, { pluginId: 'records' })

    const listed = listPluginConsentGroupParticipants()
    expect(listed.map((entry) => entry.pluginId)).toEqual(['records', 'acme-sms'])
    expect(listed[0].participant).toBe(second)
  })

  it('refuses a participant with no owner', () => {
    expect(() => registerPluginConsentGroupParticipant(participant())).toThrow(/no owner/)
    expect(() =>
      registerPluginConsentGroupParticipant(participant(), { pluginId: ' ' }),
    ).toThrow(/no owner/)
  })

  it('previews every participant, and a failed preview is null rather than empty', async () => {
    registerPluginConsentGroupParticipant(
      participant({
        preview: async ({ orgId, plan }) => [
          {
            id: 'records.copy',
            text: `${orgId}: ${plan.carries.length} carries`,
            count: plan.carries.length,
            severity: 'info',
          },
        ],
      }),
      { pluginId: 'records' },
    )
    registerPluginConsentGroupParticipant(
      participant({
        preview: async () => {
          throw new Error('index missing')
        },
      }),
      { pluginId: 'acme-sms' },
    )

    expect(await previewPluginConsentGroupChange({ orgId: 'org-a', plan: PLAN })).toEqual([
      {
        pluginId: 'records',
        lines: [{ id: 'records.copy', text: 'org-a: 2 carries', count: 2, severity: 'info' }],
      },
      { pluginId: 'acme-sms', lines: null },
    ])
    expect(console.error).toHaveBeenCalledWith(
      '[plugins] acme-sms failed to preview a consent group change in org org-a',
      expect.any(Error),
    )
  })

  it('does NOT isolate a run: the throw is the caller’s to see', async () => {
    // The executor stalls the change on this throw; swallowing it here would
    // flip a declaration with a carry skipped.
    registerPluginConsentGroupParticipant(
      participant({
        run: async () => {
          throw new Error('carry failed')
        },
      }),
      { pluginId: 'records' },
    )
    const [{ participant: registered }] = listPluginConsentGroupParticipants()
    await expect(
      registered.run({
        orgId: 'org-a',
        changeId: 'change-1',
        plan: PLAN,
        phase: 'carry',
        cursor: null,
        deadlineMs: Date.now() + 1_000,
        dryRun: false,
      }),
    ).rejects.toThrow('carry failed')
  })

  it('answers an empty list when no plugin registered one', async () => {
    expect(listPluginConsentGroupParticipants()).toEqual([])
    expect(await previewPluginConsentGroupChange({ orgId: 'org-a', plan: PLAN })).toEqual([])
  })
})
