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

import type { WorkspaceSite } from '@aglyn/mobile-core'
import { parseSelection, sitesThatCanSell, sortRegisters } from './selection'

jest.mock('firebase/firestore', () => ({}))

const site = (hostId: string, role: WorkspaceSite['role']): WorkspaceSite => ({
  hostId,
  orgId: 'o1',
  orgSlug: 'acme',
  orgName: 'Acme',
  subdomain: hostId,
  name: hostId,
  role,
})

describe('selection', () => {
  const sites = [site('a', 'admin'), site('e', 'editor'), site('v', 'viewer'), site('n', null)]

  it('offers only the roles a sale accepts', () => {
    expect(sitesThatCanSell(sites).map((entry) => entry.hostId)).toEqual(['a', 'e'])
  })

  it('reopens a saved register only for the same member and a site they can still sell on', () => {
    const raw = JSON.stringify({ uid: 'u1', site: { hostId: 'e' }, register: { id: 'r1', name: 'Front' } })
    expect(parseSelection(raw, 'u1', sites)).toEqual({ site: sites[1], register: { id: 'r1', name: 'Front' } })
    expect(parseSelection(raw, 'u2', sites)).toBeNull()
    expect(parseSelection(raw.replace('"e"', '"v"'), 'u1', sites)).toBeNull()
    expect(parseSelection('garbage', 'u1', sites)).toBeNull()
    expect(parseSelection(null, 'u1', sites)).toBeNull()
  })

  it('sorts registers by name', () => {
    expect(sortRegisters([{ id: '2', name: 'B' }, { id: '1', name: 'A' }]).map((r) => r.id)).toEqual(['1', '2'])
  })
})
