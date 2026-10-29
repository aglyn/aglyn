/**
 * @jest-environment node
 *
 * The pragma stays in the FIRST block comment: behind the license header jest
 * ignores it.
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

import type { PluginApiRequest } from '@aglyn/aglyn/server'
import type { FormUploadCalls } from './form-uploads'
import { handleSubmissionFiles, type SubmissionFilesDeps } from './submission-files'
import { readSubmissionFacts } from './submission-facts'
import { sweepFormUploads } from './form-upload-sweep'
import { standInFirestore } from '../testing/stand-in-firestore'

/**
 * A submission's files after it arrives (AGL-4098): downloaded only by who may
 * read the site's submissions and only when the submission names them;
 * released only once the submission is gone; read for another plugin on the
 * Inbox's terms; and swept a day after a form that was never sent.
 */

const SUBMISSION = 'hosts/site1/formSubmissions/sub1'
const FILES = [{ id: 'f1', field: 'artwork', name: 'logo.ai', contentType: 'application/illustrator', size: 900, uploadedAtMs: 4 }]

function seed() {
  return standInFirestore({
    'hosts/site1': { orgId: 'org1', memberRoles: { member: 'viewer' } },
    [SUBMISSION]: {
      orgId: 'org1',
      hostId: 'site1',
      formId: 'quote-form',
      formName: 'Request a quote',
      fields: { name: 'Jane Doe', email: 'jane@example.com', company: 'Acme', details: 'Two banners.', product: 'Banner — Matte', artwork: 'logo.ai' },
      fieldData: { product: '{"productId":"p1","variantId":"v2"}' },
      files: FILES,
      request: { kind: 'quote' },
      emailThread: { messageId: '<form.1@mail.test>', references: ['<form.1@mail.test>'], subject: 'We got your quote request — Acme' },
      capturedRecord: { kind: 'contact', id: 'c1' },
      createdAt: { toMillis: () => 1_234 },
    },
    'hosts/site1/forms/quote-form': {
      fields: [
        { fieldName: 'name', fieldType: 'text', label: 'Your name' },
        { fieldName: 'details', fieldType: 'textarea', label: 'Details' },
      ],
    },
    'orgs/org1/members/admin': { role: 'admin' },
    'orgs/org1/members/collaborator': { role: 'editor', allHosts: false, hostAccess: { other: 'editor' } },
  })
}

function harness() {
  const store = seed()
  const calls: Array<[string, unknown]> = []
  const uploads = {
    removeAll: async (scope: unknown) => void calls.push(['removeAll', scope]),
  } as unknown as FormUploadCalls
  const deps: SubmissionFilesDeps = {
    verifyIdToken: async (token) => ({ uid: token }),
    firestore: () => store.firestore,
    uploads: async () => uploads,
    orgMember: async (orgId, uid) => store.docs.get(`orgs/${orgId}/members/${uid}`) ?? null,
  }
  const call = (uid: string, body: Record<string, unknown>) =>
    handleSubmissionFiles(deps, {
      method: 'POST',
      query: {},
      body: { hostId: 'site1', submissionId: 'sub1', ...body },
      headers: { authorization: `Bearer ${uid}` },
      cookies: {},
      socket: {},
    } as unknown as PluginApiRequest)
  return { store, calls, call, deps }
}

describe('downloading a submission’s file', () => {
  it('serves a site member a file the submission names, from the submission’s own folder', async () => {
    const { call } = harness()
    expect(await call('member', { action: 'download', fileId: 'f1' })).toEqual({
      status: 200,
      body: {},
      file: { path: 'hosts/site1/private/uploads/form-file/sub1/f1', name: 'logo.ai', contentType: 'application/illustrator' },
    })
  })

  it('serves an org-wide member of the submission’s organization, and refuses a collaborator on another site', async () => {
    const { call } = harness()
    expect((await call('admin', { action: 'download', fileId: 'f1' })).status).toBe(200)
    expect(await call('collaborator', { action: 'download', fileId: 'f1' })).toEqual({
      status: 403,
      body: { error: 'You can’t read this site’s submissions.' },
    })
    expect((await call('stranger', { action: 'download', fileId: 'f1' })).status).toBe(403)
  })

  it('refuses a file the submission does not name', async () => {
    const { call } = harness()
    expect((await call('member', { action: 'download', fileId: 'someone-elses' })).status).toBe(404)
  })

  it('answers a refused credential 401, and rethrows anything else', async () => {
    const { deps } = harness()
    const refused = Object.assign(new Error('expired'), { code: 'auth/id-token-expired' })
    const request = { method: 'POST', query: {}, body: { hostId: 'site1', submissionId: 'sub1', action: 'download' }, headers: { authorization: 'Bearer x' }, cookies: {}, socket: {} } as unknown as PluginApiRequest
    expect((await handleSubmissionFiles({ ...deps, verifyIdToken: async () => Promise.reject(refused) }, request)).status).toBe(401)
    await expect(
      handleSubmissionFiles({ ...deps, verifyIdToken: async () => Promise.reject(new Error('network')) }, request),
    ).rejects.toThrow('network')
  })
})

describe('releasing a deleted submission’s files', () => {
  it('deletes them only once the submission is gone', async () => {
    const { store, calls, call } = harness()
    expect(await call('member', { action: 'release' })).toEqual({ status: 409, body: { error: 'This submission is still in the Inbox.' } })
    expect(calls).toEqual([])
    store.docs.delete(SUBMISSION)
    expect(await call('member', { action: 'release' })).toEqual({ status: 200, body: { released: true } })
    expect(calls).toEqual([['removeAll', { hostId: 'site1', purpose: 'form-file', purposeId: 'sub1' }]])
  })
})

describe('a submission’s facts for another plugin', () => {
  const ask = (store: ReturnType<typeof seed>, uid: string, orgId = 'org1') =>
    readSubmissionFacts(
      { firestore: () => store.firestore, orgMember: async (org, member) => store.docs.get(`orgs/${org}/members/${member}`) ?? null },
      { orgId, hostId: 'site1', id: 'sub1', uid, org: null, now: new Date(0) },
    )

  it('answers who sent it, their words, the product value, the files with their private paths, and the conversation', async () => {
    const read = await ask(seed(), 'member')
    expect(read).toEqual({
      ok: true,
      facts: {
        record: 'formSubmission',
        hostId: 'site1',
        formId: 'quote-form',
        formName: 'Request a quote',
        createdAtMs: 1_234,
        request: { kind: 'quote' },
        person: { name: 'Jane Doe', email: 'jane@example.com', phone: '', company: 'Acme' },
        capturedRecord: { kind: 'contact', id: 'c1' },
        message: 'Two banners.',
        answers: [
          { field: 'name', label: 'Your name', value: 'Jane Doe' },
          { field: 'email', label: 'email', value: 'jane@example.com' },
          { field: 'company', label: 'company', value: 'Acme' },
          { field: 'details', label: 'Details', value: 'Two banners.' },
          { field: 'product', label: 'product', value: 'Banner — Matte' },
          { field: 'artwork', label: 'artwork', value: 'logo.ai' },
        ],
        fieldData: { product: '{"productId":"p1","variantId":"v2"}' },
        files: [
          {
            id: 'f1',
            field: 'artwork',
            name: 'logo.ai',
            contentType: 'application/illustrator',
            size: 900,
            path: 'hosts/site1/private/uploads/form-file/sub1/f1',
          },
        ],
        emailThread: { messageId: '<form.1@mail.test>', references: ['<form.1@mail.test>'], subject: 'We got your quote request — Acme' },
      },
    })
  })

  it('refuses a member who may not read the site’s submissions, and a site of another organization', async () => {
    expect(await ask(seed(), 'collaborator')).toEqual({ ok: false, status: 403, error: 'You can’t read this site’s submissions.' })
    expect(await ask(seed(), 'member', 'org2')).toMatchObject({ ok: false, status: 404 })
  })
})

describe('the sweep of forms never sent', () => {
  it('deletes the files of a key whose day has passed, keeps a key a submission took, and drops both records', async () => {
    const store = standInFirestore({
      'hosts/site1/forms/f/formUploadKeys/abandonedabandonedabandoned1': { hostId: 'site1', sweepAtMs: 10 },
      'hosts/site1/forms/f/formUploadKeys/submittedsubmittedsubmitted1': { hostId: 'site1', sweepAtMs: 20 },
      'hosts/site1/formSubmissions/submittedsubmittedsubmitted1': { formName: 'Quote' },
      'hosts/site1/forms/f/formUploadKeys/freshfreshfreshfreshfresh1': { hostId: 'site1', sweepAtMs: 10_000 },
    })
    const removed: unknown[] = []
    const report = await sweepFormUploads(
      { firestore: () => store.firestore, uploads: async () => ({ removeAll: async (scope) => void removed.push(scope) }) },
      { nowMs: 100, deadlineMs: Date.now() + 60_000 },
    )
    expect(report).toEqual({ due: 2, swept: 1, kept: 1, failed: 0 })
    expect(removed).toEqual([{ hostId: 'site1', purpose: 'form-file', purposeId: 'abandonedabandonedabandoned1' }])
    expect([...store.docs.keys()].filter((path) => path.includes('formUploadKeys'))).toEqual([
      'hosts/site1/forms/f/formUploadKeys/freshfreshfreshfreshfresh1',
    ])
  })
})
