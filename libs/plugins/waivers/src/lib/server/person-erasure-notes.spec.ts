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
 *
 * @jest-environment node
 */

/**
 * What the Erase a person card says about signed waivers (AGL-4042): nothing
 * for a workspace with no signature, and otherwise the period the eraser itself
 * applies on each site.
 */

import { readPersonErasureNotes } from '@aglyn/aglyn/plugin-manager/plugin-person-erasure-notes'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { registerWaiversServerDeclarations } from '../declarations.server'
import { createMemoryFirestore, type MemoryFirestore } from '../testing/memory-firestore'
import { setWaiversDbForTests } from './db'
import { waiversPersonErasureNotes } from './person-erasure-notes'
import { setWaiversRetentionYearsForTests } from './retention'

const ORG = 'org-track'

let db: MemoryFirestore
let periods: Record<string, number>

const signature = (id: string, hostId: string) =>
  db.docs.set(`orgs/${ORG}/waiverSignatures/${id}`, { hostId, emailLower: 'jordan@example.com' })
const site = (hostId: string) => db.docs.set(`orgs/${ORG}/waiverRetention/${hostId}`, { hostId, years: 1 })

beforeEach(() => {
  db = createMemoryFirestore()
  setWaiversDbForTests(db)
  periods = {}
  setWaiversRetentionYearsForTests(async (_orgId, hostId) => periods[hostId] ?? 7)
})

afterEach(() => {
  setWaiversDbForTests(null)
  setWaiversRetentionYearsForTests(null)
})

describe('the waivers note on the Erase a person card', () => {
  it('says nothing for a workspace with no signed waiver', async () => {
    site('host-1')
    expect(await waiversPersonErasureNotes({ orgId: ORG })).toEqual([])
  })

  it('names the period the site applies now, not the one a state last recorded', async () => {
    signature('s1', 'host-1')
    site('host-1')
    periods = { 'host-1': 10 }
    const [note] = await waiversPersonErasureNotes({ orgId: ORG })
    expect(note.id).toBe('signed-waivers')
    expect(note.text).toContain('(now 10 years)')
  })

  it('names the range when the sites differ', async () => {
    signature('s1', 'host-1')
    site('host-1')
    site('host-2')
    periods = { 'host-1': 3, 'host-2': 9 }
    const [note] = await waiversPersonErasureNotes({ orgId: ORG })
    expect(note.text).toContain('(now 3 to 9 years, depending on the site)')
  })

  it('still answers for a signature whose site never recorded a state', async () => {
    signature('s1', 'host-unrecorded')
    periods = { 'host-unrecorded': 4 }
    const [note] = await waiversPersonErasureNotes({ orgId: ORG })
    expect(note.text).toContain('(now 4 years)')
  })

  it('stops naming a figure past the sites it will read', async () => {
    signature('s1', 'host-0')
    for (let index = 0; index < 100; index += 1) site(`host-${index}`)
    const [note] = await waiversPersonErasureNotes({ orgId: ORG })
    expect(note.text).toContain('(set per site)')
  })

  it('reaches the card through the plugin’s server declarations', async () => {
    resetPluginServicesForTests()
    registerWaiversServerDeclarations()
    signature('s1', 'host-1')
    const read = await readPersonErasureNotes({ orgId: ORG })
    expect(read.unavailable).toEqual([])
    expect(read.notes).toEqual([
      expect.objectContaining({ id: 'signed-waivers', pluginId: 'waivers' }),
    ])
  })
})
