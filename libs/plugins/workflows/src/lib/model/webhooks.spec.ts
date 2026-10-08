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

import { WEBHOOK_URL_PATTERN, maskedWebhookUrl } from './webhooks'

describe('WEBHOOK_URL_PATTERN', () => {
  it('allows public https and blocks local/private targets (AGL-149)', () => {
    expect(WEBHOOK_URL_PATTERN.test('https://hooks.example.com/x')).toBe(true)
    expect(WEBHOOK_URL_PATTERN.test('http://example.com')).toBe(false)
    expect(WEBHOOK_URL_PATTERN.test('https://localhost/x')).toBe(false)
    expect(WEBHOOK_URL_PATTERN.test('https://192.168.1.5/x')).toBe(false)
    expect(WEBHOOK_URL_PATTERN.test('https://10.0.0.1/x')).toBe(false)
  })
})

describe('maskedWebhookUrl (AGL-3684)', () => {
  it('shows the host and hides the path that carries the credential', () => {
    expect(maskedWebhookUrl('https://hooks.slack.com/services/T0/B0/secret')).toBe('https://hooks.slack.com/…')
    expect(maskedWebhookUrl('https://api.example.com/hook?token=abc')).toBe('https://api.example.com/…')
    expect(maskedWebhookUrl('https://api.example.com/')).toBe('https://api.example.com')
  })

  it('never echoes text it cannot parse', () => {
    expect(maskedWebhookUrl('not a url secret')).toBe('…')
    expect(maskedWebhookUrl(undefined)).toBe('')
  })
})
