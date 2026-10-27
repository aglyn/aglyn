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

import type { PluginConfigSchema } from '@aglyn/aglyn/plugin-manager/plugin-config'
import { WAIVERS_PLUGIN_ID } from './bundle-common'

/*==========================================
 * WAIVERS' SETTINGS (AGL-4042): how many years a signed waiver is kept after
 * its signer asks to be erased. Pure data, so the light declarations module
 * registers the schema at boot without loading the waiver model; the rule
 * that reads it is `model/waiver-retention.ts`.
 *=========================================*/

/** The years a store keeps a signed waiver after an erasure request: the default and the bounds. */
export const WAIVER_RETENTION_YEARS = { default: 7, min: 1, max: 30 } as const

/** The settings key the period is stored under. */
export const WAIVER_RETENTION_YEARS_KEY = 'retentionYears'

/**
 * The plugin's settings (AGL-428): the console's generic settings card draws
 * it at workspace and site scope, and the servers read it through
 * `getPluginConfig`. Registered from `declarations`, which both servers and
 * the console's browser load.
 */
export const WAIVERS_CONFIG_SCHEMA: PluginConfigSchema = {
  pluginId: WAIVERS_PLUGIN_ID,
  notice:
    'When somebody who signed a waiver asks to be erased, their signed waivers are kept as your record of what they agreed to, for the years you set here, then deleted. Ask your own lawyer how long yours should be kept.',
  fields: [
    {
      key: WAIVER_RETENTION_YEARS_KEY,
      label: 'Years to keep a signed waiver after its signer asks to be erased',
      type: 'number',
      min: WAIVER_RETENTION_YEARS.min,
      max: WAIVER_RETENTION_YEARS.max,
      description:
        'Counted from the last day the waiver covers. For a waiver signed for minors, it is counted from the day the youngest of them reaches the waiver’s adult age, if that is later.',
    },
  ],
  defaults: { [WAIVER_RETENTION_YEARS_KEY]: WAIVER_RETENTION_YEARS.default },
  help: { topic: 'waivers', anchor: '#keeping-signed-waivers' },
}
