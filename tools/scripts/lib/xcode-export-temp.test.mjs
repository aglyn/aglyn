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

// The export cleanup must take only the staging folder its own export made:
// one that was there before may be an Organizer export still running.
//
//   node --test tools/scripts/lib/xcode-export-temp.test.mjs
//   npm run test:xcode-export-temp

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import {
  exportStagingFolders,
  exportTempRoots,
  withExportTempCleanup,
} from './xcode-export-temp.mjs'

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'xcode-export-temp-'))
  const older = join(root, 'XcodeDistPipeline.~~~older1')
  const unrelated = join(root, 'com.example.cache')
  mkdirSync(older)
  mkdirSync(unrelated)
  writeFileSync(join(older, 'payload'), 'x')
  return { root, older, unrelated }
}

describe('withExportTempCleanup', () => {
  it('removes the staging folder the export made and keeps the rest', () => {
    const { root, older, unrelated } = tempRoot()
    const made = join(root, 'XcodeDistPipeline.~~~made01')
    const value = withExportTempCleanup(() => {
      mkdirSync(made)
      writeFileSync(join(made, 'Packaging.log'), 'x')
      return 'exported'
    }, [root])
    assert.equal(value, 'exported')
    assert.equal(existsSync(made), false)
    assert.ok(existsSync(older), 'a folder from before the export stays')
    assert.ok(existsSync(unrelated))
  })

  it('cleans up when the export fails, and still throws', () => {
    const { root, older } = tempRoot()
    const made = join(root, 'XcodeDistPipeline.~~~fail01')
    assert.throws(
      () =>
        withExportTempCleanup(() => {
          mkdirSync(made)
          throw new Error('xcodebuild exited with 70')
        }, [root]),
      /exited with 70/,
    )
    assert.equal(existsSync(made), false)
    assert.ok(existsSync(older))
  })
})

describe('exportStagingFolders', () => {
  it('lists only staging folders and skips a root it cannot read', () => {
    const { root, older } = tempRoot()
    const found = exportStagingFolders([root, join(root, 'missing')])
    assert.deepEqual([...found], [older])
  })
})

describe('exportTempRoots', () => {
  it('names each root once, without a trailing slash', () => {
    const roots = exportTempRoots()
    assert.equal(new Set(roots).size, roots.length)
    for (const root of roots) assert.doesNotMatch(root, /\/$/)
  })
})
