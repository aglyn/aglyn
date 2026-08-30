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
 *
 * @jest-environment node
 */

/**
 * A 403 names the roles its guard actually admits.
 *
 * Twelve site-role doors refused with "Not a site admin" while admitting
 * editors as well, so the one thing a refused editor could read was a reason
 * that did not apply to them. A message that contradicts its own condition
 * costs more than a blank one: the reader believes the check, asks for the
 * role it names, and is refused again for reasons nobody has told them.
 *
 * The pairing is what this guard holds — not the wording. It reads the
 * condition immediately above each refusal and requires the two to agree in
 * both directions, so tightening a door to admin-only is red until the
 * message follows, exactly as widening one is.
 */

import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

/** Repo root, six levels up from `libs/plugins/marketplace/src/lib/server`. */
const REPO = join(__dirname, '..', '..', '..', '..', '..', '..')

/**
 * Resolved before anything reads a directory, and reported as an assertion
 * rather than thrown. A wrong depth here scans a path that does not exist,
 * and a suite that dies on ENOENT names a directory instead of naming the
 * mistake.
 */
const repoRootFound = existsSync(join(REPO, 'nx.json'))

/**
 * Where site-role doors live. Directories rather than a file list: the next
 * route somebody adds under one of them is in scope on the day it lands.
 */
const DOOR_DIRS = [
  'libs/plugins/marketplace/src/lib/server',
  'libs/plugins/marketing/src/lib/server',
  'apps/console/app/api',
]

const ADMIN_ONLY = `'Not a site admin'`
const ADMIN_OR_EDITOR = `'Not a site admin or editor'`

/** Every `.ts` file under a directory, specs excluded. */
function sourcesUnder(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...sourcesUnder(path))
      continue
    }
    if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.spec.')) {
      found.push(path)
    }
  }
  return found
}

interface Refusal {
  file: string
  line: number
  message: string
  /** Does the condition this refusal sits under admit the editor role? */
  admitsEditor: boolean
}

/**
 * The condition, read as the four lines above the refusal.
 *
 * A quoted `'editor'` and not the bare word: `admin/editor` in the prose of a
 * comment describes a door without opening it, and a guard that counted prose
 * would report a contradiction that is not in the code.
 */
function refusalsIn(path: string): Refusal[] {
  const lines = readFileSync(path, 'utf8').split('\n')
  const found: Refusal[] = []
  lines.forEach((line, index) => {
    const message = line.includes(ADMIN_OR_EDITOR)
      ? ADMIN_OR_EDITOR
      : line.includes(ADMIN_ONLY)
        ? ADMIN_ONLY
        : null
    if (!message) return
    const condition = lines.slice(Math.max(0, index - 4), index).join('\n')
    found.push({
      file: path.replace(`${REPO}/`, ''),
      line: index + 1,
      message,
      admitsEditor: condition.includes(`'editor'`),
    })
  })
  return found
}

const refusals = repoRootFound
  ? DOOR_DIRS.flatMap((dir) => sourcesUnder(join(REPO, dir))).flatMap(
      refusalsIn,
    )
  : []

describe('a site-role 403 names the roles it admits', () => {
  it('THE CONTROL: the sweep reads real directories and finds both shapes', () => {
    // A wrong repo depth, a moved directory or a renamed message would
    // otherwise let every assertion below pass by finding nothing to check.
    expect({ REPO, repoRootFound }).toEqual({ REPO, repoRootFound: true })
    expect(refusals.length).toBeGreaterThan(10)
    expect(refusals.some((refusal) => refusal.admitsEditor)).toBe(true)
    expect(refusals.some((refusal) => !refusal.admitsEditor)).toBe(true)
  })

  it('a door that admits editors says so', () => {
    const wrong = refusals
      .filter(
        (refusal) =>
          refusal.admitsEditor && refusal.message !== ADMIN_OR_EDITOR,
      )
      .map((refusal) => `${refusal.file}:${refusal.line}`)
    expect(wrong).toEqual([])
  })

  it('a door that does NOT admit editors does not claim to', () => {
    // The other direction, and the one that matters when a gate is later
    // tightened: a message left saying "or editor" invites a role the door
    // now refuses.
    const wrong = refusals
      .filter(
        (refusal) => !refusal.admitsEditor && refusal.message !== ADMIN_ONLY,
      )
      .map((refusal) => `${refusal.file}:${refusal.line}`)
    expect(wrong).toEqual([])
  })
})
