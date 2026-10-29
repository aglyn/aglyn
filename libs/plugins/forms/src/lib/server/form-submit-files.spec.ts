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

import type { FormFieldDecl } from '@aglyn/aglyn/app-utils/forms'
import type { VisitorUploadFile } from '@aglyn/aglyn/app-utils/visitor-upload'
import { attachFormFiles } from './form-submit-files'
import { standInFirestore } from '../testing/stand-in-firestore'

/**
 * A submission's files, checked before it is stored (AGL-4098): each id is
 * read back from the key's own scope, held to the field that asked for it,
 * and recorded by name; an id that did not arrive refuses the submission.
 */

const KEY = 'b'.repeat(32)
const MARKER = `hosts/site1/forms/quote-form/formUploadKeys/${KEY}`
const DECLS: FormFieldDecl[] = [
  { fieldName: 'name', fieldType: 'text' },
  { fieldName: 'artwork', fieldType: 'file', label: 'Logo or artwork', fileKinds: ['images'], maxFiles: 2 },
]

const kept = (id: string, over: Partial<VisitorUploadFile> = {}): VisitorUploadFile => ({
  id,
  name: `${id}.png`,
  contentType: 'image/png',
  size: 100,
  path: `hosts/site1/private/uploads/form-file/${KEY}/${id}`,
  uploadedAtMs: 7,
  ...over,
})

function setup(
  files: Record<string, VisitorUploadFile> = { f1: kept('f1'), f2: kept('f2') },
  held: Record<string, string> = { f1: 'artwork', f2: 'artwork' },
) {
  const store = standInFirestore({ [MARKER]: { hostId: 'site1', formId: 'quote-form', key: KEY, files: held } })
  const reads: Array<[unknown, string]> = []
  const uploads = {
    read: async (scope: unknown, id: string) => {
      reads.push([scope, id])
      return files[id] ?? null
    },
  }
  const attach = (refs: Array<{ field: string; id: string }>, formId: string | null = 'quote-form') =>
    attachFormFiles({ firestore: store.firestore, hostId: 'site1', formId, decls: DECLS, refs: { key: KEY, refs }, uploads })
  return { store, reads, attach }
}

describe('the files a submission names', () => {
  it('are read from the key’s own scope and recorded by name, and the field’s answer is their names', async () => {
    const { store, reads, attach } = setup()
    const answer = await attach([
      { field: 'artwork', id: 'f1' },
      { field: 'artwork', id: 'f2' },
    ])
    expect(answer).toMatchObject({
      ok: true,
      key: KEY,
      files: [
        { id: 'f1', field: 'artwork', name: 'f1.png', contentType: 'image/png', size: 100, uploadedAtMs: 7 },
        { id: 'f2', field: 'artwork', name: 'f2.png', contentType: 'image/png', size: 100, uploadedAtMs: 7 },
      ],
      answers: { artwork: 'f1.png, f2.png' },
    })
    expect(reads.map(([scope]) => scope)).toEqual([
      { hostId: 'site1', purpose: 'form-file', purposeId: KEY },
      { hostId: 'site1', purpose: 'form-file', purposeId: KEY },
    ])
    // No storage path is recorded on the submission.
    expect(JSON.stringify((answer as { files: unknown }).files)).not.toContain('hosts/')
    // Once the submission holds them, the key's record goes.
    await (answer as { release(): Promise<void> }).release()
    expect(store.docs.has(MARKER)).toBe(false)
  })

  it('refuses an id that did not arrive, or that the key never held', async () => {
    const missing = setup({ f1: kept('f1') }, { f1: 'artwork', f2: 'artwork' })
    expect(await missing.attach([{ field: 'artwork', id: 'f2' }])).toEqual({
      ok: false,
      status: 400,
      error: 'One of your files didn’t arrive. Remove it, attach it again and send the form.',
    })
    const stranger = setup()
    expect(await stranger.attach([{ field: 'artwork', id: 'not-mine' }])).toMatchObject({ ok: false, status: 400 })
    expect(stranger.reads).toEqual([])
  })

  it('refuses a file sent for another field, a field that takes no files, and more than the field takes', async () => {
    const { attach } = setup({ f1: kept('f1'), f2: kept('f2'), f3: kept('f3') }, { f1: 'artwork', f2: 'artwork', f3: 'artwork' })
    expect(await attach([{ field: 'name', id: 'f1' }])).toMatchObject({ ok: false, status: 400 })
    expect(
      await attach([
        { field: 'artwork', id: 'f1' },
        { field: 'artwork', id: 'f2' },
        { field: 'artwork', id: 'f3' },
      ]),
    ).toEqual({ ok: false, status: 400, error: 'Logo or artwork takes fewer files than were sent.' })
  })

  it('refuses a kind the field does not take, a key that lapsed, and a form no entity binds', async () => {
    const pdf = setup({ f1: kept('f1', { contentType: 'application/pdf', name: 'brief.pdf' }) }, { f1: 'artwork' })
    expect(await pdf.attach([{ field: 'artwork', id: 'f1' }])).toMatchObject({ ok: false, status: 400 })
    const lapsed = setup()
    lapsed.store.docs.delete(MARKER)
    expect(await lapsed.attach([{ field: 'artwork', id: 'f1' }])).toEqual({
      ok: false,
      status: 409,
      error: 'Your files took too long to send. Attach them again and send the form.',
    })
    expect(await setup().attach([{ field: 'artwork', id: 'f1' }], null)).toMatchObject({ ok: false, status: 400 })
  })
})
