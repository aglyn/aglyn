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

import { existsSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import { EMAIL_NODE_ROOT_ID, renderEmailHtml, substituteMergeTokens } from './email-render'
import {
  PRODUCT_TIP_RETENTION_EMAILS,
  RETENTION_DOCS_PATHS,
  RETENTION_VERIFY_REMINDER_EMAIL,
  retentionDocsMergeValues,
} from './retention-emails'
import {
  SYSTEM_EMAIL_TEMPLATES,
  buildDefaultEmailNodeMap,
  getSystemEmailTemplate,
} from './system-email-catalog'

const RETENTION_SYSTEM_EMAIL_TEMPLATES = SYSTEM_EMAIL_TEMPLATES.filter((entry) =>
  entry.key.startsWith('retention-'),
)

/**
 * The getting-started emails' copy (AGL-3692), held to the house rules a
 * reviewer would otherwise have to remember: they are in the catalog, they
 * render, the heading states the topic, pages are "pages", nothing quotes a
 * price, nothing sounds unfinished, and every product tip carries its way out.
 */

const SAMPLE = (key: string): Record<string, string> =>
  Object.fromEntries(
    getSystemEmailTemplate(key)!.mergeTokens.map((token) => [token.name, token.sample]),
  )

function render(key: string) {
  const definition = getSystemEmailTemplate(key)!
  return renderEmailHtml({
    nodes: buildDefaultEmailNodeMap(definition) as never,
    rootId: EMAIL_NODE_ROOT_ID,
    merge: SAMPLE(key),
    sanitize: (value) => value,
  })
}

describe('RETENTION_SYSTEM_EMAIL_TEMPLATES', () => {
  const keys = RETENTION_SYSTEM_EMAIL_TEMPLATES.map((entry) => entry.key)

  it('are all in the catalog, so staff can send each by hand', () => {
    expect(keys).toHaveLength(5)
    for (const key of keys) expect(getSystemEmailTemplate(key)?.deliveredBy).toBe('resend')
  })

  it('render to html that opens with their topic', () => {
    for (const key of keys) {
      const definition = getSystemEmailTemplate(key)!
      const heading = definition.defaultBody?.[0]
      expect(heading).toMatchObject({ block: 'text', variant: 'heading' })
      const { html } = render(key)
      const topic = substituteMergeTokens((heading as { text: string }).text, SAMPLE(key))
      expect(html).toContain(topic)
    }
  })

  it('follow the copy rules: pages not screens, no prices, nothing unfinished', () => {
    for (const entry of RETENTION_SYSTEM_EMAIL_TEMPLATES) {
      const copy = [
        entry.defaultSubject,
        ...(entry.defaultBody ?? []).map((block) =>
          block.block === 'text' ? block.text : block.label,
        ),
      ].join('\n')
      expect(copy).not.toMatch(/screen/i)
      expect(copy).not.toMatch(/[$€£]\s?\d|\d+\s?%|per month|\/mo\b/i)
      expect(copy).not.toMatch(/beta|I'm building|we're building/i)
    }
  })

  it('gives every product tip the product-email switch, and the verification reminder none', () => {
    for (const entry of RETENTION_SYSTEM_EMAIL_TEMPLATES) {
      const tokens = entry.mergeTokens.map((token) => token.name)
      const tip = PRODUCT_TIP_RETENTION_EMAILS.has(entry.key)
      expect(tip).toBe(entry.key !== RETENTION_VERIFY_REMINDER_EMAIL)
      expect(tokens.includes('preferencesUrl')).toBe(tip)
      if (tip) expect(render(entry.key).html).toContain('/manage/user/emails')
    }
  })

  it('wear the house design: one button each, and the house opt-out line', () => {
    for (const entry of RETENTION_SYSTEM_EMAIL_TEMPLATES) {
      const body = entry.defaultBody ?? []
      expect(body.filter((block) => block.block === 'button')).toHaveLength(1)
      if (PRODUCT_TIP_RETENTION_EMAILS.has(entry.key)) {
        expect(body[body.length - 1]).toEqual({
          block: 'text',
          text: 'Change what you are emailed about: {{preferencesUrl}}',
          variant: 'caption',
        })
      }
    }
  })
})

/**
 * The docs links (AGL-3692). A link to a page the docs site does not serve
 * is worse than none, so every path is held to a real source file under
 * `apps/docs/docs`, and every anchor to a heading on that page.
 */
describe('the getting-started emails’ docs links', () => {
  const REPO_ROOT = resolve(__dirname, '../../../../../..')
  const DOCS_ROOT = join(REPO_ROOT, 'apps/docs/docs')

  /** The source file the docs site serves a path from, or null. */
  function docsSource(path: string): string | null {
    for (const candidate of [`${path}.md`, `${path}.mdx`, `${path}/index.md`, `${path}/index.mdx`]) {
      const file = join(DOCS_ROOT, candidate)
      if (existsSync(file)) return file
    }
    return null
  }

  /** The heading anchors a page offers: an explicit `{#id}`, else the slug. */
  function anchorsOf(file: string): Set<string> {
    const anchors = new Set<string>()
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const heading = /^#{1,6}\s+(.*)$/.exec(line)
      if (!heading) continue
      const text = heading[1] ?? ''
      const explicit = /\{#([^}]+)\}\s*$/.exec(text)
      anchors.add(
        explicit
          ? (explicit[1] ?? '')
          : text
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9\s-]/g, '')
              .replace(/\s/g, '-'),
      )
    }
    return anchors
  }

  it('point at docs pages that exist, and headings that exist on them', () => {
    for (const [token, target] of Object.entries(RETENTION_DOCS_PATHS)) {
      const [path, anchor] = target.split('#') as [string, string | undefined]
      const file = docsSource(path)
      expect({ token, path, file: Boolean(file) }).toEqual({ token, path, file: true })
      if (anchor) expect(anchorsOf(file!)).toContain(anchor)
    }
  })

  it('give every email one or two docs links, each a declared token its body uses', () => {
    const docsTokens = new Set(Object.keys(RETENTION_DOCS_PATHS))
    for (const entry of RETENTION_SYSTEM_EMAIL_TEMPLATES) {
      const declared = entry.mergeTokens
        .map((token) => token.name)
        .filter((name) => docsTokens.has(name))
      expect(declared.length).toBeGreaterThanOrEqual(1)
      expect(declared.length).toBeLessThanOrEqual(2)
      const copy = (entry.defaultBody ?? [])
        .map((block) => (block.block === 'text' ? block.text : block.href))
        .join('\n')
      for (const name of declared) expect(copy).toContain(`{{${name}}}`)
      // No docs token in the copy that the email does not declare: a token
      // the send does not supply is blanked, and leaves a hole in the line.
      for (const used of copy.match(/\{\{docs\.[^}]+\}\}/g) ?? []) {
        expect(declared).toContain(used.slice(2, -2))
      }
      const { html } = render(entry.key)
      for (const name of declared) {
        expect(html).toContain(`href="${SAMPLE(entry.key)[name]}"`)
      }
    }
  })

  it('build every link on the docs origin it is given, never a spelled-out one', () => {
    const values = retentionDocsMergeValues('https://docs.example.test/')
    for (const [token, path] of Object.entries(RETENTION_DOCS_PATHS)) {
      expect(values[token as keyof typeof values]).toBe(`https://docs.example.test${path}`)
    }
  })
})
