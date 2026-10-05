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
  registerPluginPersonRecords,
  type PluginPersonFileRequest,
  type PluginPersonFindRequest,
  type PluginPersonRecord,
} from '@aglyn/aglyn/plugin-manager/plugin-person-records'

/**
 * A plugin that keeps people, standing in for the one that does (AGL-3080).
 *
 * An automation asks for the person an event names, and files them under a
 * campaign, through `plugin-person-records` and imports no record system, so
 * its specs stand an owner up the way the loader would. One plugin may not
 * import another, which is why this is here rather than borrowed from the CRM.
 *
 * `find` is the spec's: it answers from the spec's own fixture. Every filing
 * is recorded as asked, so a spec asserts what the step REPORTED; what a
 * filing writes on the person is held by the CRM's `person-records.spec.ts`.
 */
export function standInPersonRecords(options: {
  find: (request: PluginPersonFindRequest) => PluginPersonRecord | null
}): { asked: PluginPersonFindRequest[]; filings: PluginPersonFileRequest[] } {
  const asked: PluginPersonFindRequest[] = []
  const filings: PluginPersonFileRequest[] = []
  registerPluginPersonRecords(
    {
      async find(request) {
        asked.push(request)
        return options.find(request)
      },
      async read(request) {
        return request.records.map(() => null)
      },
      async fileUnder(request) {
        filings.push(request)
        return { filed: true }
      },
    },
    { pluginId: 'record-system' },
  )
  return { asked, filings }
}
