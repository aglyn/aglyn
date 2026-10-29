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

import { isEmailMessageId } from '@aglyn/shared-util-email'
import {
  FORM_CONFIRMATIONS_PER_ADDRESS,
  sendFormConfirmation,
  type FormConfirmationDeps,
  type FormConfirmationInput,
} from './form-confirmation-email'

/**
 * The confirmation a form emails the person who sent it (AGL-4098): curated
 * copy in the site's email, Reply-To the site's contact, the FIRST message of
 * a conversation, refused only for a bounced or complaining address, limited
 * per address, and metered.
 */

const HOST = {
  displayName: 'Northwind Signs',
  cname: 'northwind.example',
  seo: { entity: { name: 'Northwind Signs', email: 'hello@northwind.example', telephone: '555-0100' } },
}

function input(over: Partial<FormConfirmationInput> = {}): FormConfirmationInput {
  return {
    hostId: 'site1',
    host: HOST,
    org: null,
    to: 'jane@example.com',
    formName: 'Request a quote',
    request: { kind: 'quote' },
    answers: { name: 'Jane Doe', email: 'jane@example.com', message: 'Two banners, please.' },
    decls: [{ fieldName: 'name', fieldType: 'text', label: 'Your name' }],
    consentFieldName: null,
    fileNames: ['logo.ai'],
    atMs: Date.UTC(2026, 9, 29),
    ...over,
  }
}

function harness(over: Partial<FormConfirmationDeps> = {}) {
  const sent: Array<Parameters<FormConfirmationDeps['send']>[0]> = []
  const rendered: Array<Record<string, string>> = []
  const metered: string[] = []
  const limits: string[] = []
  const deps: FormConfirmationDeps = {
    configured: () => true,
    sendingIdentity: async () =>
      ({ from: 'Northwind Signs <hello@mail.northwind.example>', source: 'site', domain: 'mail.northwind.example', summary: '', refusal: null }) as never,
    render: async (_hostId, _key, tokens) => {
      rendered.push(tokens)
      return { subject: tokens['form.subject'], html: `<p>${tokens['form.heading']}</p>`, text: tokens['form.heading'] }
    },
    send: async (options) => {
      sent.push(options)
      return { sent: true, id: 'provider-1' } as never
    },
    meter: async (hostId) => void metered.push(hostId),
    suppression: async () => null,
    consumeRateLimit: async (key) => {
      limits.push(key)
      return { allowed: true }
    },
    ...over,
  }
  return { deps, sent, rendered, metered, limits }
}

describe('the form confirmation', () => {
  it('starts the conversation: its own Message-ID and nothing to reply to, kept as the thread the quote replies into', async () => {
    const { deps, sent, metered } = harness()
    const result = await sendFormConfirmation(input(), deps)
    expect(result.sent).toBe(true)
    const done = result as Extract<typeof result, { sent: true }>
    expect(isEmailMessageId(done.messageId)).toBe(true)
    expect(done.messageId).toMatch(/@mail\.northwind\.example>$/)
    expect(sent[0].headers).toEqual({ 'Message-ID': done.messageId })
    expect(done.thread).toEqual({ messageId: done.messageId, references: [done.messageId], subject: 'We got your quote request — Northwind Signs' })
    expect(sent[0]).toMatchObject({
      to: 'jane@example.com',
      subject: 'We got your quote request — Northwind Signs',
      replyTo: 'hello@northwind.example',
      audience: 'tenant',
      context: 'form confirmation',
    })
    // Not declared owed: its answers were typed by whoever sent the form.
    expect(sent[0]).not.toHaveProperty('owedFor')
    expect(metered).toEqual(['site1'])
  })

  it('says what they sent, with the files and the business’s contact', async () => {
    const { deps, rendered } = harness()
    await sendFormConfirmation(input(), deps)
    expect(rendered[0]).toMatchObject({
      'form.heading': 'We got your request',
      'form.answers': 'Your name: Jane Doe\nemail: jane@example.com\nmessage: Two banners, please.',
      'form.files': 'The file you sent: logo.ai',
      'business.contact': 'You can also reach Northwind Signs at hello@northwind.example or 555-0100.',
    })
  })

  it('is refused only for an address that bounced or complained, and is not sent then', async () => {
    const asked: string[] = []
    const { deps, sent } = harness({
      suppression: async (email) => {
        asked.push(email)
        return 'suppressed-platform'
      },
    })
    expect(await sendFormConfirmation(input(), deps)).toEqual({ sent: false, reason: 'suppressed' })
    // The one list a transactional send asks; never the site's unsubscribes.
    expect(asked).toEqual(['jane@example.com'])
    expect(sent).toEqual([])
  })

  it('is limited per address and per site, so a form cannot flood somebody’s inbox', async () => {
    const { deps, sent } = harness({
      consumeRateLimit: async (key) => ({ allowed: !key.startsWith('form-confirmation:') }),
    })
    expect(await sendFormConfirmation(input(), deps)).toEqual({ sent: false, reason: 'rate-limited' })
    expect(sent).toEqual([])
    const counted = harness()
    await sendFormConfirmation(input(), counted.deps)
    expect(counted.limits).toHaveLength(2)
    expect(counted.limits[0]).toMatch(/^form-confirmation:site1:[0-9a-f]{64}$/)
    expect(counted.limits[1]).toBe('form-confirmation-site:site1')
    expect(FORM_CONFIRMATIONS_PER_ADDRESS).toEqual({ limit: 3, windowMs: 3_600_000 })
  })

  it('sends nothing to a value that is not an address, or when email is not set up, and never throws', async () => {
    expect(await sendFormConfirmation(input({ to: 'not an address' }), harness().deps)).toEqual({ sent: false, reason: 'no-address' })
    expect(await sendFormConfirmation(input(), harness({ configured: () => false }).deps)).toEqual({ sent: false, reason: 'unconfigured' })
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(
      await sendFormConfirmation(input(), harness({ send: async () => Promise.reject(new Error('down')) }).deps),
    ).toEqual({ sent: false, reason: 'error' })
    error.mockRestore()
  })

  it('has no Reply-To when the site has no contact email', async () => {
    const { deps, sent } = harness()
    await sendFormConfirmation(input({ host: { displayName: 'Northwind Signs' } }), deps)
    expect(sent[0]).not.toHaveProperty('replyTo')
  })
})
