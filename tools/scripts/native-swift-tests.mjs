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

// The Swift half of `native swift` in .github/workflows/native-tests.yml
// (AGL-3783). See tools/scripts/lib/native-swift-tests.mjs for why.
//
//   node tools/scripts/native-swift-tests.mjs mtimes
//     Stamps every tracked file with a modification time derived from its
//     content, so a build restored from the Actions cache recompiles only
//     what changed.
//
//   node tools/scripts/native-swift-tests.mjs run --umbrella <dir> --scratch <dir>
//       [--build-system swiftbuild] [--plan]
//     Writes the umbrella package to <dir>, builds every test target in it once
//     (plus the generated plugin manifest), then runs them all. The build
//     system defaults to Swift Build, which gives each test target its own
//     bundle and process (the native engine links one bundle for the whole
//     package, which would put every package's tests in one process). A
//     package the umbrella cannot hold is tested on its own, as before. --plan
//     prints the plan and stops.
//
// Exits non-zero when anything fails to resolve, build or pass.

import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  lstatSync,
  lutimesSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DIRECTORY_MTIME,
  contentMtime,
  packageName,
  planUmbrella,
  renderUmbrella,
} from './lib/native-swift-tests.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const KIT = 'libs/native/apple'
const MANIFEST = 'apps/ios/PluginManifest'
const APP_RESOLVED = 'apps/ios/Aglyn.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved'
const inActions = Boolean(process.env.GITHUB_ACTIONS)

const [command, ...rest] = process.argv.slice(2)
const option = (name) => {
  const at = rest.indexOf(name)
  return at === -1 ? undefined : rest[at + 1]
}

function git(...args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
  return result.stdout
}

function group(title, body) {
  console.log(inActions ? `::group::${title}` : `--- ${title}`)
  try {
    return body()
  } finally {
    if (inActions) console.log('::endgroup::')
  }
}

function annotate(level, message) {
  console.log(inActions ? `::${level}::${message}` : `${level}: ${message}`)
}

function swift(args) {
  console.log(`$ swift ${args.join(' ')}`)
  const started = Date.now()
  const result = spawnSync('swift', args, { cwd: repoRoot, stdio: 'inherit' })
  console.log(`(${((Date.now() - started) / 1000).toFixed(1)}s, exit ${result.status ?? result.signal})`)
  return result.status === 0
}

function stampMtimes() {
  const started = Date.now()
  const dirs = new Set()
  let files = 0
  for (const entry of git('ls-files', '-s', '-z').split('\0')) {
    if (!entry) continue
    const tab = entry.indexOf('\t')
    const [mode, oid] = entry.slice(0, tab).split(' ')
    const path = entry.slice(tab + 1)
    if (mode === '160000') continue
    const time = contentMtime(oid)
    try {
      if (mode === '120000') lutimesSync(join(repoRoot, path), time, time)
      else utimesSync(join(repoRoot, path), time, time)
      files++
    } catch {
      continue
    }
    for (let dir = dirname(path); dir !== '.'; dir = dirname(dir)) {
      if (dirs.has(dir)) break
      dirs.add(dir)
    }
  }
  for (const dir of dirs) utimesSync(join(repoRoot, dir), DIRECTORY_MTIME, DIRECTORY_MTIME)
  console.log(`stamped ${files} files and ${dirs.size} folders from their content (${Date.now() - started} ms)`)
}

/** Every Swift package with a Tests folder: AglynKit, then each plugin's src/ios. */
function discover(umbrellaDir) {
  const manifests = [`${KIT}/Package.swift`, ...git('ls-files', '-z', 'libs/plugins/*/src/ios/Package.swift').split('\0')]
  const tracked = git('ls-files', '-z', `${KIT}/Tests`, 'libs/plugins/*/src/ios/Tests/*').split('\0').filter(Boolean)
  const packages = []
  for (const file of manifests.filter(Boolean).sort((a, b) => (a === `${KIT}/Package.swift` ? -1 : a.localeCompare(b)))) {
    const dir = dirname(file)
    const prefix = `${dir}/Tests/`
    const testDirs = [...new Set(tracked.filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length).split('/')[0]))]
    if (testDirs.length === 0) {
      annotate('notice', `${dir} has no Tests; skipped`)
      continue
    }
    const manifest = readFileSync(join(repoRoot, file), 'utf8')
    packages.push({ dir, manifest, testDirs, reach: reachFor(dir, manifest, umbrellaDir) })
  }
  return packages
}

/**
 * The path the umbrella names a package by. Its last component is the package
 * identity, so a plugin is reached through the plugin manifest's own link
 * (Plugins/<Name>): the manifest package names it that way too, and two paths
 * with one identity would conflict.
 */
function reachFor(dir, manifest, umbrellaDir) {
  const real = realpathSync(join(repoRoot, dir))
  if (dir === KIT) return real
  const name = packageName(manifest) ?? dir.split('/')[2]
  const viaManifest = join(repoRoot, MANIFEST, 'Plugins', name)
  try {
    if (realpathSync(viaManifest) === real) return resolve(viaManifest)
  } catch {
    // Not in the plugin manifest (yet): reached through a link of our own.
  }
  const own = join(umbrellaDir, 'Packages', name)
  mkdirSync(dirname(own), { recursive: true })
  symlinkSync(real, own)
  return own
}

function writeUmbrella(plan, umbrellaDir) {
  const manifestPackage = existsSync(join(repoRoot, MANIFEST, 'Package.swift'))
    ? { reach: resolve(repoRoot, MANIFEST), product: 'AglynPluginManifest' }
    : undefined
  writeFileSync(join(umbrellaDir, 'Package.swift'), renderUmbrella(plan, { manifestPackage, repoLink: 'repo' }))
  symlinkSync(realpathSync(repoRoot), join(umbrellaDir, 'repo'))
  if (manifestPackage) {
    const source = join(umbrellaDir, 'Sources', 'AglynPluginManifestBuild')
    mkdirSync(source, { recursive: true })
    writeFileSync(
      join(source, 'Build.swift'),
      '// Compiles the generated plugin manifest in the same graph as the tests.\nimport AglynPluginManifest\n',
    )
  }
  // The versions the app ships: the umbrella's graph is the app's packages.
  if (existsSync(join(repoRoot, APP_RESOLVED))) copyFileSync(join(repoRoot, APP_RESOLVED), join(umbrellaDir, 'Package.resolved'))
  // Rewritten every run, so stamped like the checkout: a cached build must not
  // see the umbrella's own files as new each time.
  const stamp = (path) => {
    lutimesSync(path, DIRECTORY_MTIME, DIRECTORY_MTIME)
    if (!lstatSync(path).isDirectory()) return
    for (const entry of readdirSync(path)) stamp(join(path, entry))
    lutimesSync(path, DIRECTORY_MTIME, DIRECTORY_MTIME)
  }
  stamp(umbrellaDir)
}

function run() {
  const umbrellaDir = resolve(option('--umbrella') ?? join(repoRoot, '..', 'swift-tests-umbrella'))
  const scratch = resolve(option('--scratch') ?? join(repoRoot, '..', 'spm-scratch'))
  const buildSystem = option('--build-system') ?? 'swiftbuild'
  const common = ['--scratch-path', scratch, '--build-system', buildSystem]

  // The umbrella is regenerated every run; the scratch path is what is cached.
  rmSync(umbrellaDir, { recursive: true, force: true })
  mkdirSync(umbrellaDir, { recursive: true })
  const plan = planUmbrella(discover(umbrellaDir))
  console.log(`umbrella: ${plan.umbrella.map((pkg) => pkg.dir).join(', ') || 'none'}`)
  for (const pkg of plan.standalone) annotate('notice', `${pkg.dir} is tested on its own: ${pkg.why}`)
  writeUmbrella(plan, umbrellaDir)
  if (rest.includes('--plan')) {
    console.log(readFileSync(join(umbrellaDir, 'Package.swift'), 'utf8'))
    return 0
  }

  const failed = []
  let standalone = plan.standalone.map((pkg) => pkg.dir)
  if (plan.umbrella.length) {
    const resolved = group('swift package resolve (umbrella)', () =>
      swift(['package', 'resolve', '--package-path', umbrellaDir, '--scratch-path', scratch]),
    )
    if (!resolved) {
      // Something about the umbrella itself; the packages are tested the old way.
      annotate('warning', 'the umbrella package did not resolve; testing every package on its own')
      standalone = [...plan.umbrella.map((pkg) => pkg.dir), ...standalone]
    } else if (
      !group('swift build --build-tests (every test target and the plugin manifest, once)', () =>
        swift(['build', '--build-tests', '--disable-index-store', '--package-path', umbrellaDir, ...common]),
      )
    ) {
      annotate('error', 'swift build failed: see the compiler errors above')
      failed.push('umbrella build')
    } else {
      // Each test target is its own bundle and process under Swift Build.
      const ok = group('swift test (every test target, each in its own process)', () =>
        swift(['test', '--skip-build', '--package-path', umbrellaDir, ...common]),
      )
      if (!ok) {
        annotate('error', 'swift test failed: the failing test targets are listed at the end of the log above')
        failed.push('umbrella tests')
      }
    }
  }
  for (const dir of standalone) {
    const ok = group(`swift test ${dir} (on its own)`, () =>
      swift([
        'test',
        '--package-path',
        dir,
        '--disable-index-store',
        '--scratch-path',
        `${scratch}-standalone`,
        '--build-system',
        buildSystem,
      ]),
    )
    if (!ok) {
      annotate('error', `swift test failed in ${dir}`)
      failed.push(dir)
    }
  }
  if (failed.length) {
    console.log(`failed: ${failed.join(' ')}`)
    return 1
  }
  return 0
}

if (command === 'mtimes') {
  stampMtimes()
} else if (command === 'run') {
  process.exitCode = run()
} else {
  console.error('usage: native-swift-tests.mjs mtimes | run --umbrella <dir> --scratch <dir> [--build-system <name>] [--plan]')
  process.exitCode = 2
}
