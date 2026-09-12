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

// Pins the rules and indexes paths in the config
// `tools/scripts/emulator-config.mjs` writes (AGL-2858).
//
//   node --test tools/scripts/lib/emulator-config.test.mjs
//
// firebase-tools reads each of those paths the way its `Config.path` does: it
// joins the path onto the directory of the config it was given, and refuses
// one that resolves outside that directory as "outside of project directory".
// A config can parse, with every port right, and still not start. So each
// written path is read back here the same way. An absolute path is doubled by
// the join, and a `../` path is refused.
//
// The script runs as a person runs it, from the root of a copy of the repo's
// layout in a temp directory: the script, `cloud/firebase.e2e.json`, and the
// files that config names. The script finds everything from its own location,
// so it writes only into the copy.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, normalize, relative } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const SCRIPT = join('tools', 'scripts', 'emulator-config.mjs')
const E2E_CONFIG = join('cloud', 'firebase.e2e.json')

/** The keys the script rewrites. Each one names a file. */
const PATH_KEYS = [
  ['firestore', 'rules'],
  ['firestore', 'indexes'],
  ['storage', 'rules'],
  ['database', 'rules'],
]

const copies = []
after(() => {
  for (const copy of copies) rmSync(copy, { recursive: true, force: true })
})

/**
 * Copies the script, the e2e config and the files it names into a temp
 * directory laid out like the repo, and returns its root. `edit` may change
 * the copied config.
 *
 * The root is a real path. On macOS the temp directory is behind a symlink,
 * and the script sees its own location with that symlink resolved.
 */
function copyRepo(edit = (config) => config) {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), 'agl2858-emulator-config-')),
  )
  copies.push(root)
  mkdirSync(join(root, dirname(SCRIPT)), { recursive: true })
  copyFileSync(join(repoRoot, SCRIPT), join(root, SCRIPT))
  const config = JSON.parse(readFileSync(join(repoRoot, E2E_CONFIG), 'utf8'))
  for (const [section, key] of PATH_KEYS) {
    const target = join(root, 'cloud', config[section][key])
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(repoRoot, 'cloud', config[section][key]), target)
  }
  writeFileSync(
    join(root, E2E_CONFIG),
    JSON.stringify(edit(config, root), null, 2),
  )
  return root
}

/**
 * Runs the copied script and returns the config file it names. The script
 * refuses an offset whose ports are taken, and this may run beside a live
 * emulator stack, so the first free offset is used.
 */
function generate(root) {
  for (const offset of [31000, 33000, 35000, 37000, 39000]) {
    const run = spawnSync(
      process.execPath,
      [join(root, SCRIPT), `--offset=${offset}`],
      { cwd: root, encoding: 'utf8' },
    )
    if (run.status === 0) {
      const exported = /^export FIREBASE_EMULATOR_CONFIG='(.+)'$/m.exec(
        run.stdout,
      )
      assert.ok(exported, `no FIREBASE_EMULATOR_CONFIG in:\n${run.stdout}`)
      return exported[1]
    }
    assert.match(run.stderr, /collides/, run.stderr)
  }
  assert.fail('every candidate offset collides with a port in use')
}

/** Each path in a written config, resolved the way firebase-tools does. */
function writtenPaths(file) {
  const config = JSON.parse(readFileSync(file, 'utf8'))
  const projectDir = dirname(file)
  return PATH_KEYS.map(([section, key]) => {
    const value = config[section][key]
    const resolved = normalize(join(projectDir, value))
    return {
      name: `${section}.${key}`,
      value,
      resolved,
      inside: !relative(projectDir, resolved).includes('..'),
    }
  })
}

describe('the config emulator-config.mjs writes', () => {
  let paths
  before(() => {
    paths = writtenPaths(generate(copyRepo()))
  })

  it('holds no absolute path, which firebase-tools would join onto its directory', () => {
    assert.deepEqual(
      paths
        .filter((path) => isAbsolute(path.value))
        .map((path) => `${path.name}: ${path.value}`),
      [],
    )
  })

  it('names an existing file with every path joined onto its directory', () => {
    assert.deepEqual(
      paths
        .filter((path) => !existsSync(path.resolved))
        .map((path) => `${path.name}: ${path.resolved}`),
      [],
    )
  })

  it('names no file outside its directory, which firebase-tools refuses', () => {
    assert.deepEqual(
      paths
        .filter((path) => !path.inside)
        .map((path) => `${path.name}: ${path.value}`),
      [],
    )
  })
})

describe('a path the e2e config gives as absolute', () => {
  it('is written relative, naming the same file', () => {
    const root = copyRepo((config, copyRoot) => {
      config.storage.rules = join(copyRoot, 'cloud', config.storage.rules)
      return config
    })
    const storage = writtenPaths(generate(root)).find(
      (path) => path.name === 'storage.rules',
    )
    assert.equal(isAbsolute(storage.value), false, storage.value)
    assert.equal(storage.inside, true, storage.value)
    assert.equal(
      storage.resolved,
      join(root, 'cloud', 'firebase-storage.rules'),
    )
  })
})
