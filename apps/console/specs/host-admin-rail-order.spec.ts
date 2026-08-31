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
 * The order of the site Admin rail, which is a product decision rather than an
 * implementation detail.
 *
 * Admin governs the site as an OBJECT — its address, its permissions, its
 * history, its existence — and the rail is read top to bottom as that story.
 * General is first because a name and an address are what identify the thing
 * every section below governs. Backup & template sits between Activity and
 * Danger zone: moving the whole site somewhere else, or bringing it back, is
 * the last thing short of deleting it.
 *
 * Read off the SOURCE rather than a rendered rail, because what is being
 * pinned is the list itself. Rendering it would need the whole console
 * provider stack to say something a regular expression already says exactly,
 * and a reorder is a one-line edit that no other spec would notice.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Route } from '../constants/route-links'

const LAYOUT = join(
  __dirname,
  '..',
  'app/(app)/[orgSlug]/hosts/[host]/admin/(sections)/layout.tsx',
)

/** Every `section(Route.X, 'Label')` in the file, in the order written. */
function railEntries(): Array<{ route: string; label: string }> {
  const source = readFileSync(LAYOUT, 'utf8')
  const pattern = /section\(\s*Route\.([A-Z_]+)\s*,\s*'([^']+)'\s*\)/g
  const found: Array<{ route: string; label: string }> = []
  for (const match of source.matchAll(pattern)) {
    found.push({ route: match[1] as string, label: match[2] as string })
  }
  return found
}

describe('the site Admin rail', () => {
  /*
   * The CONTROL. Every assertion below is about the CONTENTS of this list, and
   * a pattern that matched nothing would satisfy an `toEqual` against an empty
   * array just as happily. This is what says the file was really read and the
   * shape really parsed.
   */
  it('CONTROL: the rail was read from the layout, not guessed', () => {
    expect(railEntries().length).toBeGreaterThan(4)
  })

  it('lists its sections in the order a reader is meant to meet them', () => {
    expect(railEntries().map((entry) => entry.label)).toEqual([
      'General',
      'Plugins',
      'Custom Domain',
      'Security',
      'Activity',
      'Backup & template',
      'Danger zone',
    ])
  })

  it('draws every entry from the route table', () => {
    for (const { route, label } of railEntries()) {
      expect({ label, routed: route in Route }).toEqual({ label, routed: true })
    }
  })

  /*
   * Backup & template is NOT the Danger zone, and the rail has to keep saying
   * so. A restore overwrites, but exporting a backup and publishing a template
   * do not — folding the three under a destructive heading would teach an owner
   * to fear two actions that are safe.
   */
  it('keeps backup and template out of the Danger zone', () => {
    const labels = railEntries().map((entry) => entry.label)
    expect(labels).toContain('Backup & template')
    expect(labels.indexOf('Backup & template')).toBeLessThan(
      labels.indexOf('Danger zone'),
    )
  })
})
