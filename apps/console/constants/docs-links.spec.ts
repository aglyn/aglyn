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
const ASSIST_INDEX_GENERATOR = join(
  REPO_ROOT,
  'tools/scripts/generate-assist-docs-index.mjs',
)

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

  // The SECOND generated docs artifact, and until now the unguarded one
  // (AGL-1988). `assist-docs-index.generated.ts` is the corpus Aglyn Assist
  // retrieves from, and its generator has always had a `--check` mode that
  // nothing called — so the index could drift from apps/docs indefinitely
  // and the only symptom would be the assistant citing a heading that no
  // longer exists, or missing a page that does. That is a quiet failure on
  // the feature's whole reason to exist, so it gets the same gate its
  // sibling has.
  it('the Assist retrieval index is in sync with apps/docs', () => {
    expect(existsSync(ASSIST_INDEX_GENERATOR)).toBe(true)
    let error: (Error & { stdout?: Buffer; stderr?: Buffer }) | undefined
    try {
      execFileSync('node', [ASSIST_INDEX_GENERATOR, '--check'], {
        cwd: REPO_ROOT,
      })
    } catch (caught) {
      error = caught as typeof error
    }
    if (error) {
      const detail = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim()
      throw new Error(
        `Aglyn Assist's docs index is stale — the assistant is retrieving from an out-of-date copy of the documentation.\n${detail}\nRegenerate: node tools/scripts/generate-assist-docs-index.mjs`,
      )
    }
  })
})

/**
 * The docs origin is ONE value under ONE canonical name (AGL-2186).
 *
 * It was two: Assist citations read `NEXT_PUBLIC_DOCS_ORIGIN` — the name the
 * self-host runbook documents — while every console and besigner help link
 * read an undocumented `NEXT_PUBLIC_AGLYN_DOCS_URL`. An operator who followed
 * the runbook exactly retargeted a third of their links and left the rest
 * citing our documentation inside their product.
 *
 * Module scope, so each shape needs a fresh registry.
 */
describe('the docs origin is one value under one name (AGL-2186)', () => {
  const KEYS = ['NEXT_PUBLIC_DOCS_ORIGIN', 'NEXT_PUBLIC_AGLYN_DOCS_URL'] as const
  const ORIGINAL = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]))

  afterEach(() => {
    for (const key of KEYS) {
      const value = ORIGINAL[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    jest.resetModules()
  })

  function loadWith(env: Partial<Record<(typeof KEYS)[number], string>>) {
    for (const key of KEYS) delete process.env[key]
    for (const [key, value] of Object.entries(env)) process.env[key] = value
    jest.resetModules()
    return require('./docs-links') as typeof import('./docs-links')
  }

  it('SELF-HOST shape: the documented name retargets console help links', () => {
    // The half that was broken — this reader ignored the runbook's variable.
    const links = loadWith({ NEXT_PUBLIC_DOCS_ORIGIN: 'https://docs.example.com' })
    expect(links.DOCS_BASE_URL).toBe('https://docs.example.com')
    expect(links.buildDocsUrl('/api')).toBe('https://docs.example.com/api')
    expect(links.buildDocsUrl('/api')).not.toContain('aglyn')
  })

  it('still honours the older name on its own, so a configured deploy keeps working', () => {
    expect(
      loadWith({ NEXT_PUBLIC_AGLYN_DOCS_URL: 'https://old.example.com' })
        .DOCS_BASE_URL,
    ).toBe('https://old.example.com')
  })

  it('prefers the canonical name when both are set', () => {
    expect(
      loadWith({
        NEXT_PUBLIC_DOCS_ORIGIN: 'https://new.example.com',
        NEXT_PUBLIC_AGLYN_DOCS_URL: 'https://old.example.com',
      }).DOCS_BASE_URL,
    ).toBe('https://new.example.com')
  })

  it('AGLYN-OPERATED shape: unset is still our docs site', () => {
    expect(loadWith({}).DOCS_BASE_URL).toBe('https://docs.aglyn.com')
  })

  it('trims a trailing slash, which a copied URL carries', () => {
    expect(
      loadWith({ NEXT_PUBLIC_DOCS_ORIGIN: 'https://docs.example.com/' })
        .DOCS_BASE_URL,
    ).toBe('https://docs.example.com')
  })
})
