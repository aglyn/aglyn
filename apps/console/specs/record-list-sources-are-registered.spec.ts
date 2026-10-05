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

import { PLUGIN_RECORD_COUNTS } from '@aglyn/aglyn/plugin-manager/plugin-record-counts'
import { pluginRecordListSource } from '@aglyn/aglyn/plugin-manager/plugin-record-lists'
import {
  resetPluginServicesForTests,
  resolvePluginServices,
} from '@aglyn/aglyn/plugin-manager/plugin-services'
import { CONSOLE_PLUGIN_MANIFEST } from '../constants/plugins.client.generated'

/**
 * THE RECORDS ONE PLUGIN'S PICKER LISTS FROM ANOTHER HAVE A SOURCE IN THIS
 * CONSOLE (AGL-3080).
 *
 * An automation step's dataset and overlay selects, a computed variable's
 * workflow select, a deal's catalog search and the marketplace's install
 * state list another plugin's records through the list source that plugin
 * publishes (`plugin-record-lists`). Not registered is an answer there — no plugin
 * keeps the kind here — so a registrar that stopped publishing its source
 * would empty every one of those selects without an error, exactly like a
 * workspace with nothing in it. Each owner's spec holds what its source
 * answers when called; this one holds that the console's own boot calls it.
 *
 * ⚑ It runs THIS APP'S manifest, the way the console loads a plugin, and
 * imports no plugin: an app may not depend on one.
 */

/** Each kind another plugin's console lists, by the plugin that keeps it. */
const LISTED: Record<string, string> = {
  dataset: 'data',
  workflow: 'workflows',
  webhook: 'workflows',
  action: 'workflows',
  product: 'commerce',
  overlay: 'marketing',
  // A campaign's form conversions grouped by the page each credited
  // submission was sent from.
  formSubmission: 'forms',
}

/**
 * Each kind another plugin's figure COUNTS (`plugin-record-counts`), by the
 * plugin that keeps it: a campaign's conversions out of every submission,
 * booking, lead and contact the site holds. Not registered withholds the
 * figure, the same silent answer.
 */
const COUNTED: Record<string, string> = {
  formSubmission: 'forms',
  booking: 'bookings',
  lead: 'crm',
  contact: 'crm',
}

let ownersBeforeBoot: Array<string | null>
let countersBeforeBoot: Array<string | null>

/** Which plugin keeps a kind's count source, or `null` when none does. */
const counterOf = (kind: string): string | null =>
  resolvePluginServices(PLUGIN_RECORD_COUNTS).find((entry) => entry.key === kind)?.pluginId ?? null

beforeAll(async () => {
  resetPluginServicesForTests()
  ownersBeforeBoot = Object.keys(LISTED).map((kind) => pluginRecordListSource(kind)?.pluginId ?? null)
  countersBeforeBoot = Object.keys(COUNTED).map(counterOf)
  for (const pluginId of new Set([...Object.values(LISTED), ...Object.values(COUNTED)])) {
    const entry = CONSOLE_PLUGIN_MANIFEST.find((row) => row.id === pluginId)
    const loaded = (await entry?.load()) as Record<string, () => void>
    loaded[String(entry?.register?.console)]()
  }
})

describe('the record list sources, in this console', () => {
  it('THE CONTROL: before the registrars run, no kind has a source', () => {
    expect(ownersBeforeBoot).toEqual(Object.keys(LISTED).map(() => null))
  })

  it.each(Object.entries(LISTED))('lists %s through %s', (kind, pluginId) => {
    expect(pluginRecordListSource(kind)?.pluginId).toBe(pluginId)
  })
})

describe('the record count sources, in this console', () => {
  it('THE CONTROL: before the registrars run, no kind is counted', () => {
    expect(countersBeforeBoot).toEqual(Object.keys(COUNTED).map(() => null))
  })

  it.each(Object.entries(COUNTED))('counts %s through %s', (kind, pluginId) => {
    expect(counterOf(kind)).toBe(pluginId)
  })
})
