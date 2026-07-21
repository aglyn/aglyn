#!/usr/bin/env node
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
 * Generates the contextual-help topic registry from the docs site frontmatter
 * (AGL-602). Source of truth: apps/docs/docs. Emits two GENERATED files:
 *
 *   apps/console/constants/docs-help.generated.ts      (all feature pages)
 *   libs/besigner/feature/designer/src/lib/utils/docs-help.generated.ts
 *                                                       (the besigner subset)
 *
 * Each topic carries the page's title + frontmatter description (the tooltip
 * excerpt) and the exact set of heading anchor slugs found on that page, so
 * docsHelp()/besignerDocsUrl() can type-check the anchor a caller deep-links
 * to. Re-run after editing apps/docs:
 *
 *   node tools/scripts/generate-docs-help.mjs          (write the files)
 *   node tools/scripts/generate-docs-help.mjs --check  (fail if stale; CI)
 *
 * The docs help system: see docs/DOCS_HELP_REGISTRY.md.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const DOCS_ROOT = join(ROOT, 'apps/docs/docs')
const CONSOLE_OUT = join(ROOT, 'apps/console/constants/docs-help.generated.ts')
const BESIGNER_OUT = join(
  ROOT,
  'libs/besigner/feature/designer/src/lib/utils/docs-help.generated.ts',
)

// Docs pages that are not feature topics (chrome / internal-only routes).
const EXCLUDE = [/^operations\//, /^intro$/, /^whats-new$/]

// Friendly call-site keys whose auto-derived key would differ. Keep these
// stable — call sites (docsHelp('billing', …)) depend on them. Everything
// else derives its key from the path; a collision fails generation and tells
// you to add an alias here.
const CONSOLE_ALIASES = {
  account: '/workspace-and-billing/signing-in-and-sessions',
  billing: '/workspace-and-billing/billing-and-plans/overview',
  components: '/building-sites/besigner/reusable-components',
  content: '/building-sites/site-templates/overview',
  gettingStarted: '/getting-started/create-a-site',
  interactions: '/building-sites/besigner/interactions-and-custom-html',
  members: '/guides/member-accounts',
  pos: '/commerce-and-bookings/commerce/pos-and-reservations',
  screens: '/building-sites/screens-and-layouts/overview',
  team: '/workspace-and-billing/teams-and-roles/overview',
  workflows: '/marketing-and-automation/workflows-and-actions/overview',
}

// The besigner designer lib can't import console constants, so it gets its own
// generated subset. Keys are the besignerDocsUrl() page ids.
const BESIGNER_TOPICS = {
  besigner: '/building-sites/besigner/overview',
  responsiveStyling: '/building-sites/besigner/responsive-styling',
  dragDropHierarchy: '/building-sites/besigner/drag-drop-hierarchy',
  textEditing: '/building-sites/besigner/text-editing',
  reusableComponents: '/building-sites/besigner/reusable-components',
  interactions: '/building-sites/besigner/interactions-and-custom-html',
  bindings: '/building-sites/bindings/overview',
  screens: '/building-sites/screens-and-layouts/overview',
  seo: '/building-sites/seo/overview',
}

// ── Docs parsing ──────────────────────────────────────────────────────────

/** Docusaurus/github-slugger heading slug: lowercase, drop punctuation, then
 * every run-preserving space → hyphen (so "A & B" → "a--b"). */
function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/ /g, '-')
}

function stripQuotes(value) {
  return value?.replace(/^["']|["']$/g, '')
}

/** Read one markdown file → { title, excerpt, anchors[] } or null. */
function readDocPage(absPath) {
  const source = readFileSync(absPath, 'utf8')
  const fm = source.match(/^---\n([\s\S]*?)\n---/)
  if (!fm) return null
  const title = stripQuotes(fm[1].match(/^title:\s*(.+)$/m)?.[1])
  const excerpt = stripQuotes(fm[1].match(/^description:\s*(.+)$/m)?.[1])
  if (!title || !excerpt) return null

  const anchors = []
  const seen = new Set()
  for (const match of source.matchAll(/^#{2,4}\s+(.+?)\s*$/gm)) {
    const explicit = match[1].match(/\{#([^}]+)\}\s*$/)
    const slug = explicit
      ? explicit[1]
      : slugify(match[1].replace(/\{#[^}]+\}\s*$/, ''))
    if (slug && !seen.has(slug)) {
      seen.add(slug)
      anchors.push(`#${slug}`)
    }
  }
  return { title, excerpt, anchors }
}

/** Walk apps/docs/docs → Map<urlPath, {title, excerpt, anchors}>. */
function collectDocs() {
  const pages = new Map()
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.name.endsWith('.md') && !entry.name.startsWith('_')) {
        const rel = full.slice(DOCS_ROOT.length + 1).replace(/\.md$/, '')
        if (EXCLUDE.some((re) => re.test(rel))) continue
        const page = readDocPage(full)
        if (page) pages.set(`/${rel}`, page)
      }
    }
  }
  walk(DOCS_ROOT)
  return pages
}

// ── Key derivation ──────────────────────────────────────────────────────────

const toCamel = (segment) =>
  segment.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())

/** Auto key: camelCase parent dir for an `overview` page, else basename. */
function autoKey(urlPath) {
  const parts = urlPath.replace(/^\//, '').split('/')
  const base = parts[parts.length - 1]
  const parent = parts[parts.length - 2]
  return toCamel(base === 'overview' && parent ? parent : base)
}

/** Assign a stable key to every doc path (aliases win; collisions throw). */
function assignKeys(pages) {
  const pathToKey = new Map()
  const keyToPath = new Map()

  for (const [key, path] of Object.entries(CONSOLE_ALIASES)) {
    if (!pages.has(path)) {
      throw new Error(
        `CONSOLE_ALIASES.${key} points at ${path}, which no longer exists under apps/docs/docs. Update the alias in tools/scripts/generate-docs-help.mjs.`,
      )
    }
    pathToKey.set(path, key)
    keyToPath.set(key, path)
  }

  for (const path of pages.keys()) {
    if (pathToKey.has(path)) continue
    const key = autoKey(path)
    const clash = keyToPath.get(key)
    if (clash) {
      throw new Error(
        `Docs help key collision: '${key}' derives from both ${clash} and ${path}. Add a CONSOLE_ALIASES entry to disambiguate in tools/scripts/generate-docs-help.mjs.`,
      )
    }
    pathToKey.set(path, key)
    keyToPath.set(key, path)
  }
  return pathToKey
}

// ── Emit ────────────────────────────────────────────────────────────────────

const LICENSE = `/**
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
 */`

const GENERATED_NOTE = `// GENERATED FILE — do not edit. Regenerate with:
//   node tools/scripts/generate-docs-help.mjs
// Source of truth: apps/docs/docs frontmatter + headings (AGL-602).`

/** TS string literal, single-quoted with escaping, matching repo style. */
function tsString(value) {
  const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  return `'${escaped}'`
}

function emitConsole(pages, pathToKey) {
  const entries = [...pages.entries()]
    .map(([path, page]) => [pathToKey.get(path), path, page])
    .sort((a, b) => a[0].localeCompare(b[0]))

  const topics = entries
    .map(
      ([key, path, page]) =>
        `  ${key}: {\n    path: ${tsString(path)},\n    title: ${tsString(page.title)},\n    excerpt: ${tsString(page.excerpt)},\n  },`,
    )
    .join('\n')

  const anchors = entries
    .filter(([, , page]) => page.anchors.length > 0)
    .map(
      ([key, , page]) =>
        `  ${key}: [${page.anchors.map(tsString).join(', ')}],`,
    )
    .join('\n')

  return `${LICENSE}
${GENERATED_NOTE}

export interface DocsHelpTopic {
  /** Docs-site path, e.g. \`/content-and-data/media/overview\`. */
  path: string
  /** Docs page title. */
  title: string
  /** Verbatim docs frontmatter description — the tooltip excerpt. */
  excerpt: string
}

export const DOCS_HELP_TOPICS = {
${topics}
} as const satisfies Record<string, DocsHelpTopic>

export type DocsHelpTopicKey = keyof typeof DOCS_HELP_TOPICS

// Heading anchors present on each topic's docs page. Only topics with H2–H4
// headings appear; a topic absent here has no linkable anchors.
export const DOCS_HELP_ANCHORS = {
${anchors}
} as const satisfies Partial<
  Record<DocsHelpTopicKey, readonly \`#\${string}\`[]>
>

type AnchorMap = typeof DOCS_HELP_ANCHORS

/** Valid heading anchors for a topic (\`never\` when the page has none). */
export type DocsHelpAnchor<K extends DocsHelpTopicKey> =
  K extends keyof AnchorMap ? AnchorMap[K][number] : never
`
}

function emitBesigner(pages) {
  const entries = Object.entries(BESIGNER_TOPICS).sort((a, b) =>
    a[0].localeCompare(b[0]),
  )
  for (const [key, path] of entries) {
    if (!pages.has(path)) {
      throw new Error(
        `BESIGNER_TOPICS.${key} points at ${path}, which no longer exists under apps/docs/docs. Update tools/scripts/generate-docs-help.mjs.`,
      )
    }
  }

  const map = entries
    .map(([key, path]) => `  ${key}: ${tsString(path)},`)
    .join('\n')

  const anchors = entries
    .filter(([, path]) => pages.get(path).anchors.length > 0)
    .map(
      ([key, path]) =>
        `  ${key}: [${pages.get(path).anchors.map(tsString).join(', ')}],`,
    )
    .join('\n')

  return `${LICENSE}
${GENERATED_NOTE}

// The besigner designer lib can't import the console constants, so it carries
// its own generated subset of the docs help registry.

export const BESIGNER_DOCS = {
${map}
} as const satisfies Record<string, string>

export type BesignerDocsKey = keyof typeof BESIGNER_DOCS

export const BESIGNER_DOCS_ANCHORS = {
${anchors}
} as const satisfies Partial<Record<BesignerDocsKey, readonly \`#\${string}\`[]>>

type BesignerAnchorMap = typeof BESIGNER_DOCS_ANCHORS

/** Valid heading anchors for a besigner docs page (\`never\` when none). */
export type BesignerDocsAnchor<K extends BesignerDocsKey> =
  K extends keyof BesignerAnchorMap ? BesignerAnchorMap[K][number] : never
`
}

// ── Main ──────────────────────────────────────────────────────────────────

const pages = collectDocs()
const pathToKey = assignKeys(pages)
const outputs = [
  [CONSOLE_OUT, emitConsole(pages, pathToKey)],
  [BESIGNER_OUT, emitBesigner(pages)],
]

const check = process.argv.includes('--check')
let stale = false
for (const [file, content] of outputs) {
  const current = (() => {
    try {
      return readFileSync(file, 'utf8')
    } catch {
      return null
    }
  })()
  if (current === content) continue
  stale = true
  if (check) {
    console.error(`STALE  ${file.slice(ROOT.length + 1)}`)
  } else {
    writeFileSync(file, content)
    console.log(`wrote  ${file.slice(ROOT.length + 1)}`)
  }
}

if (check && stale) {
  console.error(
    '\nThe docs help registry is out of date with apps/docs.\n' +
      'Run: node tools/scripts/generate-docs-help.mjs',
  )
  process.exit(1)
}
if (!stale) console.log(`docs help registry up to date (${pages.size} topics)`)
