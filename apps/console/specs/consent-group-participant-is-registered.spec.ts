/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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

import { listPluginConsentGroupParticipants } from '@aglyn/aglyn/plugin-manager/plugin-consent-group-change'

/**
 * THE CRM TAKES PART IN A CONSENT GROUP CHANGE IN THIS APP'S PROCESSES
 * (AGL-3320).
 *
 * A change records the participants registered when it starts and runs every
 * one of them; a participant missing from that list is a share of the carry
 * the change never runs. The CRM's is the one that carries a contact's
 * declined consent across a separation, so a boot that stopped registering it
 * would let a change flip with those refusals left behind — and nothing about
 * the change would look wrong.
 *
 * ⚑ It runs THIS APP'S OWN boot manifest, the way the consent group route and
 * its cron do, and never imports the plugin: an app may not depend on a
 * plugin (AGL-2282). The boot is run once and the answer read after it — the
 * manifest memoizes, so a reset between tests would leave nothing to boot.
 */

import { registerPluginServerDeclarations } from '../constants/plugins.declarations.server.generated'

let before: string[] = []
let after: string[] = []

beforeAll(async () => {
  before = listPluginConsentGroupParticipants().map((entry) => entry.pluginId)
  await registerPluginServerDeclarations()
  after = listPluginConsentGroupParticipants().map((entry) => entry.pluginId)
})

describe('the plugins that take part in a consent group change, in this app', () => {
  it('THE CONTROL: with boot not run, nothing takes part', () => {
    expect(before).toEqual([])
  })

  it('registers the CRM’s participant at boot', () => {
    expect(after).toContain('crm')
  })

  it('answers its summary without loading the participant', () => {
    const crm = listPluginConsentGroupParticipants().find((entry) => entry.pluginId === 'crm')
    expect(crm?.participant.summarize?.({ combined: 2, copied: 1, refusals: 1 })).toBe(
      '2 CRM records combined, 1 copied; 1 declined consent copied',
    )
  })
})
