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

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Coverage guard for the contextual help system (AGL-605). Keeps "help
 * everywhere applicable" (AGL-599..601) durable: a new feature page or card
 * that ships without a `help` affordance fails here unless it is explicitly
 * listed as an intentional exception below.
 *
 * The checks are deliberately file-level heuristics (not an AST walk): a file
 * that renders the surface must also reference `help=` somewhere, or be
 * allowlisted. That catches the real risk — a whole new surface added with no
 * help at all — which is exactly how the screen detail page was missed
 * (AGL-604). Partial coverage within an already-help-using file is out of
 * scope for this guard.
 */

const REPO_ROOT = join(__dirname, '../../..')
const CONSOLE_ROOT = join(REPO_ROOT, 'apps/console')

/**
 * Files intentionally exempt from the help requirement. Each entry is a
 * repo-relative path with a reason — the list doubles as the record of
 * deliberate non-help surfaces. Keep reasons specific; if you add a file
 * here, you are asserting help genuinely does not apply.
 */
const EXCEPTIONS: Record<string, string> = {
  'apps/console/app/(app)/[orgSlug]/hosts/[host]/community/[listingId]/page.tsx':
    'Chrome only — content is a plugin widget slot (communityListing) that renders its own card.',
  'apps/console/components/card-display-form-template.tsx':
    'Infrastructure wrapper — forwards schema-level help via CardDisplayProps, has no header of its own.',
  'apps/console/app/(app)/page.tsx':
    'Org jump page — navigational workspace picker, not a documented feature surface.',
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      walk(full, out)
    } else if (/\.tsx$/.test(entry.name) && !/\.spec\.tsx$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

function repoPath(abs: string): string {
  return relative(REPO_ROOT, abs)
}

describe('contextual help coverage', () => {
  const files = [
    ...walk(join(CONSOLE_ROOT, 'app')),
    ...walk(join(CONSOLE_ROOT, 'components')),
  ]

  it('every DashboardLayout page has a help affordance', () => {
    const missing: string[] = []
    for (const file of files) {
      if (!file.endsWith('page.tsx')) continue
      const source = readFileSync(file, 'utf8')
      if (!/\bDashboardLayout\b/.test(source)) continue
      if (/\bhelp=/.test(source)) continue
      const rel = repoPath(file)
      if (rel in EXCEPTIONS) continue
      missing.push(rel)
    }
    if (missing.length) {
      throw new Error(
        `These DashboardLayout pages have no help= prop. Add help="<topic>" (see docs/DOCS_HELP_REGISTRY.md) or add the file to EXCEPTIONS with a reason:\n  ${missing.join('\n  ')}`,
      )
    }
  })

  it('every CardDisplay with a header has a help affordance', () => {
    const missing: string[] = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      if (!/\bCardDisplay\b/.test(source)) continue
      // Only cards that render a title can carry a header help icon.
      if (!/\bheader=/.test(source)) continue
      if (/\bhelp=/.test(source)) continue
      const rel = repoPath(file)
      if (rel in EXCEPTIONS) continue
      missing.push(rel)
    }
    if (missing.length) {
      throw new Error(
        `These files render a CardDisplay with a header but never pass help=. Add help={docsHelp('<topic>')} or add the file to EXCEPTIONS with a reason:\n  ${missing.join('\n  ')}`,
      )
    }
  })

  it('every EXCEPTIONS entry still exists and still needs the exemption', () => {
    for (const [rel, reason] of Object.entries(EXCEPTIONS)) {
      expect(reason.length).toBeGreaterThan(10)
      let source: string
      try {
        source = readFileSync(join(REPO_ROOT, rel), 'utf8')
      } catch {
        throw new Error(
          `EXCEPTIONS lists ${rel}, which no longer exists. Remove the stale entry.`,
        )
      }
      // A file that now passes help= no longer needs to be exempted.
      if (/\bhelp=/.test(source)) {
        throw new Error(
          `EXCEPTIONS lists ${rel}, but it now passes help= — remove the stale exemption.`,
        )
      }
    }
  })
})
