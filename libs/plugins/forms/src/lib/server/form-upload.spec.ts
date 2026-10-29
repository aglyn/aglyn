/**
 * @jest-environment node
 *
 * The pragma stays in the FIRST block comment: behind the license header jest
 * ignores it, and `Request` is then not a constructor.
 *
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

import type { FormUploadCalls } from './form-uploads'
import { handleFormUpload, type FormUploadDeps } from './form-upload'
import { standInFirestore } from '../testing/stand-in-firestore'

/**
 * `POST /api/forms/upload` (AGL-4098): a form's files go up only for a form on
 * the site that declares a File upload field of that name, of the kinds and
 * up to the number the author set, under the pending key the page minted.
 */

const KEY = 'a'.repeat(32)
const FORM = 'hosts/site1/forms/quote-form'
const MARKER = `${FORM}/formUploadKeys/${KEY}`

function setup(form: Record<string, any> = {}) {
  const store = standInFirestore({
    'hosts/site1': { subdomain: 'acme' },
    [FORM]: {
      displayName: 'Request a quote',
      fields: [
        { fieldName: 'name', fieldType: 'text' },
        { fieldName: 'artwork', fieldType: 'file', fileKinds: ['images', 'pdf'], maxFiles: 2 },
      ],
      ...form,
    },
  })
  const calls: Array<[string, unknown]> = []
  let nextId = 0
  const uploads: FormUploadCalls = {
    mint: async (input) => {
      calls.push(['mint', input])
      return { ok: true, ticket: `ticket-${++nextId}`, upload: { url: 'https://storage.test/b', fields: {} }, file: { id: `f${nextId}`, name: 'x', contentType: 'image/png', size: 1 } }
    },
    finalize: async (input) => {
      calls.push(['finalize', input])
      const id = String(input.ticket).replace('ticket-', 'f')
      return {
        ok: true,
        file: { id, name: `${id}.png`, contentType: 'image/png', size: 10, path: `hosts/site1/private/uploads/form-file/${KEY}/${id}`, uploadedAtMs: 5 },
      }
    },
    read: async () => null,
    remove: async (path) => void calls.push(['remove', path]),
    removeAll: async (scope) => void calls.push(['removeAll', scope]),
    send: async () => undefined,
  }
  const deps: FormUploadDeps = { firestore: () => store.firestore, uploads: async () => uploads, now: () => 1_000 }
  const post = async (body: Record<string, unknown>) => {
    const response = await handleFormUpload(
      deps,
      new Request('https://acme.test/api/forms/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
        body: JSON.stringify({ hostId: 'site1', formId: 'quote-form', key: KEY, field: 'artwork', ...body }),
      }),
    )
    return { status: response.status, body: (await response.json()) as Record<string, any> }
  }
  return { store, calls, post }
}

const FILE = { name: 'logo.png', contentType: 'image/png', size: 10 }

describe('a ticket', () => {
  it('is signed for the key’s own scope, held to the field’s kinds, and the key is recorded under its form', async () => {
    const { store, calls, post } = setup()
    const answer = await post({ action: 'ticket', file: FILE })
    expect(answer.status).toBe(200)
    expect(answer.body['ticket']).toBe('ticket-1')
    expect(calls[0]).toEqual([
      'mint',
      {
        scope: { hostId: 'site1', purpose: 'form-file', purposeId: KEY },
        request: FILE,
        caller: { ip: '203.0.113.9' },
        kinds: ['images', 'pdf'],
      },
    ])
    expect(store.docs.get(MARKER)).toEqual({
      hostId: 'site1',
      formId: 'quote-form',
      key: KEY,
      createdAtMs: 1_000,
      files: {},
      sweepAtMs: 1_000 + 24 * 60 * 60 * 1000,
    })
  })

  it('is refused for a form the site does not have, a retired one, and a field that takes no files', async () => {
    const missing = setup()
    missing.store.docs.delete(FORM)
    expect((await missing.post({ action: 'ticket', file: FILE })).status).toBe(404)
    const retired = setup({ archivedAt: 5 })
    expect((await retired.post({ action: 'ticket', file: FILE })).status).toBe(404)
    const notFiles = setup()
    const answer = await notFiles.post({ action: 'ticket', field: 'name', file: FILE })
    expect(answer).toEqual({ status: 404, body: { error: 'This form doesn’t take files here.' } })
    for (const { calls } of [missing, retired, notFiles]) expect(calls).toEqual([])
  })

  it('is refused for a key that is not one, before anything is read', async () => {
    const { calls, post } = setup()
    expect((await post({ action: 'ticket', key: 'short', file: FILE })).status).toBe(400)
    expect((await post({ action: 'ticket', key: '../../etc', file: FILE })).status).toBe(400)
    expect(calls).toEqual([])
  })

  it('is refused once the field holds all it takes', async () => {
    const { store, calls, post } = setup()
    store.docs.set(MARKER, { hostId: 'site1', formId: 'quote-form', key: KEY, files: { f1: 'artwork', f2: 'artwork' } })
    expect(await post({ action: 'ticket', file: FILE })).toEqual({
      status: 409,
      body: { error: 'This field takes up to 2 files.' },
    })
    expect(calls).toEqual([])
  })

  it('answers the honeypot quietly and mints nothing', async () => {
    const { calls, post } = setup()
    expect(await post({ action: 'ticket', file: FILE, website: 'spam' })).toEqual({ status: 200, body: { received: true } })
    expect(calls).toEqual([])
  })
})

describe('finalize and remove', () => {
  it('records the kept file against its field on the key', async () => {
    const { store, post } = setup()
    await post({ action: 'ticket', file: FILE })
    const kept = await post({ action: 'finalize', ticket: 'ticket-1' })
    expect(kept).toEqual({
      status: 200,
      body: { file: { id: 'f1', name: 'f1.png', contentType: 'image/png', size: 10, uploadedAtMs: 5 } },
    })
    expect(store.docs.get(MARKER)?.['files']).toEqual({ f1: 'artwork' })
  })

  it('deletes a file whose key was swept, and says to attach it again', async () => {
    const { calls, post } = setup()
    const answer = await post({ action: 'finalize', ticket: 'ticket-9' })
    expect(answer.status).toBe(410)
    expect(calls).toContainEqual(['remove', `hosts/site1/private/uploads/form-file/${KEY}/f9`])
  })

  it('removes only a file the key holds, and forgets it', async () => {
    const { store, calls, post } = setup()
    store.docs.set(MARKER, { hostId: 'site1', formId: 'quote-form', key: KEY, files: { f1: 'artwork', f2: 'artwork' } })
    expect(await post({ action: 'remove', fileId: 'f1' })).toEqual({ status: 200, body: { removed: true } })
    expect(calls).toEqual([['remove', `hosts/site1/private/uploads/form-file/${KEY}/f1`]])
    expect(store.docs.get(MARKER)?.['files']).toEqual({ f2: 'artwork' })
    // A file this key never held is not touched.
    expect(await post({ action: 'remove', fileId: 'someone-elses' })).toEqual({ status: 200, body: { removed: true } })
    expect(calls).toHaveLength(1)
  })
})
