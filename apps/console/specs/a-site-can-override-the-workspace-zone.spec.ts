/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { resolveSiteTimeZone } from '@aglyn/aglyn'

/**
 * A site can take a zone of its own, and can give it back (AGL-3252).
 *
 * The behaviour itself — site beats workspace beats UTC — is proved against
 * the resolver in `collection-entry-date-zone.spec.ts`. What is left here is
 * the half a unit test of a pure function cannot reach, and it is the half
 * that broke twice already on this very card:
 *
 *  - the form renderer DROPS a cleared field from its submitted values, so a
 *    control that is not named in a `CLEARABLE_*` list can be switched on and
 *    never off. AGL-1608 found five tracking ids in that state and AGL-3197
 *    found the SEO title pattern in it; the failure is silent both times,
 *    because the save still reports "Saved!".
 * (A host field that nobody classifies is CLIENT-WRITABLE in production
 * whatever anyone intended, since the rules deny only what they name — but
 * that property has its own guard, `host-listing-write-deny-coverage`, which
 * fails the build naming the field. It is not restated here.)
 *
 * Read as source rather than rendered: the form needs a Firestore listener, a
 * user and an org scope under it, and the properties below are all statements
 * about the schema and the save wiring rather than about pixels.
 */
const SCOPE = join(
  __dirname,
  '..',
  'app',
  '(app)',
  '[orgSlug]',
  'hosts',
  '[host]',
  'host-settings-scope.tsx',
)

const source = () => readFileSync(SCOPE, 'utf8')

/** The Basic details schema's body, as text. */
const basicSchemaBlock = (): string => {
  const text = source()
  const start = text.indexOf('const buildBasicSchema')
  expect(start).toBeGreaterThan(-1)
  const end = text.indexOf('\nconst ', start + 1)
  return text.slice(start, end === -1 ? undefined : end)
}

const clearableHostPaths = (): string[] => {
  const text = source()
  const start = text.indexOf('const CLEARABLE_HOST_PATHS')
  expect(start).toBeGreaterThan(-1)
  const block = text.slice(start, text.indexOf(']', start))
  return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1])
}

describe('a site can override the workspace time zone (AGL-3252)', () => {
  it('THE CONTROL: the General card renders a time zone field', () => {
    // Otherwise every assertion below passes over a card that lost it.
    const block = basicSchemaBlock()
    expect([...block.matchAll(/name: '([^']+)'/g)].map((m) => m[1])).toEqual(
      expect.arrayContaining(['displayName', 'subdomain', 'timeZone']),
    )
  })

  it('the way back to the workspace zone is a real write, not an omission', () => {
    // The AGL-1608 shape: clearing the box submits nothing, `merge: true`
    // leaves the stored override alone, and the card says "Saved!".
    expect(clearableHostPaths()).toContain('timeZone')
    const forms = source().slice(source().indexOf('const forms = ['))
    const basicEntry = forms.slice(0, forms.indexOf('schema: seoSchema'))
    expect(basicEntry).toContain('CLEARABLE_HOST_PATHS')
  })

  it('the empty state NAMES the zone it inherits', () => {
    /*
     * "Default" is a word the reader has to leave the page to resolve, and
     * the whole point of the control is that a site which sets nothing is
     * still deciding something. The schema is built from the org's resolved
     * zone for this one reason, so a builder that stopped taking it would
     * leave the placeholder saying nothing.
     */
    const block = basicSchemaBlock()
    expect(block).toContain('placeholder:')
    expect(block).toContain('Same as the workspace — ${inheritedTimeZone}')
    // And the zone is only claimed once the org read is trustworthy: an
    // ungated `useCurrentOrg().org` answers UTC while it loads, which would
    // tell a Chicago workspace something false about itself (AGL-1916).
    expect(source()).toContain('const { org, ready: orgReady } = useCurrentOrg()')
    expect(source()).toContain('orgReady')
  })

  it('offers the zones the resolver would accept, from one authority', () => {
    // A hand-kept list would offer names `isSupportedTimeZone` rejects and
    // miss ones it has learned; both readers ask `Intl` through the same
    // helper, so they cannot disagree about what is choosable.
    expect(basicSchemaBlock()).toContain('Aglyn.supportedTimeZones()')
  })

  it('a site with no zone of its own still reads as its workspace does', () => {
    // The back-compat claim, restated where the console can see it: adding
    // the control moves no existing site's archive by a day.
    expect(resolveSiteTimeZone({ timeZone: 'America/Chicago' }, {})).toBe(
      'America/Chicago',
    )
  })
})
