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
 * A 403 names what its guard actually asks.
 *
 * Twelve site-role doors refused with "Not a site admin" while admitting
 * editors as well, so the one thing a refused editor could read was a reason
 * that did not apply to them. A message that contradicts its own condition
 * costs more than a blank one: the reader believes the check, asks for the
 * role it names, and is refused again for reasons nobody has told them.
 *
 * These doors now ask a permission key and refuse by naming it (AGL-4047), so
 * the pairing is held on that shape: the key in the condition and the key in
 * the refusal must be the same. The role-worded shape is held to staying gone,
 * and its reader is proved on a fixture because the tree has none left to read.
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
function refusalsIn(file: string, source: string): Refusal[] {
  const lines = source.split('\n')
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
      file,
      line: index + 1,
      message,
      admitsEditor: condition.includes(`'editor'`),
    })
  })
  return found
}

interface KeyRefusal {
  file: string
  line: number
  /** The argument of `siteKeyRefusal(…)`, as written. */
  names: string
  /** The key argument of each `holdsSiteKey(…)` in the condition, as written. */
  asks: string[]
}

/**
 * Each `siteKeyRefusal(…)` written at its door, with the key the door asks.
 *
 * Arguments compare as written, so a door asking a variable (`roleKey`) pairs
 * with a refusal naming that variable. A refusal exported as a named constant
 * sits apart from its doors and is not read here.
 */
function keyRefusalsIn(file: string, source: string): KeyRefusal[] {
  const lines = source.split('\n')
  const found: KeyRefusal[] = []
  lines.forEach((line, index) => {
    const names = /\bsiteKeyRefusal\(([^)]+)\)/.exec(line)?.[1]?.trim()
    if (!names || /^\s*(export |import |\/\/|\*)/.test(line)) return
    const condition = lines.slice(Math.max(0, index - 4), index + 1).join('\n')
    found.push({
      file,
      line: index + 1,
      names,
      asks: [...condition.matchAll(/\bholdsSiteKey\([^,]+,[^,]+,\s*([^,)]+?)\s*\)/g)].map(
        (match) => match[1],
      ),
    })
  })
  return found
}

const sources = repoRootFound
  ? DOOR_DIRS.flatMap((dir) => sourcesUnder(join(REPO, dir))).map((path) => ({
      file: path.replace(`${REPO}/`, ''),
      source: readFileSync(path, 'utf8'),
    }))
  : []
const refusals = sources.flatMap(({ file, source }) => refusalsIn(file, source))
const keyRefusals = sources.flatMap(({ file, source }) => keyRefusalsIn(file, source))

describe('a site door’s 403 names what it asks', () => {
  it('THE CONTROL: the sweep reads real directories and finds the doors', () => {
    // A wrong repo depth, a moved directory or a renamed helper would
    // otherwise let every assertion below pass by finding nothing to check.
    expect({ REPO, repoRootFound }).toEqual({ REPO, repoRootFound: true })
    expect(keyRefusals.length).toBeGreaterThan(15)
    // And the readers tell a pair that agrees from one that does not.
    expect(
      keyRefusalsIn(
        'fixture',
        `if (!holdsSiteKey(host, uid, 'site.edit')) {\n  return { error: siteKeyRefusal('site.manage') }\n}`,
      ),
    ).toEqual([{ file: 'fixture', line: 2, names: `'site.manage'`, asks: [`'site.edit'`] }])
    expect(
      refusalsIn('fixture', `if (role !== 'admin' && role !== 'editor') {\n  throw new Error(${ADMIN_ONLY})\n}`),
    ).toEqual([{ file: 'fixture', line: 2, message: ADMIN_ONLY, admitsEditor: true }])
  })

  it('a door refuses by the key it asks', () => {
    const wrong = keyRefusals
      .filter((refusal) => !refusal.asks.includes(refusal.names))
      .map((refusal) => `${refusal.file}:${refusal.line} names ${refusal.names}, asks ${refusal.asks.join(', ') || 'nothing beside it'}`)
    expect(wrong).toEqual([])
  })

  it('no door refuses in a role’s words any more', () => {
    expect(refusals.map((refusal) => `${refusal.file}:${refusal.line}`)).toEqual([])
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
