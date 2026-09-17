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
  AI_CRM_MAX_COLUMNS,
  aiCrmColumnsInput,
  aiCrmEmailProposalOf,
  aiCrmMappingProposalOf,
  aiCrmRecordProposalOf,
  parseAiCrmRequest,
} from '../model/ai-crm'
import type { AiJobSummary } from '../model/ai-jobs.types'
import {
  aiCrmEmailMergeFields,
  aiCrmRecordTool,
  checkAiCrmEmail,
  checkAiCrmMapping,
  checkAiCrmRecord,
} from './ai-crm-tool'

/**
 * The CRM tools' schemas and checks (AGL-2917), and the request and proposal
 * readers the step and the widgets share. The step spec drives these through
 * a generation; this one pins each refusal on its own.
 */

const codes = (result: { violations: Array<{ code: string }> }) => result.violations.map((entry) => entry.code)

describe('the record tool', () => {
  it('gives each kind only the fields its record can use, every one required', () => {
    const keys = (kind: 'contact' | 'company' | 'deal' | 'lead') =>
      Object.keys((aiCrmRecordTool(kind).inputSchema as { properties: object }).properties)
    expect(keys('contact')).toEqual(['summary', 'nextStep'])
    expect(keys('company')).toEqual(['summary', 'nextStep'])
    expect(keys('deal')).toEqual(['summary', 'nextStep', 'stage'])
    expect(keys('lead')).toEqual(['summary', 'standing'])
    const schema = aiCrmRecordTool('deal').inputSchema as { required: string[]; additionalProperties: boolean }
    expect(schema).toMatchObject({ required: ['summary', 'nextStep', 'stage'], additionalProperties: false })
  })

  it('holds a next step to its lengths, kinds and days', () => {
    const step = { title: 'Call Dana', kind: 'call', priority: 'high', dueInDays: 3, reason: 'She opened the quote.' }
    expect(checkAiCrmRecord({ summary: 'Opened the quote.', nextStep: step }, { kind: 'contact' }).value).toEqual({
      summary: 'Opened the quote.',
      nextStep: step,
      stage: null,
      standing: null,
    })
    expect(codes(checkAiCrmRecord({ summary: 'Hi', nextStep: { ...step, dueInDays: 2.5 } }, { kind: 'contact' }))).toEqual(['next-step-due'])
    expect(codes(checkAiCrmRecord({ summary: 'Hi', nextStep: { ...step, kind: 'visit' } }, { kind: 'contact' }))).toEqual(['type'])
    expect(codes(checkAiCrmRecord({ summary: 'Hi', nextStep: { ...step, title: 'x'.repeat(81) } }, { kind: 'company' }))).toEqual(['too-long'])
    expect(codes(checkAiCrmRecord({ summary: '   ', nextStep: null }, { kind: 'contact' }))).toEqual(['missing'])
  })

  it('holds a deal’s stage to its pipeline: an open stage it lists, not the current one, none on a closed deal', () => {
    const stages = [
      { id: 'proposal-sent', name: 'Proposal sent', kind: 'open' },
      { id: 'negotiation', name: 'Negotiation', kind: 'open' },
      { id: 'lost', name: 'Lost', kind: 'lost' },
    ]
    const context = { kind: 'deal' as const, stageId: 'proposal-sent', status: 'open', stages }
    const stage = (stageId: string) => ({ summary: 'Asked for a discount.', nextStep: null, stage: { stageId, reason: 'The call.' } })
    expect(checkAiCrmRecord(stage('negotiation'), context).value?.stage).toEqual({
      stageId: 'negotiation',
      stageName: 'Negotiation',
      reason: 'The call.',
    })
    expect(codes(checkAiCrmRecord(stage('proposal-sent'), context))).toEqual(['stage-current'])
    expect(codes(checkAiCrmRecord(stage('lost'), context))).toEqual(['stage-won-lost'])
    expect(codes(checkAiCrmRecord(stage('closing'), context))).toEqual(['stage-unknown'])
    expect(codes(checkAiCrmRecord(stage('negotiation'), { ...context, status: 'won' }))).toEqual(['stage-closed'])
    expect(checkAiCrmRecord({ summary: 'Won.', nextStep: null, stage: null }, { ...context, status: 'won' }).value).not.toBeNull()
  })

  it('asks a lead for its standing', () => {
    expect(checkAiCrmRecord({ summary: 'Came in twice.', standing: 'New, and active this week.' }, { kind: 'lead' }).value).toEqual({
      summary: 'Came in twice.',
      nextStep: null,
      stage: null,
      standing: 'New, and active this week.',
    })
    expect(codes(checkAiCrmRecord({ summary: 'Came in twice.', standing: 'x'.repeat(281) }, { kind: 'lead' }))).toEqual(['too-long'])
  })
})

describe('the email check', () => {
  const mergeFields = aiCrmEmailMergeFields('contact')

  it('offers a record’s merge fields, and never an address', () => {
    expect(mergeFields).toEqual([
      'contact.firstName',
      'contact.lastName',
      'contact.name',
      'contact.company',
      'contact.title',
      'sender.firstName',
      'sender.name',
      'site.name',
    ])
    expect(aiCrmEmailMergeFields('lead')).toEqual(['lead.firstName', 'lead.lastName', 'lead.name', 'sender.firstName', 'sender.name', 'site.name'])
    expect(aiCrmEmailMergeFields('deal')).toContain('deal.amount')
  })

  it('keeps a plain draft with blank lines, and refuses markdown, addresses, other merge fields and a long subject', () => {
    const body = 'Hi {{contact.firstName}},\n\n\n\nThe quote is attached.   \n\nThanks,\n{{sender.firstName}}'
    expect(checkAiCrmEmail({ subject: 'Your quote', body }, { mergeFields }).value).toEqual({
      subject: 'Your quote',
      body: 'Hi {{contact.firstName}},\n\nThe quote is attached.\n\nThanks,\n{{sender.firstName}}',
    })
    expect(codes(checkAiCrmEmail({ subject: 'Your quote', body: '**Hi** there' }, { mergeFields }))).toEqual(['markdown'])
    expect(codes(checkAiCrmEmail({ subject: 'Your quote', body: 'Write to dana@example.com' }, { mergeFields }))).toEqual(['contact-detail'])
    expect(codes(checkAiCrmEmail({ subject: 'Hi {{contact.email}}', body: 'Hello.' }, { mergeFields }))).toEqual(['merge-field-unknown'])
    expect(codes(checkAiCrmEmail({ subject: 'x'.repeat(101), body: 'Hello.' }, { mergeFields }))).toEqual(['too-long'])
    expect(codes(checkAiCrmEmail({ subject: 'Two\nlines', body: 'Hello.' }, { mergeFields }))).toEqual(['subject-lines'])
    expect(codes(checkAiCrmEmail({ subject: 'Quote', body: 'x'.repeat(1_201) }, { mergeFields }))).toEqual(['too-long'])
  })
})

describe('the mapping check', () => {
  const columns = [
    { header: 'Email', shape: 'email' as const },
    { header: 'Owner', shape: 'email' as const },
    { header: 'Phone', shape: 'number' as const },
    { header: 'Blank', shape: 'empty' as const },
    { header: 'Opted in', shape: 'text' as const },
  ]
  const fields = [
    { key: 'email', label: 'Email', type: 'email', required: true },
    { key: 'name', label: 'Name', type: 'text', required: false },
    { key: 'phone', label: 'Phone', type: 'phone', required: false },
    { key: 'marketingConsent', label: 'Consent', type: 'yes-no', required: false },
    { key: 'ownerEmail', label: 'Owner', type: 'email', required: false },
  ]
  const check = (matches: Array<{ column: number; field: number }>) => checkAiCrmMapping({ matches }, { columns, fields })

  it('names each match, in column order', () => {
    expect(check([{ column: 2, field: 2 }, { column: 0, field: 0 }, { column: 3, field: 1 }]).value).toEqual([
      { column: 0, header: 'Email', field: 'email', label: 'Email' },
      { column: 2, header: 'Phone', field: 'phone', label: 'Phone' },
      { column: 3, header: 'Blank', field: 'name', label: 'Name' },
    ])
    expect(check([]).value).toEqual([])
  })

  it('refuses a column or field it does not have, either one twice, and a shape its field cannot take', () => {
    expect(codes(check([{ column: 9, field: 0 }]))).toEqual(['column-unknown'])
    expect(codes(check([{ column: 0, field: 9 }]))).toEqual(['field-unknown'])
    expect(codes(check([{ column: 0, field: 0 }, { column: 0, field: 4 }]))).toEqual(['column-twice'])
    expect(codes(check([{ column: 0, field: 0 }, { column: 1, field: 0 }]))).toEqual(['field-twice'])
    expect(codes(check([{ column: 4, field: 3 }]))).toEqual(['shape-mismatch'])
    expect(codes(check([{ column: 1, field: 1 }]))).toEqual(['shape-mismatch'])
    expect(codes(checkAiCrmMapping({ matches: 'all' }, { columns, fields }))).toEqual(['type'])
  })
})

describe('the request and the proposals', () => {
  it('reads what a job is asked, bounded', () => {
    expect(parseAiCrmRequest({ task: 'record', record: 'deal', recordId: 'd-1' })).toEqual({
      task: 'record',
      record: { kind: 'deal', id: 'd-1' },
    })
    expect(parseAiCrmRequest({ task: 'email', record: 'company', recordId: 'c-1' })).toBe(
      'Open the CRM record this is about first',
    )
    expect(parseAiCrmRequest({ task: 'record', record: 'contact', recordId: '../x' })).toBe(
      'Open the CRM record this is about first',
    )
    const columns = Array.from({ length: AI_CRM_MAX_COLUMNS + 5 }, (_, index) => ({
      header: `  Column   ${index}  `,
      shape: 'text' as const,
    }))
    const request = parseAiCrmRequest({ task: 'mapping', collection: 'leads', columns: aiCrmColumnsInput(columns) })
    expect(typeof request !== 'string' && request.task === 'mapping' && request.columns.length).toBe(AI_CRM_MAX_COLUMNS)
    expect(typeof request !== 'string' && request.task === 'mapping' && request.columns[0]).toEqual({ header: 'Column 0', shape: 'text' })
    expect(parseAiCrmRequest({ task: 'mapping', collection: 'leads', columns: '[{"header":"A","shape":"cell"}]' })).toMatch(/^Choose a file/)
    expect(parseAiCrmRequest({ task: 'mapping', collection: 'invoices', columns: '[]' })).toBe('Open the import this is for first')
    expect(parseAiCrmRequest({})).toBe('This CRM request does not say what it is for')
  })

  it('finds each proposal on a job by the record or the import it is about', () => {
    const job = {
      outputs: [
        { resource: 'crm', id: 'record:contact:c-1', hostId: null, label: 'CRM summary', proposal: { kind: 'record', record: { kind: 'contact', id: 'c-1' }, summary: 'S' } },
        { resource: 'crm', id: 'email:lead:l-1', hostId: 'h', label: 'CRM email draft', proposal: { kind: 'email', record: { kind: 'lead', id: 'l-1' }, subject: 'S', body: 'B' } },
        { resource: 'crm', id: 'mapping:deals', hostId: 'h', label: 'Import column matches', proposal: { kind: 'mapping', collection: 'deals', matches: [], columns: 2 } },
        { resource: 'seo', id: 'fields', hostId: 'h', label: 'SEO', proposal: { kind: 'record', record: { kind: 'contact', id: 'c-1' }, summary: 'Not a CRM output' } },
      ],
    } as unknown as AiJobSummary
    expect(aiCrmRecordProposalOf(job, { kind: 'contact', id: 'c-1' })?.summary).toBe('S')
    expect(aiCrmRecordProposalOf(job, { kind: 'deal', id: 'c-1' })).toBeNull()
    expect(aiCrmEmailProposalOf(job, { kind: 'lead', id: 'l-1' })?.body).toBe('B')
    expect(aiCrmMappingProposalOf(job, 'deals')?.columns).toBe(2)
    expect(aiCrmMappingProposalOf(null, 'deals')).toBeNull()
  })
})
