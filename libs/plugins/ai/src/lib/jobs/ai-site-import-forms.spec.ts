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
 * A form on a page brought in is rebuilt as the site's own (AGL-4083): the
 * same fields, required marks and button, built of the site's form elements
 * by code, with no model and no credits, its answers in the Inbox.
 */

import { checkFormContract } from '@aglyn/aglyn/app-utils/form-contract'
import type { AiJobItemLedger } from '../model/ai-jobs.types'
import type { AiSiteImportPage, AiSiteImportState, SiteImportLayout } from '../model/ai-site-import'
import { SITE_LAYOUT_PAGES, siteLayoutRecording, siteLayoutSameSite } from '../site-import/fixtures/site-layout-recordings'
import { extractSiteImportPage, type SiteImportBlock, type SiteImportForm } from '../site-import/site-import-html'
import { siteImportLayout } from '../site-import/site-import-layout'
import { AI_FORM_CONSENT_FIELD_NAME, aiFormDraft, aiFormDraftViolations } from './ai-job-form-step'
import {
  AI_SITE_IMPORT_FORM_COPY,
  AI_SITE_IMPORT_FORM_DEFAULT_NAME,
  aiRebuildImportedForms,
  aiSiteImportFormPlaces,
  aiSiteImportFormsOwed,
  aiSiteImportFormSignature,
  aiSiteImportFormTree,
} from './ai-site-import-forms'

/** The recorded /contact page as a wave reads it. */
function contact(): { form: SiteImportForm; layout: SiteImportLayout; blocks: SiteImportBlock[] } {
  const page = extractSiteImportPage(siteLayoutRecording('contact'), SITE_LAYOUT_PAGES.contact.url, siteLayoutSameSite('contact'), { structure: true })
  return { form: page.forms.kept[0] as SiteImportForm, layout: siteImportLayout(page as never) as SiteImportLayout, blocks: page.blocks.filter((block) => block.region === 'main') }
}

const draftOf = (form: SiteImportForm, formId = 'form-1', name = 'Send us a message') =>
  aiFormDraft(aiSiteImportFormTree(form), { routing: { kind: 'inbox', list: null }, cannotCollect: [] }, { formId, name })

describe('a form rebuilt from what its page asks', () => {
  it('keeps /contact’s fields and button, drops its own marketing box for the platform’s consent field, and reads no honeypot', () => {
    const { form } = contact()
    expect(form.submit).toBe('Send message')
    const draft = draftOf(form)
    expect(draft.fields).toEqual([
      { fieldName: 'name', fieldType: 'text', label: 'Name', required: true },
      { fieldName: 'email', fieldType: 'email', label: 'Email', required: true },
      { fieldName: 'message', fieldType: 'textarea', label: 'Message', required: true },
      expect.objectContaining({ fieldName: AI_FORM_CONSENT_FIELD_NAME, fieldType: 'checkbox' }),
    ])
    expect(draft.consentFieldName).toBe(AI_FORM_CONSENT_FIELD_NAME)
    expect(draft.routing).toBeNull()
    expect(draft.nodes[draft.formNodeId]?.props).toMatchObject({ formId: 'form-1', formName: 'Send us a message', submitLabel: 'Send message' })
    expect(JSON.stringify(draft.nodes)).not.toContain('website')
  })

  it('is a form the form contract takes, as a published one must be', () => {
    const draft = draftOf(contact().form)
    expect(aiFormDraftViolations(draft, 'form-1', {})).toEqual([])
    expect(checkFormContract({ form: { consentFieldName: draft.consentFieldName ?? undefined }, formId: 'form-1', nodes: draft.nodes as never, formNodeId: draft.formNodeId })).toEqual([])
  })

  it('builds every kind of field of the site’s own elements', () => {
    const form: SiteImportForm = {
      submit: 'Book',
      fields: [
        { type: 'tel', name: 'phone', label: 'Phone', placeholder: '555 0100' },
        { type: 'select', name: 'topic', label: 'Topic', required: true, options: ['Sales', 'Support'] },
        { type: 'radio', name: 'how', label: 'How', options: ['Email', 'Phone'] },
        { type: 'checkbox', name: 'kinds', label: 'Kinds', options: ['Pots', 'Bowls'] },
        { type: 'checkbox', name: 'agree', label: 'I agree', required: true },
        { type: 'date', name: 'day', label: 'Day' },
        { type: 'time', name: 'hour', label: 'Hour' },
        { type: 'url', name: 'site', label: 'Your site' },
        { type: 'number', name: 'count', label: 'How many' },
      ],
    }
    const draft = draftOf(form)
    expect(draft.fields.map((field) => [field.fieldName, field.fieldType, field.required ?? false, field.options ?? []])).toEqual([
      ['phone', 'text', false, []],
      ['topic', 'select', true, ['Sales', 'Support']],
      ['how', 'radio', false, ['Email', 'Phone']],
      ['kinds', 'checkbox', false, ['Pots', 'Bowls']],
      ['agree', 'checkbox', true, ['I agree']],
      ['day', 'date', false, []],
      ['hour', 'time', false, []],
      ['site', 'text', false, []],
      ['count', 'text', false, []],
    ])
    expect(aiFormDraftViolations(draft, 'form-1', {})).toEqual([])
  })

  it('gives each field a name of its own, from its words where the source’s reads as none', () => {
    const draft = draftOf({ fields: [{ type: 'text', name: 'entry.1234', label: 'Your full name' }, { type: 'text', name: '', label: 'Your full name' }, { type: 'text', name: 'a b' }] })
    expect(draft.fields.map((field) => field.fieldName)).toEqual(['yourFullName', 'yourFullName2', 'field3'])
  })

  it('draws a list with no choices as a line to type in, never an empty list', () => {
    expect(draftOf({ fields: [{ type: 'select', name: 'topic', label: 'Topic', options: [] }] }).fields[0]).toMatchObject({ fieldName: 'topic', fieldType: 'text' })
  })
})

describe('what identifies a form, and what it is called', () => {
  it('is the same form on every page that asks the same, and another where it asks something else', () => {
    const { form } = contact()
    expect(aiSiteImportFormSignature(form)).toBe(aiSiteImportFormSignature({ ...form }))
    expect(aiSiteImportFormSignature({ ...form, submit: 'Go' })).not.toBe(aiSiteImportFormSignature(form))
    expect(aiSiteImportFormSignature({ ...form, fields: form.fields.slice(1) })).not.toBe(aiSiteImportFormSignature(form))
  })

  it('names a form by the heading above it, and only one in its own section', () => {
    const { layout, blocks } = contact()
    expect(aiSiteImportFormPlaces(layout, blocks)).toEqual([{ form: 0, heading: 'Send us a message' }])
    const bare: SiteImportLayout = { ...layout, sections: [{ ...layout.sections[0], nodes: [{ kind: 'form', form: 0 }] } as SiteImportLayout['sections'][number]] }
    expect(aiSiteImportFormPlaces(bare, blocks)).toEqual([{ form: 0, heading: null }])
  })
})

describe('a page’s forms, as the site’s own', () => {
  const NOW = new Date('2026-11-01T12:00:00.000Z')
  const job = { $id: 'importJob', orgId: 'org', createdBy: 'uid' }
  const read = () => {
    const { form, layout, blocks } = contact()
    return { at: 'x', title: 'Contact', text: '', sections: [], images: [], blocks, layout, forms: [form] }
  }
  const page = (extra: Partial<AiSiteImportPage> = {}) => ({ slot: 'p1', title: 'Contact', draftId: 'd1', read: read(), ...extra }) as AiSiteImportPage
  const state = (pages: AiSiteImportPage[] = []) => ({ pages }) as unknown as AiSiteImportState
  const firestore = {} as FirebaseFirestore.Firestore
  const rebuild = (deps: { saved?: Array<{ id: string; name: string; fields: string[] }>; write?: jest.Mock }, next = state()) =>
    aiRebuildImportedForms(firestore, { job, hostId: 'host', state: next, page: page(), org: null, now: NOW }, {
      readInventory: (async () => ({ forms: deps.saved ?? [] })) as never,
      writeDraft: (deps.write ?? jest.fn(async () => ({ ok: true, replayed: false, id: 'x', versionId: null, name: 'Send us a message', hostSubdomain: 'demo' }))) as never,
    })

  it('owes a form only where the layout placed one that asks something', () => {
    expect(aiSiteImportFormsOwed(page())).toEqual([{ form: 0, heading: 'Send us a message' }])
    expect(aiSiteImportFormsOwed(page({ read: { ...read(), forms: [{ fields: [] }] } }))).toEqual([])
    expect(aiSiteImportFormsOwed(page({ read: { ...read(), layout: null } }))).toEqual([])
  })

  it('writes one form for a site that has none, at no credits, and places it', async () => {
    const write = jest.fn(async () => ({ ok: true, replayed: false, id: 'x', versionId: null, name: 'Send us a message', hostSubdomain: 'demo' }))
    const rebuilt = await rebuild({ write })
    expect(write).toHaveBeenCalledTimes(1)
    const [, input] = write.mock.calls[0] as unknown as [unknown, Record<string, any>]
    expect(input).toMatchObject({ kind: 'form', hostId: 'host', uid: 'uid', name: 'Send us a message', form: { consentFieldName: AI_FORM_CONSENT_FIELD_NAME, routing: null } })
    expect(input['id']).toMatch(/^importJob-form-[0-9a-f]{12}$/)
    expect(rebuilt.forms).toEqual([{ index: 0, formId: input['id'] }])
    expect(rebuilt.rows).toEqual([expect.objectContaining({ op: 'form', status: 'succeeded', creditsSpent: 0, creditsRefunded: 0, outputs: [input['id']] })] as AiJobItemLedger[])
    expect(rebuilt.outputs).toEqual([expect.objectContaining({ resource: 'form', id: input['id'], label: 'Send us a message' })])
    expect(rebuilt.note).toBe(AI_SITE_IMPORT_FORM_COPY.rebuilt('Send us a message'))
  })

  it('writes the one form under one id however often the pass runs', async () => {
    const write = jest.fn(async () => ({ ok: true, replayed: true, id: 'x', versionId: null, name: 'Send us a message', hostSubdomain: 'demo' }))
    await rebuild({ write })
    await rebuild({ write })
    const ids = write.mock.calls.map((call) => (call as unknown as [unknown, { id: string }])[1].id)
    expect(new Set(ids).size).toBe(1)
  })

  it('places a form the site already has, whatever it is called', async () => {
    const write = jest.fn()
    const rebuilt = await rebuild({ write, saved: [{ id: 'other', name: 'Newsletter', fields: ['address'] }, { id: 'saved', name: 'Say hello', fields: ['message', 'email', 'name', 'marketingConsent'] }] })
    expect(write).not.toHaveBeenCalled()
    expect(rebuilt).toEqual({ forms: [{ index: 0, formId: 'saved' }], rows: [], outputs: [], note: null })
  })

  it('gives a site’s one form to the first form an import meets, as it always has, and no later one', async () => {
    const write = jest.fn(async () => ({ ok: true, replayed: false, id: 'x', versionId: null, name: 'Send us a message', hostSubdomain: 'demo' }))
    const only = [{ id: 'only', name: 'Contact', fields: ['address'] }]
    expect((await rebuild({ write, saved: only })).forms).toEqual([{ index: 0, formId: 'only' }])
    expect(write).not.toHaveBeenCalled()
    const met = state([page({ slot: 'p0', forms: [{ index: 0, formId: 'only' }] })])
    expect((await rebuild({ write, saved: only }, met)).forms[0]?.formId).toMatch(/^importJob-form-/)
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('keeps the page’s words and says why on a site with no room for another form', async () => {
    const write = jest.fn(async () => ({ ok: false, status: 403, error: 'Your plan includes 1 forms' }))
    expect(await rebuild({ write })).toEqual({ forms: [{ index: 0, formId: null }], rows: [], outputs: [], note: AI_SITE_IMPORT_FORM_COPY.noRoom })
  })

  it('stops on a site that went away, for the machine to say so', async () => {
    await expect(rebuild({ write: jest.fn(async () => ({ ok: false, status: 404, error: 'Unknown site' })) })).rejects.toThrow('vanished')
  })

  it('names a field no form can take', async () => {
    const withFile = { ...read(), forms: [{ ...read().forms[0], leftOut: ['Your résumé'] }] }
    const rebuilt = await aiRebuildImportedForms(firestore, { job, hostId: 'host', state: state(), page: page({ read: withFile }), org: null, now: NOW }, {
      readInventory: (async () => ({ forms: [] })) as never,
      writeDraft: (async () => ({ ok: true, replayed: false, id: 'x', versionId: null, name: 'Send us a message', hostSubdomain: 'demo' })) as never,
    })
    expect(rebuilt.note).toContain('“Your résumé”')
  })

  it('calls a form with no heading above it by the default name', () => {
    expect(AI_SITE_IMPORT_FORM_DEFAULT_NAME).toBe('Contact form')
  })
})
