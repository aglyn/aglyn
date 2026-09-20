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

/**
 * The Sequences page lives at `/content-and-data/crm/sequences`; it was
 * published as `/content-and-data/crm/outreach` first, and was live on the
 * docs site as a Rolling-out page before it was renamed (AGL-3199). One page
 * rather than a section, so this is `crm-section-redirects.spec.ts` in
 * miniature and the reasoning there holds unchanged: a literal `source`,
 * because Vercel compiles it with a path-to-regexp this repo does not have on
 * disk; `vercel.json` rather than `@docusaurus/plugin-client-redirects`,
 * because a platform redirect answers before any HTML is served and so
 * consolidates the old URL for search engines instead of merely forwarding a
 * reader; and the old file must stay absent, because Vercel evaluates
 * redirects before the filesystem and a page recreated there would build,
 * deploy and then be unreachable.
 *
 * The page's ANCHORS are asserted too. The console links into them — a help
 * tooltip beside a card names `#compliance-settings`, `#connect-a-mailbox`,
 * `#allowed-countries`, `#build-a-sequence`, `#sequences` and `#enroll` — and
 * a rename that dropped one would send a reader to the top of a long page
 * with no error anywhere.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

interface RedirectRule {
  source: string
  destination: string
  permanent?: boolean
  has?: Array<{ type: string; value: string }>
}

const DOCS_APP = join(__dirname, '..')

const config = JSON.parse(
  readFileSync(join(DOCS_APP, 'vercel.json'), 'utf8'),
) as { redirects?: RedirectRule[] }

const OLD_PATH = '/content-and-data/crm/outreach'
const NEW_PATH = '/content-and-data/crm/sequences'

const rule = (config.redirects ?? []).find(
  (entry) => entry.source === OLD_PATH,
)

const page = join(DOCS_APP, 'docs/content-and-data/crm/sequences.md')

describe('the Sequences page keeps its old address working (AGL-3199)', () => {
  it('redirects the old path permanently, on the docs host', () => {
    expect(rule).toBeDefined()
    expect(rule?.destination).toBe(NEW_PATH)
    expect(rule?.permanent).toBe(true)
    // `has` would scope the rule to one hostname; the docs host is every host
    // this config serves that is not `status.aglyn.com`.
    expect(rule?.has).toBeUndefined()
  })

  it('lands on a page that exists, and the old file is gone', () => {
    expect(existsSync(page)).toBe(true)
    expect(
      existsSync(join(DOCS_APP, 'docs/content-and-data/crm/outreach.md')),
    ).toBe(false)
  })

  it('is titled Sequences, and still discloses that it is rolling out', () => {
    const source = readFileSync(page, 'utf8')
    expect(source).toContain('\ntitle: Sequences\n')
    expect(/^:::caution\s+Rolling out\s*$/m.test(source)).toBe(true)
  })

  it('keeps every anchor the console links into', () => {
    const source = readFileSync(page, 'utf8')
    for (const anchor of [
      'connect-a-mailbox',
      'compliance-settings',
      'allowed-countries',
      'sequences',
      'build-a-sequence',
      'enroll',
    ]) {
      expect(source).toContain(`{#${anchor}}`)
    }
  })
})
