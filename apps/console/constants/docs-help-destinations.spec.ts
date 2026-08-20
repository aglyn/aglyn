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
import { DOCS_HELP_ANCHORS, DOCS_HELP_TOPICS } from './docs-links'

/**
 * The page header's help affordance must be CORRECT, not merely present
 * (AGL-2200).
 *
 * `apps/console/specs/help-coverage.spec.ts` asks whether a page file
 * mentions `help=` anywhere. That is presence, and presence is a weaker claim
 * than it reads as — the same weakness AGL-2130 already found and fixed for
 * cards, still standing for pages. Two distinct failures survive it:
 *
 * 1. **The prop is not on the layout.** A page whose only `help=` sits on a
 *    card inside it passes the file-level check while its header carries no
 *    help icon at all. Six pages were in that state when this guard was
 *    written — Organization Settings, a team member's detail, a staff org
 *    detail, a staff user detail, a staff host detail, and Notifications.
 *
 * 2. **Many surfaces share one destination.** AGL-1074 is the record of what
 *    that costs: twelve plugin consoles showed one "Plugins & Marketplace"
 *    tooltip because one route rendered them all. The same bug arrives from
 *    the other end when distinct routes each name the same topic by hand —
 *    eight `/admin` pages opened the top of one long staff-console page, and
 *    all seven Plugins/Marketplace pages opened the same paragraph. Nothing
 *    is missing in either case, so nothing that counts presence can see it.
 *
 * So the unit here is the DESTINATION: the `(topic, anchor)` pair a page's
 * header actually opens. Two pages may share one only by being named below,
 * with a reason.
 *
 * Deliberately not covered: the generic plugin route, whose destination is a
 * runtime string from a plugin manifest — `apps/console/specs/plugin-help-topics.spec.ts`
 * owns that one, and it is the only page here allowed to resolve dynamically.
 */

const REPO_ROOT = join(__dirname, '../../..')
const APP_ROOT = join(REPO_ROOT, 'apps/console/app')

/**
 * Pages whose header carries no help affordance, by design. A page lands here
 * when it documents nothing — a pure navigation shell — and not because a
 * topic was hard to choose.
 */
const NO_HELP: Record<string, string> = {
  'apps/console/app/(app)/(home)/page.tsx':
    'Org jump page — a workspace picker with no subject of its own. Every destination it offers carries its own help.',
}

/**
 * Destinations two or more pages are allowed to share, keyed exactly as the
 * failure message prints them, each with the reason the two surfaces really
 * are one subject. An entry that no longer describes a live collision fails
 * below rather than lingering — a stale exemption silently covers the next
 * one.
 */
const SHARED_DESTINATIONS: Record<string, string> = {}

/** Every `page.tsx` under apps/console/app. */
function pages(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      pages(full, out)
    } else if (entry.name === 'page.tsx') {
      out.push(full)
    }
  }
  return out
}

/**
 * The `<DashboardLayout …>` opening tag, brace-aware.
 *
 * Scanning to the first `>` would stop inside `header={{ children: '…' }}`
 * on almost every page in the app and report a layout with no props — which
 * under-reports, the direction that makes a guard useless.
 */
function layoutTag(source: string): string | null {
  const start = source.indexOf('<DashboardLayout')
  if (start < 0) return null
  let depth = 0
  let cursor = start
  while (cursor < source.length) {
    const char = source[cursor]
    if (char === '{') depth += 1
    else if (char === '}') depth -= 1
    else if (char === '>' && depth === 0) break
    cursor += 1
  }
  return source.slice(start, cursor)
}

interface Destination {
  topic: string
  anchor: string
  /** True for the one route whose topic is a runtime plugin string. */
  dynamic: boolean
}

/** The `help=` value on a DashboardLayout tag, or null when there is none. */
function destinationOf(tag: string): Destination | null {
  const literal = /\bhelp="([A-Za-z0-9]+)"/.exec(tag)
  if (literal) return { topic: literal[1], anchor: '', dynamic: false }

  const expression = /\bhelp=\{([\s\S]*)/.exec(tag)
  if (!expression) return null
  const body = expression[1]
  if (/resolveDocsHelpTopic\(/.test(body)) {
    return { topic: '(runtime)', anchor: '', dynamic: true }
  }
  const topic = /\btopic:\s*'([A-Za-z0-9]+)'/.exec(body)
  if (!topic) return null
  const anchor = /\banchor:\s*'(#[^']*)'/.exec(body)
  return { topic: topic[1], anchor: anchor?.[1] ?? '', dynamic: false }
}

function repoPath(abs: string): string {
  return relative(REPO_ROOT, abs)
}

interface Scanned {
  file: string
  destination: Destination | null
}

const scanned: Scanned[] = pages(APP_ROOT)
  .map((file) => ({ file, source: readFileSync(file, 'utf8') }))
  .filter(({ source }) => source.includes('<DashboardLayout'))
  .map(({ file, source }) => ({
    file: repoPath(file),
    destination: destinationOf(layoutTag(source) as string),
  }))

describe('docs help destinations (AGL-2200)', () => {
  // Anti-vacuity, asserted first: every finding below is "nothing was wrong"
  // when the scan finds nothing, so a renamed layout or a broken tag reader
  // has to fail as itself rather than as a pass.
  it('reads a real population of DashboardLayout pages', () => {
    expect(scanned.length).toBeGreaterThan(45)
    expect(
      scanned.filter((page) => page.destination?.anchor).length,
    ).toBeGreaterThan(15)
  })

  it('every DashboardLayout page names its help ON the layout, not merely somewhere in the file', () => {
    const missing = scanned
      .filter((page) => !page.destination && !(page.file in NO_HELP))
      .map((page) => page.file)
    if (missing.length) {
      throw new Error(
        `These pages render <DashboardLayout> with no help= on the tag, so their header shows no help icon. A help= on a card inside the page does not count — that is the hole this guard exists for.\nAdd help={{ topic, anchor }} to the layout, or add the file to NO_HELP with a reason:\n  ${missing.join('\n  ')}`,
      )
    }
  })

  it('every named topic and anchor exists in the generated registry', () => {
    const bad: string[] = []
    for (const { file, destination } of scanned) {
      if (!destination || destination.dynamic) continue
      if (!(destination.topic in DOCS_HELP_TOPICS)) {
        bad.push(`${file}: topic '${destination.topic}' is not in DOCS_HELP_TOPICS`)
        continue
      }
      if (!destination.anchor) continue
      const anchors: readonly string[] =
        (DOCS_HELP_ANCHORS as Record<string, readonly string[]>)[
          destination.topic
        ] ?? []
      if (!anchors.includes(destination.anchor)) {
        bad.push(
          `${file}: '${destination.topic}' has no heading ${destination.anchor}`,
        )
      }
    }
    if (bad.length) {
      throw new Error(
        `A header help link points at a docs heading that does not exist — the reader lands at the top of the page believing they are in the right place.\nRegenerate after a docs edit (node tools/scripts/generate-docs-help.mjs):\n  ${bad.join('\n  ')}`,
      )
    }
  })

  const byDestination = new Map<string, string[]>()
  for (const { file, destination } of scanned) {
    if (!destination || destination.dynamic) continue
    const key = `${destination.topic}${destination.anchor}`
    byDestination.set(key, [...(byDestination.get(key) ?? []), file])
  }

  it('no two pages open the same docs destination', () => {
    const shared = [...byDestination.entries()].filter(
      ([key, files]) => files.length > 1 && !(key in SHARED_DESTINATIONS),
    )
    if (shared.length) {
      throw new Error(
        `These pages all open the SAME docs destination, so their help icons are interchangeable — the AGL-1074 failure reached from the destination end.\nGive each surface the heading it is standing in front of ({ topic, anchor }), or add the key to SHARED_DESTINATIONS with a reason:\n${shared
          .map(([key, files]) => `  ${key}\n    ${files.join('\n    ')}`)
          .join('\n')}`,
      )
    }
  })

  it('every SHARED_DESTINATIONS entry is still a real collision', () => {
    for (const [key, reason] of Object.entries(SHARED_DESTINATIONS)) {
      expect(reason.length).toBeGreaterThan(20)
      const files = byDestination.get(key) ?? []
      if (files.length < 2) {
        throw new Error(
          `SHARED_DESTINATIONS names ${key}, which ${files.length} page(s) now open. Remove the stale entry — it exempts nothing and hides the next collision.`,
        )
      }
    }
  })

  it('every NO_HELP entry still renders a DashboardLayout with no help', () => {
    for (const [file, reason] of Object.entries(NO_HELP)) {
      expect(reason.length).toBeGreaterThan(20)
      const page = scanned.find((entry) => entry.file === file)
      if (!page) {
        throw new Error(
          `NO_HELP names ${file}, which no longer renders a DashboardLayout. Remove the stale entry.`,
        )
      }
      if (page.destination) {
        throw new Error(
          `NO_HELP names ${file}, but its layout now passes help=. Remove the stale exemption.`,
        )
      }
    }
  })
})
