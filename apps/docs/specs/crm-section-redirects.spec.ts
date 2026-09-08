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
 * The CRM section lives at `/content-and-data/crm/`; it was published under
 * `/content-and-data/contacts/` first, and every page there had been live long
 * enough to be linked from outside this repo — console help affordances,
 * Aglyn Assist citations, campaign emails and search engines all carried the
 * old address. A moved page with no redirect is a 404 at every one of those
 * doors at once, so each old path is a permanent platform redirect to its new
 * one (AGL-2650).
 *
 * ## Why one literal rule per page, not a wildcard
 *
 * Vercel compiles `source` with path-to-regexp v6 and this repo has only the
 * Express-era 0.1.x on disk, so a `/:path*` wildcard could not be evaluated
 * here with the grammar Vercel uses — `status-host-redirects.spec.ts` already
 * works around the same gap. A literal source needs no compiler: the spec can
 * ask "is this exact old path redirected to this exact new one" and mean it.
 * The bare section path is included because a hand-typed or truncated URL
 * lands there, and the section's own front page is the overview.
 *
 * ## Why vercel.json and not @docusaurus/plugin-client-redirects
 *
 * The plugin is not installed, and it redirects in the browser — an HTML page
 * with a meta-refresh that a crawler may or may not follow. A platform
 * redirect answers before any HTML is served, so the old URL consolidates
 * into the new one for search engines rather than merely forwarding people.
 *
 * ## Why the old directory must stay absent
 *
 * Vercel evaluates redirects before the filesystem. A page recreated under
 * `docs/content-and-data/contacts/` would build and deploy and then be
 * unreachable, because its URL is redirected away before it is served.
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

const redirects = config.redirects ?? []

const OLD_SECTION = '/content-and-data/contacts'
const NEW_SECTION = '/content-and-data/crm'

/** Every page that was ever published under the old section. */
const PAGES = [
  'overview',
  'contact-record',
  'import',
  'bulk-actions',
  'views',
  'activities',
  'leads',
  'companies',
  'deals',
  'tasks',
  'reports',
  'custom-fields',
  'settings',
  'automations',
] as const

const ruleFor = (source: string): RedirectRule | undefined =>
  redirects.find((rule) => rule.source === source)

describe('CRM section redirects (contacts → crm)', () => {
  it.each(PAGES)('redirects %s to the same slug under the new section', (page) => {
    const rule = ruleFor(`${OLD_SECTION}/${page}`)
    expect(rule).toBeDefined()
    expect(rule?.destination).toBe(`${NEW_SECTION}/${page}`)
  })

  it('lands the bare old section on the overview, which is the section front page', () => {
    expect(ruleFor(OLD_SECTION)?.destination).toBe(`${NEW_SECTION}/overview`)
    const category = JSON.parse(
      readFileSync(
        join(DOCS_APP, 'docs/content-and-data/crm/_category_.json'),
        'utf8',
      ),
    ) as { link?: { type?: string; id?: string } }
    expect(category.link).toEqual({ type: 'doc', id: 'content-and-data/crm/overview' })
  })

  it('redirects permanently, so the old URLs consolidate rather than merely forward', () => {
    for (const source of [OLD_SECTION, ...PAGES.map((p) => `${OLD_SECTION}/${p}`)]) {
      expect(ruleFor(source)?.permanent).toBe(true)
    }
  })

  it('fires on the docs host: no section rule is scoped to another hostname', () => {
    for (const source of [OLD_SECTION, ...PAGES.map((p) => `${OLD_SECTION}/${p}`)]) {
      expect(ruleFor(source)?.has).toBeUndefined()
    }
  })

  it('points every destination at a page that exists, so a redirect never lands on a 404', () => {
    const sectionRules = redirects.filter((rule) =>
      rule.source.startsWith(OLD_SECTION),
    )
    expect(sectionRules.length).toBe(PAGES.length + 1)
    for (const rule of sectionRules) {
      const slug = rule.destination.slice(`${NEW_SECTION}/`.length)
      expect(rule.destination.startsWith(`${NEW_SECTION}/`)).toBe(true)
      expect(
        existsSync(join(DOCS_APP, 'docs/content-and-data/crm', `${slug}.md`)),
      ).toBe(true)
    }
  })

  it('keeps the old directory absent, because a page recreated there would be unreachable', () => {
    expect(existsSync(join(DOCS_APP, 'docs/content-and-data/contacts'))).toBe(false)
  })
})
