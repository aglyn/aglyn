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

import { setRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  pluginResourceDraftWriter,
  registerPluginResourceDraftWriter,
  type PluginDraftContext,
  type PluginDraftRecord,
  type PluginDraftRequest,
  type PluginResourceDraftWriter,
} from './plugin-resource-drafts'
import { resetPluginServicesForTests, unregisterPluginServices } from './plugin-services'

/**
 * The seam with no email, campaign or AI in it: a `notes` plugin owns a
 * resource, and an `importer` plugin that knows nothing about notes turns a
 * file's lines into note drafts through the writer the notes plugin
 * registered — refused where the notes plugin refuses, checked by its check,
 * and never written twice for one id.
 */

const NOW = new Date('2026-09-15T20:00:00.000Z')

/** The notes plugin's own store and rules; nothing outside its writer touches either. */
function notesPlugin() {
  const drafts = new Map<string, PluginDraftRecord & { hostId: string; body: string }>()
  const writer: PluginResourceDraftWriter = {
    refusal: async ({ uid }) =>
      uid === 'viewer' ? { status: 403, error: 'Writing notes requires the editor role' } : null,
    check: (content) => {
      const body = content['body']
      return typeof body === 'string' && body.trim()
        ? { ok: true, facts: { words: body.trim().split(/\s+/).length } }
        : { ok: false, problems: ['A note needs a body'] }
    },
    read: async ({ hostId, id }) => {
      const draft = drafts.get(`${hostId}/${id}`)
      return draft ? { id: draft.id, name: draft.name, versionId: null, facts: {} } : null
    },
    write: async (request: PluginDraftRequest) => {
      const existing = drafts.get(`${request.hostId}/${request.id}`)
      if (existing) {
        return { ok: true, replayed: true, id: existing.id, name: existing.name, versionId: null, facts: {} }
      }
      const checked = writer.check(request.content, { hostId: request.hostId })
      if (checked.ok === false) return { ok: false, status: 400, error: checked.problems[0] }
      drafts.set(`${request.hostId}/${request.id}`, {
        id: request.id,
        name: request.name,
        versionId: null,
        facts: {},
        hostId: request.hostId,
        body: String(request.content['body']),
      })
      return { ok: true, replayed: false, id: request.id, name: request.name, versionId: null, facts: {} }
    },
  }
  return { drafts, writer }
}

/** The importer: it names the resource, never the plugin that writes it. */
async function importLines(hostId: string, uid: string, lines: string[]) {
  const found = pluginResourceDraftWriter('note')
  if (!found) return { imported: 0, refused: 'Notes are not available on this site' }
  const context: PluginDraftContext = { orgId: 'org-1', hostId, uid, org: null, now: NOW }
  const refusal = await found.writer.refusal(context)
  if (refusal) return { imported: 0, refused: refusal.error }
  let imported = 0
  for (const [index, line] of lines.entries()) {
    if (found.writer.check({ body: line }, { hostId }).ok === false) continue
    const written = await found.writer.write({
      ...context,
      id: `import-${index}`,
      name: `Line ${index + 1}`,
      content: { body: line },
    })
    if (written.ok && !written.replayed) imported += 1
  }
  return { imported, refused: null }
}

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
})

describe('resource drafts', () => {
  it('lets a plugin write another plugin’s resource through the owner’s writer, and nothing else', async () => {
    const notes = notesPlugin()
    setRegisteringPluginId('notes')
    registerPluginResourceDraftWriter('note', notes.writer)
    setRegisteringPluginId(undefined)

    expect(pluginResourceDraftWriter('note')).toEqual({ pluginId: 'notes', writer: notes.writer })
    expect(await importLines('host-1', 'uid-1', ['Buy flour', '   ', 'Call the mill'])).toEqual({
      imported: 2,
      refused: null,
    })
    expect([...notes.drafts.keys()]).toEqual(['host-1/import-0', 'host-1/import-2'])
    // Run again: the owner reports the drafts it already holds, and makes none.
    expect(await importLines('host-1', 'uid-1', ['Buy flour', '   ', 'Call the mill'])).toEqual({
      imported: 0,
      refused: null,
    })
    expect(await notes.writer.read({ hostId: 'host-1', id: 'import-2' })).toMatchObject({ name: 'Line 3' })
  })

  it('refuses where the owner refuses, before anything is written', async () => {
    const notes = notesPlugin()
    registerPluginResourceDraftWriter('note', notes.writer, { pluginId: 'notes' })
    expect(await importLines('host-1', 'viewer', ['Buy flour'])).toEqual({
      imported: 0,
      refused: 'Writing notes requires the editor role',
    })
    expect(notes.drafts.size).toBe(0)
  })

  it('answers null for a resource no plugin writes, and after its owner unloads', async () => {
    expect(pluginResourceDraftWriter('note')).toBeNull()
    expect(await importLines('host-1', 'uid-1', ['Buy flour'])).toEqual({
      imported: 0,
      refused: 'Notes are not available on this site',
    })
    registerPluginResourceDraftWriter('note', notesPlugin().writer, { pluginId: 'notes' })
    unregisterPluginServices('notes')
    expect(pluginResourceDraftWriter('note')).toBeNull()
  })

  it('keeps one owner per resource: a second plugin is refused naming both, and the owner re-registers its own', () => {
    const first = notesPlugin()
    const second = notesPlugin()
    registerPluginResourceDraftWriter('note', first.writer, { pluginId: 'notes' })
    expect(() =>
      registerPluginResourceDraftWriter('note', second.writer, { pluginId: 'clipper' }),
    ).toThrow('resource "note" already has a draft writer from "notes"; refused "clipper"')
    expect(pluginResourceDraftWriter('note')?.writer).toBe(first.writer)

    registerPluginResourceDraftWriter('note', second.writer, { pluginId: 'notes' })
    expect(pluginResourceDraftWriter('note')).toEqual({ pluginId: 'notes', writer: second.writer })
    // Another resource from another plugin is its own key.
    registerPluginResourceDraftWriter('clipping', first.writer, { pluginId: 'clipper' })
    expect(pluginResourceDraftWriter('clipping')?.pluginId).toBe('clipper')
  })

  it('needs a resource name and an owner', () => {
    expect(() => registerPluginResourceDraftWriter('  ', notesPlugin().writer, { pluginId: 'notes' })).toThrow(
      'a resource draft writer needs a resource name',
    )
    expect(() => registerPluginResourceDraftWriter('note', notesPlugin().writer)).toThrow(/no owner/)
  })
})
