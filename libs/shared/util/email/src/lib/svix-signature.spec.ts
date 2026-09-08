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

import { signSvixPayload, verifySvixSignature } from './svix-signature'

const SECRET = `whsec_${Buffer.from('a-test-signing-secret-of-some-length').toString('base64')}`
const ID = 'msg_2abc'
const TIMESTAMP = '1757200000'
const BODY = Buffer.from('{"type":"email.received","data":{"email_id":"em_1"}}', 'utf8')

describe('verifySvixSignature', () => {
  it('accepts the signature its own signer produces', () => {
    const header = signSvixPayload(SECRET, ID, TIMESTAMP, BODY)
    expect(header.startsWith('v1,')).toBe(true)
    expect(verifySvixSignature(SECRET, ID, TIMESTAMP, BODY, header)).toBe(true)
  })

  it('accepts any one of several space-delimited entries', () => {
    const good = signSvixPayload(SECRET, ID, TIMESTAMP, BODY)
    expect(verifySvixSignature(SECRET, ID, TIMESTAMP, BODY, `v1,ZGVhZGJlZWY= ${good}`)).toBe(true)
  })

  it('refuses a different body, id, timestamp or secret, and a malformed header', () => {
    const header = signSvixPayload(SECRET, ID, TIMESTAMP, BODY)
    expect(verifySvixSignature(SECRET, ID, TIMESTAMP, Buffer.from('{}'), header)).toBe(false)
    expect(verifySvixSignature(SECRET, 'msg_other', TIMESTAMP, BODY, header)).toBe(false)
    expect(verifySvixSignature(SECRET, ID, '1', BODY, header)).toBe(false)
    expect(verifySvixSignature('whsec_b3RoZXI=', ID, TIMESTAMP, BODY, header)).toBe(false)
    expect(verifySvixSignature(SECRET, ID, TIMESTAMP, BODY, 'v1')).toBe(false)
    expect(verifySvixSignature(SECRET, ID, TIMESTAMP, BODY, '')).toBe(false)
  })
})
