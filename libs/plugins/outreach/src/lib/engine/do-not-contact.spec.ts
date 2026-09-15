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
 *
 * @jest-environment node
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import { outreachDoNotContactKey } from './do-not-contact'

describe('outreachDoNotContactKey', () => {
  it('is the sha256 of the normalized address, as full hex', () => {
    const expected = createHash('sha256').update('casey@example.com').digest('hex')
    expect(outreachDoNotContactKey('  Casey@Example.COM ')).toBe(expected)
    expect(outreachDoNotContactKey('casey@example.com')).toHaveLength(64)
  })

  it('is the key every suppression list is read by', () => {
    expect(outreachDoNotContactKey('casey@example.com')).toBe(personKey('casey@example.com'))
  })

  it('refuses to key what is not an address', () => {
    expect(outreachDoNotContactKey('casey')).toBeNull()
    expect(outreachDoNotContactKey('')).toBeNull()
    expect(outreachDoNotContactKey(null)).toBeNull()
  })

  it('stays out of the engine barrel, which the console bundles', () => {
    const barrel = readFileSync(join(__dirname, 'index.ts'), 'utf8')
    expect(barrel).not.toMatch(/from '\.\/do-not-contact'/)
  })
})
