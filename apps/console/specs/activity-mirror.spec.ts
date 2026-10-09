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
  type MirrorCandidate,
  withoutMirroredCopies,
} from '../utils/activity-mirror'

const row = (
  id: string,
  scope: 'host' | 'org',
  seconds: number,
  overrides: Partial<MirrorCandidate> = {},
): MirrorCandidate => ({
  $id: id,
  scopeType: scope,
  scopePath: scope === 'host' ? 'hosts/h1' : 'orgs/o1',
  action: 'ai.job.output',
  actorId: 'u1',
  target: { type: 'screen', id: 's1', name: 'Home' },
  createdAt: { seconds },
  ...overrides,
})

const ids = (rows: MirrorCandidate[]) => withoutMirroredCopies(rows).map((r) => r.$id)

describe('withoutMirroredCopies (AGL-3660)', () => {
  it('drops the org copy of a site row written the same second', () => {
    expect(ids([row('site', 'host', 100), row('org', 'org', 100)])).toEqual(['site'])
  })

  it('pairs across a second boundary the two writes straddled', () => {
    expect(ids([row('site', 'host', 101), row('org', 'org', 100)])).toEqual(['site'])
  })

  it('keeps an org row with no site twin', () => {
    expect(ids([row('org', 'org', 100)])).toEqual(['org'])
  })

  it('lets one site row excuse one org row only', () => {
    expect(ids([row('site', 'host', 100), row('o1', 'org', 100), row('o2', 'org', 100)])).toEqual([
      'site',
      'o2',
    ])
  })

  it('never pairs rows that differ in act, target, actor or time', () => {
    const site = row('site', 'host', 100)
    for (const other of [
      row('o', 'org', 100, { action: 'ai.job.created' }),
      row('o', 'org', 100, { target: { type: 'screen', id: 's2', name: 'Home' } }),
      row('o', 'org', 100, { target: { type: 'screen', id: 's1', name: 'About' } }),
      row('o', 'org', 100, { actorId: 'u2' }),
      row('o', 'org', 105),
    ]) {
      expect(ids([site, other])).toEqual(['site', 'o'])
    }
  })

  it('never pairs an actorless row', () => {
    expect(
      ids([row('site', 'host', 100, { actorId: null }), row('org', 'org', 100, { actorId: null })]),
    ).toEqual(['site', 'org'])
  })
})
