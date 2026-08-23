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

// The version may never go BACKWARDS against what production is running
// (AGL-2486).
//
// On 2026-08-20 `55e558d87` bumped the workspace to 1.0.0-beta.7 and tagged
// it. Two commits later `d266d674f` — "reconcile every charged price against
// Stripe live", a change about Stripe and nothing else — carried package.json
// back down to 1.0.0-beta.6:
//
//     -  "version": "1.0.0-beta.7",
//     +  "version": "1.0.0-beta.6",
//
// A stale worktree swept into a commit, which is a recorded hazard in this
// shared checkout. Nothing caught it for three days: the release tooling
// derives the NEXT bump from conventional commits and never compares the
// current version to anything. So `v1.0.0-beta.7` stood as a published tag
// while every build — production included — reported 1.0.0-beta.6, and the
// console footer said so to every visitor.
//
// A tag that names a version nobody is running is worse than no tag: it is
// the artifact a support case, a changelog and an incident timeline are all
// anchored on.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const root = join(import.meta.dirname, '..', '..', '..')

const read = (source) => JSON.parse(source).version

/** The version on a git ref, or null when the ref is not fetched here. */
function versionAt(ref) {
  try {
    return read(
      execFileSync('git', ['show', `${ref}:package.json`], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    )
  } catch {
    return null
  }
}

/** [major, minor, patch, prereleaseNumber] — enough for `1.0.0-beta.N`. */
function parts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/.exec(version)
  assert.ok(match, `version is not a shape this guard understands: ${version}`)
  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    // A release outranks any prerelease of the same numbers.
    match[5] === undefined ? Number.POSITIVE_INFINITY : Number(match[5]),
  ]
}

/** -1, 0 or 1. Exported shape kept trivial so the assertion reads plainly. */
export function compareVersions(a, b) {
  const left = parts(a)
  const right = parts(b)
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] < right[i]) return -1
    if (left[i] > right[i]) return 1
  }
  return 0
}

describe('the workspace version never decreases (AGL-2486)', () => {
  const current = read(readFileSync(join(root, 'package.json'), 'utf8'))

  it('reads a version this guard can compare', () => {
    assert.ok(parts(current).length === 4)
  })

  it('is not behind what production is running', () => {
    const shipped = versionAt('origin/production')
    if (shipped === null) {
      // A shallow clone or a fresh checkout with no production ref. Skipping
      // is honest; asserting against a ref that is not here would be a green
      // that checked nothing.
      console.log('origin/production not available — comparison skipped')
      return
    }
    assert.ok(
      compareVersions(current, shipped) >= 0,
      `package.json is ${current} but production runs ${shipped}. A version ` +
        'that moves backwards is almost always an unrelated commit carrying ' +
        'a stale package.json — check `git log -p -- package.json`.',
    )
  })

  it('is not behind the newest release tag', () => {
    let tags
    try {
      tags = execFileSync('git', ['tag', '--list', 'v*', '--sort=-v:refname'], {
        cwd: root,
        encoding: 'utf8',
      })
        .split('\n')
        .filter(Boolean)
    } catch {
      return
    }
    const newest = tags.map((tag) => tag.slice(1)).find((version) => {
      try {
        parts(version)
        return true
      } catch {
        return false
      }
    })
    if (!newest) return
    assert.ok(
      compareVersions(current, newest) >= 0,
      `package.json is ${current} but v${newest} is already tagged. Reusing ` +
        'or undercutting a published tag makes the tag name a version nobody ' +
        'is running.',
    )
  })

  it('compares prereleases and releases the way semver does', () => {
    // Controls, so the two assertions above cannot pass because the
    // comparator answers 0 to everything.
    assert.equal(compareVersions('1.0.0-beta.8', '1.0.0-beta.7'), 1)
    assert.equal(compareVersions('1.0.0-beta.6', '1.0.0-beta.7'), -1)
    assert.equal(compareVersions('1.0.0-beta.7', '1.0.0-beta.7'), 0)
    assert.equal(compareVersions('1.0.0', '1.0.0-beta.9'), 1)
    assert.equal(compareVersions('1.1.0-beta.1', '1.0.0'), 1)
  })
})
