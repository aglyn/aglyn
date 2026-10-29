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

import { sanitizeAuthorHtml } from '@aglyn/aglyn/app-utils/author-html'
import type { FormFieldDecl } from '@aglyn/aglyn/app-utils/forms'
import { buildDefaultEmailNodeMap, EMAIL_NODE_ROOT_ID, renderEmailHtml, TENANT_EMAILS } from '@aglyn/shared-util-email'
import { FORM_CONFIRMATION_EMAIL_KEY, formsTenantEmails } from '../tenant-emails'
import {
  FORM_CONFIRMATION_MAX_ANSWERS,
  formConfirmationContent,
  type FormConfirmationInput,
} from './form-confirmation-content'

/**
 * The form confirmation (AGL-4098), rendered from the catalog's built-in copy
 * with the tokens a send composes, through the sanitizer every site email
 * passes.
 */

const DECLS: FormFieldDecl[] = [
  { fieldName: 'name', fieldType: 'text', label: 'Your name' },
  { fieldName: 'email', fieldType: 'email', label: 'Email' },
  { fieldName: 'product', fieldType: 'product', label: 'What should we price?' },
  { fieldName: 'message', fieldType: 'textarea', label: 'Details' },
  { fieldName: 'artwork', fieldType: 'file', label: 'Logo or artwork', fileKinds: ['images', 'design'], maxFiles: 5 },
  { fieldName: 'marketingConsent', fieldType: 'checkbox', label: 'Send me news' },
]

function input(over: Partial<FormConfirmationInput> = {}): FormConfirmationInput {
  return {
    businessName: 'Northwind Signs',
    formName: 'Request a quote',
    request: { kind: 'quote' },
    answers: {
      name: 'Jane Doe',
      email: 'jane@example.com',
      product: 'Vinyl banner — 3 × 6 ft / Matte',
      message: 'Two banners for the spring fair.\nSee https://evil.example/login for the logo.',
      artwork: 'logo.ai, sketch.pdf',
      marketingConsent: 'Yes',
    },
    decls: DECLS,
    consentFieldName: 'marketingConsent',
    fileNames: ['logo.ai', 'sketch.pdf'],
    contactEmail: 'hello@northwind.example',
    contactPhone: '555-0100',
    ...over,
  }
}

function render(content: ReturnType<typeof formConfirmationContent>) {
  const entry = formsTenantEmails().find((email) => email.key === FORM_CONFIRMATION_EMAIL_KEY)
  if (!entry) throw new Error('no form-confirmation entry')
  return renderEmailHtml({
    nodes: buildDefaultEmailNodeMap(entry) as never,
    rootId: EMAIL_NODE_ROOT_ID,
    subject: content.subject,
    merge: { 'host.businessName': 'Northwind Signs', ...content.tokens },
    sanitize: sanitizeAuthorHtml,
  })
}

describe('the form confirmation says what arrived and what happens next (AGL-4098)', () => {
  it('is in the compiled tenant catalog, so the send path finds it without loading this plugin', () => {
    const entry = TENANT_EMAILS.find((email) => email.key === FORM_CONFIRMATION_EMAIL_KEY)
    expect(entry).toMatchObject({ pluginId: 'forms', control: 'besigner', defaultSubject: '{{form.subject}}' })
    // Every token the copy uses is declared, and every declared token is composed.
    const declared = (entry?.mergeTokens ?? []).map((token) => token.name).sort()
    expect(Object.keys(formConfirmationContent(input()).tokens).sort()).toEqual(declared)
  })

  it('a quote request: its own heading, a copy of the answers under the form’s labels, the files, the next step and the contact', () => {
    const content = formConfirmationContent(input())
    expect(content.subject).toBe('We got your quote request — Northwind Signs')
    const { html, text } = render(content)
    expect(text).toContain('Northwind Signs · Request a quote')
    expect(text).toContain('We got your request')
    expect(text).toContain('Thanks for asking Northwind Signs for a quote. Here is a copy of what you sent.')
    expect(text).toContain('Your name: Jane Doe')
    expect(text).toContain('What should we price?: Vinyl banner — 3 × 6 ft / Matte')
    expect(text).toContain('Files you sent: logo.ai, sketch.pdf')
    expect(text).toContain('Northwind Signs will look over your request and email you a quote.')
    expect(text).toContain('You can also reach Northwind Signs at hello@northwind.example or 555-0100.')
    // The opt-in tick and the file field's own line are not copied.
    expect(text).not.toContain('Send me news')
    expect(text).not.toContain('Logo or artwork:')
    expect(html).toContain('We got your request')
  })

  it('takes typed links out of the copy: whoever sends a form picks the address it goes to', () => {
    const { tokens } = formConfirmationContent(input())
    expect(tokens['form.answers']).toContain('Details: Two banners for the spring fair. See [link] for the logo.')
    expect(tokens['form.answers']).not.toContain('evil.example')
  })

  it('an ordinary message: a thank-you, no quote, and no files line when none came', () => {
    const content = formConfirmationContent(input({ request: null, fileNames: [], contactPhone: null }))
    expect(content.subject).toBe('We got your message — Northwind Signs')
    expect(content.tokens['form.heading']).toBe('Thanks, we got your message')
    expect(content.tokens['form.files']).toBe('')
    expect(content.tokens['form.nextStep']).toBe(
      'Northwind Signs will get back to you soon. Reply to this email if you want to add anything.',
    )
    expect(content.tokens['business.contact']).toBe('You can also reach Northwind Signs at hello@northwind.example.')
    expect(render(content).text).not.toContain('Files you sent')
  })

  it('keeps a long survey to its first answers, and a long answer short', () => {
    const answers = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`q${index}`, 'x'.repeat(500)]))
    const { tokens } = formConfirmationContent(input({ answers, decls: [], consentFieldName: null }))
    const lines = tokens['form.answers'].split('\n')
    expect(lines).toHaveLength(FORM_CONFIRMATION_MAX_ANSWERS)
    expect(lines[0].length).toBeLessThanOrEqual('q0: '.length + 300)
    expect(lines[0].endsWith('…')).toBe(true)
  })

  it('names at most six files, then how many more', () => {
    const names = Array.from({ length: 8 }, (_, index) => `file-${index}.png`)
    expect(formConfirmationContent(input({ fileNames: names })).tokens['form.files']).toBe(
      'Files you sent: file-0.png, file-1.png, file-2.png, file-3.png, file-4.png, file-5.png and 2 more',
    )
  })
})
