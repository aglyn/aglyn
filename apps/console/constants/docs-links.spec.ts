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

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildDocsUrl,
  DOCS_BASE_URL,
  DOCS_HELP_TOPICS,
} from './docs-links'

const REPO_ROOT = join(__dirname, '../../..')
const GENERATOR = join(REPO_ROOT, 'tools/scripts/generate-docs-help.mjs')

describe('docs help registry', () => {
  it('has a well-formed base URL with no trailing slash', () => {
    expect(DOCS_BASE_URL).toMatch(/^https:\/\/[^/]+$/)
  })

  it('builds absolute docs URLs from root-relative paths', () => {
    expect(buildDocsUrl()).toBe(`${DOCS_BASE_URL}/`)
    expect(buildDocsUrl('/getting-started/console-tour')).toBe(
      `${DOCS_BASE_URL}/getting-started/console-tour`,
    )
    expect(buildDocsUrl('whats-new')).toBe(`${DOCS_BASE_URL}/whats-new`)
  })

  it('registers complete, root-relative help topics', () => {
    const topics = Object.entries(DOCS_HELP_TOPICS)
    expect(topics.length).toBeGreaterThan(0)
    for (const [key, topic] of topics) {
      expect(key.length).toBeGreaterThan(0)
      expect(topic.path.startsWith('/')).toBe(true)
      expect(topic.path.endsWith('/')).toBe(false)
      expect(topic.title.length).toBeGreaterThan(0)
      // Excerpts are tooltip copy (verbatim docs descriptions) — keep short.
      expect(topic.excerpt.length).toBeGreaterThan(0)
      expect(topic.excerpt.length).toBeLessThanOrEqual(220)
    }
  })

  it('every topic points at an existing apps/docs page', () => {
    const docsRoot = join(REPO_ROOT, 'apps/docs/docs')
    for (const [key, topic] of Object.entries(DOCS_HELP_TOPICS)) {
      const exists =
        existsSync(join(docsRoot, `${topic.path}.md`)) ||
        existsSync(join(docsRoot, `${topic.path}.mdx`))
      if (!exists) {
        throw new Error(
          `DOCS_HELP_TOPICS.${key} points at ${topic.path}, but no page exists under apps/docs/docs. Regenerate: node tools/scripts/generate-docs-help.mjs`,
        )
      }
    }
  })

  // The freshness gate: the generated registry (console + besigner) must match
  // what the generator produces from apps/docs right now. This subsumes anchor
  // validation — anchors are generated from headings, and the typed
  // DocsHelpAnchor unions make a stale call-site anchor a compile error. If a
  // docs page's title/description/headings changed without regenerating, this
  // fails with the exact stale file (AGL-602).
  it('is in sync with apps/docs (run the generator to fix)', () => {
    expect(existsSync(GENERATOR)).toBe(true)
    let error: (Error & { stdout?: Buffer; stderr?: Buffer }) | undefined
    try {
      execFileSync('node', [GENERATOR, '--check'], { cwd: REPO_ROOT })
    } catch (caught) {
      error = caught as typeof error
    }
    if (error) {
      const detail = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim()
      throw new Error(
        `Docs help registry is stale.\n${detail}\nRegenerate: node tools/scripts/generate-docs-help.mjs`,
      )
    }
  })
})
