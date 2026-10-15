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
 * What a real record fills in when staff test a system email "populate from"
 * it (AGL-766): the merge tokens a workspace, a site and a person provide, and
 * the field of the record each reads. The test drawer builds its choices from
 * this, and the staff apps' picker is generated from it
 * (`generate-native-staff-constants`), so the two cannot drift.
 */
export const SAMPLE_SOURCE_FILLS = {
  org: { 'org.name': 'name', 'org.id': '$id' },
  host: {
    'host.name': 'displayName',
    'host.subdomain': 'subdomain',
    'host.id': '$id',
  },
  user: { 'user.email': 'email', 'user.name': 'displayName', 'user.id': 'uid' },
} as const

export type SampleSourceKind = keyof typeof SAMPLE_SOURCE_FILLS

/** Token name → value for one record, blank where the record has none. */
export function sampleContext(
  kind: SampleSourceKind,
  record: Record<string, unknown>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(SAMPLE_SOURCE_FILLS[kind]).map(([token, field]) => [
      token,
      String(record[field] ?? ''),
    ]),
  )
}
