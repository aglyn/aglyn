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
 * The Aglyn AI section lives at `/ai/`; five of its pages were published under
 * `/marketing-and-automation/ai-assist/` first, when the section was called
 * "AI Assist" and covered only the two doors in the Besigner (AGL-2923). Those
 * pages had been live long enough to be linked from outside this repo —
 * console help affordances, Aglyn Assist citations and search engines all
 * carry the old address — so each old path is a permanent platform redirect to
 * its new one.
 *
 * This is `crm-section-redirects.spec.ts` applied to a second move, and the
 * reasoning there holds here unchanged: one literal rule per page rather than
 * a wildcard, because Vercel compiles `source` with a path-to-regexp this repo
 * does not have on disk; `vercel.json` rather than
 * `@docusaurus/plugin-client-redirects`, because a platform redirect answers
 * before any HTML is served and so consolidates the old URL for search engines
 * instead of merely forwarding a reader; and the old directory must stay
 * absent, because Vercel evaluates redirects before the filesystem and a page
 * recreated there would build, deploy and then be unreachable.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
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

const OLD_SECTION = '/marketing-and-automation/ai-assist'
const NEW_SECTION = '/ai'

/** Every page that was ever published under the old section. */
const PAGES = [
  'overview',
  'copy-assist',
  'generate-section',
  'theme-assist',
  'ai-allotments',
] as const

const ruleFor = (source: string): RedirectRule | undefined =>
  redirects.find((rule) => rule.source === source)

describe('Aglyn AI section redirects (ai-assist → ai)', () => {
  it.each(PAGES)('redirects %s to the same slug under the new section', (page) => {
    const rule = ruleFor(`${OLD_SECTION}/${page}`)
    expect(rule).toBeDefined()
    expect(rule?.destination).toBe(`${NEW_SECTION}/${page}`)
  })

  it('lands the bare old section on the overview, which is the section front page', () => {
    expect(ruleFor(OLD_SECTION)?.destination).toBe(`${NEW_SECTION}/overview`)
    const category = JSON.parse(
      readFileSync(join(DOCS_APP, 'docs/ai/_category_.json'), 'utf8'),
    ) as { link?: { type?: string; id?: string } }
    expect(category.link).toEqual({ type: 'doc', id: 'ai/overview' })
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
      expect(rule.destination.startsWith(`${NEW_SECTION}/`)).toBe(true)
      const slug = rule.destination.slice(`${NEW_SECTION}/`.length)
      expect(existsSync(join(DOCS_APP, 'docs/ai', `${slug}.md`))).toBe(true)
    }
  })

  it('keeps the old directory absent, because a page recreated there would be unreachable', () => {
    expect(
      existsSync(join(DOCS_APP, 'docs/marketing-and-automation/ai-assist')),
    ).toBe(false)
  })

  it('leaves no link in the published tree pointing at the old section', () => {
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules') walk(path)
        } else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) {
          // The staff console names `ai-assist` as a kill-switch feature key,
          // which is a different thing that happens to share the word.
          if (readFileSync(path, 'utf8').includes('marketing-and-automation/ai-assist')) {
            offenders.push(path)
          }
        }
      }
    }
    for (const tree of ['docs', 'api', 'help', 'learn']) {
      const root = join(DOCS_APP, tree)
      if (existsSync(root)) walk(root)
    }
    expect(offenders).toEqual([])
  })
})
