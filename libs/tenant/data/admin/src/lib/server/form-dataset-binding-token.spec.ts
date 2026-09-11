/**
 * @jest-environment node
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

/**
 * A form's dataset binding is trusted only when the page's own signature says
 * so (AGL-2773). Every refusal below returns null rather than throwing: the
 * route treats null as "this submission writes no record", which keeps the
 * Inbox copy and costs a crafted request nothing to be told.
 */

import {
  signFormDatasetBinding,
  verifyFormDatasetBinding,
} from './form-dataset-binding-token'

const SITE = 'site-1'
const BINDING = {
  datasetId: 'leads',
  datasetName: 'Leads',
  fieldMap: { email: 'contact_email' },
}

const secret = process.env['TOKEN_SIGNING_SECRET']

beforeEach(() => {
  process.env['TOKEN_SIGNING_SECRET'] = 'test-signing-secret'
})
afterAll(() => {
  if (secret === undefined) delete process.env['TOKEN_SIGNING_SECRET']
  else process.env['TOKEN_SIGNING_SECRET'] = secret
})

describe('form dataset binding tokens', () => {
  it('round-trips the binding it signed', () => {
    const token = signFormDatasetBinding(SITE, BINDING)
    expect(verifyFormDatasetBinding(SITE, token)).toEqual(BINDING)
  })

  it('refuses a token minted for another site', () => {
    const token = signFormDatasetBinding('another-site', BINDING)
    expect(verifyFormDatasetBinding(SITE, token)).toBeNull()
  })

  it('refuses a token whose binding was edited', () => {
    const [version, , signed] = signFormDatasetBinding(SITE, BINDING).split('.')
    const forged = Buffer.from(
      JSON.stringify({ h: SITE, d: 'payroll', m: {} }),
    ).toString('base64url')
    expect(
      verifyFormDatasetBinding(SITE, `${version}.${forged}.${signed}`),
    ).toBeNull()
  })

  it('refuses a token signed with a different secret', () => {
    const token = signFormDatasetBinding(SITE, BINDING)
    process.env['TOKEN_SIGNING_SECRET'] = 'rotated-secret'
    expect(verifyFormDatasetBinding(SITE, token)).toBeNull()
  })

  it('refuses anything that is not a token, without throwing', () => {
    const token = signFormDatasetBinding(SITE, BINDING)
    for (const candidate of [
      undefined,
      null,
      42,
      {},
      '',
      'v1',
      `v2${token.slice(2)}`,
      `${token}.extra`,
      'x'.repeat(9000),
    ]) {
      expect(verifyFormDatasetBinding(SITE, candidate)).toBeNull()
    }
  })

  it('refuses every token when no signing secret is configured', () => {
    const token = signFormDatasetBinding(SITE, BINDING)
    delete process.env['TOKEN_SIGNING_SECRET']
    expect(verifyFormDatasetBinding(SITE, token)).toBeNull()
    expect(() => signFormDatasetBinding(SITE, BINDING)).toThrow(
      /TOKEN_SIGNING_SECRET/,
    )
  })
})
