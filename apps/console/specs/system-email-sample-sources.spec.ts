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
  SAMPLE_SOURCE_FILLS,
  sampleContext,
} from '../utils/system-email-sample-sources'

/**
 * "Populate from" on a system email test (AGL-766) fills the merge tokens a
 * real workspace, site or person provides. The test drawer and the staff apps'
 * picker (generated from `SAMPLE_SOURCE_FILLS`) read the same table.
 */
describe('system email sample sources', () => {
  it('fills a workspace, a site and a person under the token names templates use', () => {
    expect(sampleContext('org', { name: 'Acme', $id: 'o1' })).toEqual({
      'org.name': 'Acme',
      'org.id': 'o1',
    })
    expect(
      sampleContext('host', { displayName: 'Shop', subdomain: 'shop', $id: 'h1' }),
    ).toEqual({ 'host.name': 'Shop', 'host.subdomain': 'shop', 'host.id': 'h1' })
    expect(
      sampleContext('user', { email: 'a@b.co', displayName: 'Dana', uid: 'u1' }),
    ).toEqual({ 'user.email': 'a@b.co', 'user.name': 'Dana', 'user.id': 'u1' })
  })

  it('leaves a token blank when the record has no value, never "undefined"', () => {
    expect(sampleContext('user', { uid: 'u1', email: null })).toEqual({
      'user.email': '',
      'user.name': '',
      'user.id': 'u1',
    })
  })

  it('names three kinds of record', () => {
    expect(Object.keys(SAMPLE_SOURCE_FILLS)).toEqual(['org', 'host', 'user'])
  })
})
