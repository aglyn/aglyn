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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { outreachEnrollmentSearchTokens } from '../enrollment/enrollment-search'
import { outreachDomainSearchTokens } from './do-not-contact-domain-list-query'

/**
 * What the Outreach lists search an enrollment and a domain by, held to the
 * worked examples `tools/scripts/backfill-outreach-list-search.mjs` restates
 * them against (AGL-3321).
 *
 * The backfill is a plain Node script and cannot import these functions, so
 * it carries its own copy; its `--self-test` asserts that copy against the
 * same fixtures this spec asserts the library against. A record the backfill
 * stamps is then found by exactly the search a record the routes stamp is.
 */

const FIXTURES = JSON.parse(
  readFileSync(
    join(__dirname, '../../../../../../tools/scripts/lib/outreach-search-tokens.fixtures.json'),
    'utf8',
  ),
) as {
  enrollments: Array<{ enrollment: { contactName: string; email: string }; tokens: string[] }>
  domains: Array<{ entry: { domain: string; detail?: string | null }; tokens: string[] }>
}

describe('the Outreach list search fixtures', () => {
  it('holds an enrollment’s tokens as the enroll route stamps them', () => {
    expect(FIXTURES.enrollments.length).toBeGreaterThan(0)
    for (const one of FIXTURES.enrollments) {
      expect(outreachEnrollmentSearchTokens(one.enrollment)).toEqual(one.tokens)
    }
  })

  it('holds a domain’s tokens as its one writer stamps them', () => {
    expect(FIXTURES.domains.length).toBeGreaterThan(0)
    for (const one of FIXTURES.domains) {
      expect(outreachDomainSearchTokens({ detail: null, ...one.entry })).toEqual(one.tokens)
    }
  })

  it('finds a person by a word of their name, of their address, and of its domain', () => {
    const tokens = outreachEnrollmentSearchTokens({
      contactName: 'Casey Morgan',
      email: 'casey.morgan@example.com',
    })
    for (const word of ['casey', 'morgan', 'example', 'example.com']) expect(tokens).toContain(word)
  })
})
