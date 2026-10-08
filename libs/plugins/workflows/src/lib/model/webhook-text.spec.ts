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

import { webhookSummaryText } from './webhook-text'

describe('webhookSummaryText (AGL-3684)', () => {
  it('reads a form submission as a message: form, fields, page', () => {
    expect(
      webhookSummaryText('formSubmission', {
        formName: 'Contact us',
        path: '/pricing',
        name: 'Jane Doe',
        email: 'jane@example.com',
        formId: 'form-1',
        journey: 'j-1',
      }),
    ).toBe(
      [
        '*New form submission — Contact us*',
        '• *name:* Jane Doe',
        '• *email:* jane@example.com',
        'Page: /pricing',
      ].join('\n'),
    )
  })

  it('escapes a visitor’s markup so it cannot mention a channel or link', () => {
    const text = webhookSummaryText('formSubmission', { message: '<!channel> & <https://x.test|y>' })
    expect(text).toContain('&lt;!channel&gt; &amp; &lt;https://x.test|y&gt;')
    expect(text).not.toContain('<!channel>')
  })

  it('names any other event by its label and skips empty and nested values', () => {
    expect(
      webhookSummaryText('dealWon', { title: 'Acme', amountCents: 5000, note: ' ', meta: { a: 1 } }),
    ).toBe(['*Deal won*', '• *title:* Acme', '• *amountCents:* 5000'].join('\n'))
  })

  it('keeps a custom event’s own name and caps a long submission', () => {
    const payload = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`f${i}`, 'x'.repeat(600)]))
    const lines = webhookSummaryText('myEvent', payload).split('\n')
    expect(lines[0]).toBe('*myEvent*')
    expect(lines).toHaveLength(32)
    expect(lines[31]).toBe('…and 10 more')
    expect(lines[1].endsWith('…')).toBe(true)
  })
})
