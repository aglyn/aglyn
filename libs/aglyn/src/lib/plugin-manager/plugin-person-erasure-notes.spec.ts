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
 * What a plugin says it keeps through a person erasure (AGL-4042): every source
 * is asked, and one that could not answer is named rather than read as "nothing
 * is kept".
 */

import { registerPluginDeclarationsRepair, resetPluginDeclarationsRepairForTests } from './plugin-declarations-repair'
import {
  isPrintablePersonErasureNote,
  readPersonErasureNotes,
  registerPersonErasureNoteSource,
} from './plugin-person-erasure-notes'
import { resetPluginServicesForTests } from './plugin-services'

describe('the person erasure notes', () => {
  beforeEach(() => {
    resetPluginServicesForTests()
    resetPluginDeclarationsRepairForTests()
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('asks every source about the workspace, each answer with its plugin', async () => {
    const asked: unknown[] = []
    registerPersonErasureNoteSource(
      {
        notes: async (request) => {
          asked.push(request)
          return [{ id: 'kept', text: 'Tickets stay as issued.' }]
        },
      },
      { pluginId: 'tickets' },
    )
    registerPersonErasureNoteSource({ notes: async () => [] }, { pluginId: 'files' })
    expect(await readPersonErasureNotes({ orgId: 'org-1' })).toEqual({
      notes: [{ id: 'kept', text: 'Tickets stay as issued.', pluginId: 'tickets' }],
      unavailable: [],
    })
    expect(asked).toEqual([{ orgId: 'org-1' }])
  })

  it('names a source that threw, and still answers the rest', async () => {
    registerPersonErasureNoteSource(
      {
        notes: async () => {
          throw new Error('down')
        },
      },
      { pluginId: 'broken' },
    )
    registerPersonErasureNoteSource({ notes: async () => [{ id: 'a', text: 'Kept.' }] }, { pluginId: 'tickets' })
    const read = await readPersonErasureNotes({ orgId: 'org-1' })
    expect(read.notes.map((note) => note.pluginId)).toEqual(['tickets'])
    expect(read.unavailable).toEqual(['broken'])
  })

  it('names a source whose answer cannot be printed', async () => {
    registerPersonErasureNoteSource(
      { notes: async () => [{ id: 'a', text: '   ' }] },
      { pluginId: 'blank' },
    )
    expect(await readPersonErasureNotes({ orgId: 'org-1' })).toEqual({ notes: [], unavailable: ['blank'] })
    expect(isPrintablePersonErasureNote({ id: 'a' })).toBe(false)
    expect(isPrintablePersonErasureNote(null)).toBe(false)
    expect(isPrintablePersonErasureNote({ id: 'a', text: 'Kept.' })).toBe(true)
  })

  it('runs the boot step once when nothing is registered, then asks again', async () => {
    const repair = jest.fn(async () => {
      registerPersonErasureNoteSource({ notes: async () => [{ id: 'a', text: 'Kept.' }] }, { pluginId: 'late' })
    })
    registerPluginDeclarationsRepair(repair)
    const read = await readPersonErasureNotes({ orgId: 'org-1' })
    expect(repair).toHaveBeenCalledTimes(1)
    expect(read.notes.map((note) => note.pluginId)).toEqual(['late'])
  })

  it('answers nothing, and nothing missing, when no plugin keeps anything', async () => {
    expect(await readPersonErasureNotes({ orgId: 'org-1' })).toEqual({ notes: [], unavailable: [] })
  })

  it('refuses a source with no notes function', () => {
    expect(() =>
      registerPersonErasureNoteSource({} as never, { pluginId: 'empty' }),
    ).toThrow('a person erasure note source needs a notes function')
  })
})
