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
 * One SwiftPM build for every Swift test in the repository (AGL-3783).
 *
 * `native swift` used to run `swift test` once per package: AglynKit and each
 * plugin's src/ios package. A shared scratch path did not make that cheap,
 * because each package is a different ROOT, and a different root rebuilds the
 * Swift modules of everything below it: AglynKit's and Firebase's modules were
 * compiled eighteen times a run (19 of the job's 28 minutes, run 38499701315).
 *
 * So CI writes an umbrella package outside the checkout whose test targets ARE
 * the repository's test targets, depending on the same products through the
 * same packages, plus the generated plugin manifest so it is compiled in the
 * same graph. One build, one `swift test`. Under the Swift Build engine every
 * test target is its own bundle run in its own process, exactly as when each
 * package was tested alone.
 *
 * The umbrella reaches the sources through one link to the checkout
 * (`repo/`), and each test target's path runs through it. Tests find their
 * fixtures from `#filePath` (`../../../contracts`), and a path under `repo/`
 * climbs to the same place the real one does.
 *
 * Only the plain shape is translated: a test target with `name:` and string
 * `dependencies:` naming its own package's library products. Anything else
 * (settings, resources, a custom path, a product of another package, swift
 * tools 6 language mode) keeps its package OUT of the umbrella, and that
 * package is tested on its own the old way. Never a guess.
 */

/** The `// swift-tools-version:` of a manifest, as [major, minor]. */
export function toolsVersion(manifest) {
  const match = /^\/\/ swift-tools-version:\s*(\d+)\.(\d+)/m.exec(manifest)
  return match ? [Number(match[1]), Number(match[2])] : undefined
}

/** The `name:` given to `Package(...)`. */
export function packageName(manifest) {
  return /\bPackage\s*\(\s*name:\s*"([^"]+)"/.exec(manifest)?.[1]
}

/** Library product names, in declaration order. */
export function libraryProducts(manifest) {
  return [...manifest.matchAll(/\.library\(\s*name:\s*"([^"]+)"/g)].map((match) => match[1])
}

/** The highest `.iOS(.vN)` / `.macOS(.vN)` the manifest declares, per platform. */
export function platforms(manifest) {
  const out = {}
  for (const match of manifest.matchAll(/\.(iOS|macOS)\(\.v(\d+)(?:_(\d+))?\)/g)) {
    const version = [Number(match[2]), Number(match[3] ?? 0)]
    const prior = out[match[1]]
    if (!prior || compareVersions(version, prior) > 0) out[match[1]] = version
  }
  return out
}

function compareVersions(a, b) {
  return a[0] - b[0] || a[1] - b[1]
}

/** The text of a call starting at `open` (the index of its `(`), parentheses balanced. */
function callBody(text, open) {
  let depth = 0
  let quoted = false
  for (let at = open; at < text.length; at++) {
    const char = text[at]
    if (quoted) {
      if (char === '\\') at++
      else if (char === '"') quoted = false
    } else if (char === '"') quoted = true
    else if (char === '(' || char === '[') depth++
    else if (char === ')' || char === ']') {
      depth--
      if (depth === 0) return text.slice(open + 1, at)
    }
  }
  return undefined
}

/**
 * Each `.testTarget(...)` of a manifest, translated when it has the plain
 * shape, or with `unsupported` saying why not.
 *
 * @returns {{ name?: string, dependencies?: string[], unsupported?: string }[]}
 */
export function testTargets(manifest) {
  const out = []
  for (const match of manifest.matchAll(/\.testTarget\s*\(/g)) {
    const body = callBody(manifest, match.index + match[0].length - 1)
    if (body === undefined) {
      out.push({ unsupported: 'unbalanced .testTarget(' })
      continue
    }
    const plain = /^\s*name:\s*"([^"]+)"\s*(?:,\s*dependencies:\s*\[([^\]]*)\]\s*)?,?\s*$/.exec(body)
    if (!plain) {
      out.push({ name: /name:\s*"([^"]+)"/.exec(body)?.[1], unsupported: 'test target is not name + string dependencies' })
      continue
    }
    const list = plain[2] ?? ''
    const dependencies = [...list.matchAll(/"([^"]+)"/g)].map((dep) => dep[1])
    const leftover = list.replace(/"[^"]*"/g, '').replace(/[\s,]/g, '')
    out.push(
      leftover
        ? { name: plain[1], unsupported: 'a dependency that is not a plain string' }
        : { name: plain[1], dependencies },
    )
  }
  return out
}

/**
 * Decide what goes in the umbrella.
 *
 * @param {{
 *   dir: string,
 *   manifest: string,
 *   reach: string,
 *   testDirs: string[],
 * }[]} packages each package with Tests: its repo-relative `dir`, its
 *   manifest text, the absolute path the umbrella reaches it through (whose
 *   last component is its package identity), and the `Tests/` folders git
 *   tracks
 * @returns {{
 *   umbrella: { dir: string, identity: string, reach: string, tests: { name: string, products: string[] }[] }[],
 *   standalone: { dir: string, why: string }[],
 *   platforms: Record<string, [number, number]>,
 * }}
 */
export function planUmbrella(packages) {
  const umbrella = []
  const standalone = []
  const seen = new Set()
  const merged = {}
  for (const pkg of packages) {
    const why = refusal(pkg, seen)
    if (typeof why === 'string') {
      standalone.push({ dir: pkg.dir, why })
      continue
    }
    for (const test of why.tests) seen.add(test.name)
    umbrella.push({ dir: pkg.dir, identity: pkg.reach.split('/').pop(), reach: pkg.reach, tests: why.tests })
    for (const [platform, version] of Object.entries(platforms(pkg.manifest))) {
      if (!merged[platform] || compareVersions(version, merged[platform]) > 0) merged[platform] = version
    }
  }
  return { umbrella, standalone, platforms: merged }
}

/** Why a package cannot join the umbrella, or its translated test targets. */
function refusal(pkg, seen) {
  const tools = toolsVersion(pkg.manifest)
  if (!tools) return 'no swift-tools-version'
  if (tools[0] >= 6) return `swift-tools-version ${tools.join('.')} (its language mode is not the umbrella's)`
  const products = new Set(libraryProducts(pkg.manifest))
  const declared = testTargets(pkg.manifest)
  if (declared.length === 0) return 'no test target'
  const tests = []
  for (const target of declared) {
    if (target.unsupported) return `${target.name ?? 'a test target'}: ${target.unsupported}`
    if (seen.has(target.name)) return `${target.name}: another package has a test target of that name`
    if (!pkg.testDirs.includes(target.name)) return `${target.name}: no Tests/${target.name} folder`
    const missing = target.dependencies.filter((dep) => !products.has(dep))
    if (missing.length) return `${target.name}: depends on ${missing.join(', ')}, which is not a library product`
    tests.push({ name: target.name, products: target.dependencies })
  }
  const stray = pkg.testDirs.filter((dir) => !tests.some((test) => test.name === dir))
  if (stray.length) return `Tests/${stray[0]} is not a declared test target`
  return { tests }
}

const PLATFORM_ORDER = ['iOS', 'macOS']

/**
 * The umbrella's Package.swift.
 *
 * @param {ReturnType<typeof planUmbrella>} plan
 * @param {{ manifestPackage?: { reach: string, product: string } }} [extra]
 *   the generated plugin manifest package, compiled in the same graph
 */
export function renderUmbrella(plan, { manifestPackage, repoLink = 'repo' } = {}) {
  const tools = '5.10'
  const lines = [
    `// swift-tools-version: ${tools}`,
    '// GENERATED by tools/scripts/native-swift-tests.mjs for CI (AGL-3783). Not committed:',
    "// every plain Swift test target in the repository, in one build graph.",
    '',
    'import PackageDescription',
    '',
    'let package = Package(',
    '  name: "AglynSwiftTests",',
  ]
  const declared = PLATFORM_ORDER.filter((platform) => plan.platforms[platform])
  if (declared.length) {
    const versions = declared.map((platform) => {
      const [major, minor] = plan.platforms[platform]
      return `.${platform}(.v${major}${minor ? `_${minor}` : ''})`
    })
    lines.push(`  platforms: [${versions.join(', ')}],`)
  }
  lines.push('  dependencies: [')
  for (const pkg of plan.umbrella) lines.push(`    .package(path: ${JSON.stringify(pkg.reach)}),`)
  if (manifestPackage) lines.push(`    .package(path: ${JSON.stringify(manifestPackage.reach)}),`)
  lines.push('  ],', '  targets: [')
  if (manifestPackage) {
    const identity = manifestPackage.reach.split('/').pop()
    lines.push(
      '    .target(',
      '      name: "AglynPluginManifestBuild",',
      `      dependencies: [.product(name: ${JSON.stringify(manifestPackage.product)}, package: ${JSON.stringify(identity)})]`,
      '    ),',
    )
  }
  for (const pkg of plan.umbrella) {
    for (const test of pkg.tests) {
      const deps = test.products.map(
        (product) => `.product(name: ${JSON.stringify(product)}, package: ${JSON.stringify(pkg.identity)})`,
      )
      const path = `${repoLink}/${pkg.dir}/Tests/${test.name}`
      lines.push(
        `    .testTarget(name: ${JSON.stringify(test.name)}, dependencies: [${deps.join(', ')}], path: ${JSON.stringify(path)}),`,
      )
    }
  }
  lines.push('  ]', ')', '')
  return lines.join('\n')
}

/**
 * A content-addressed modification time for a tracked file (AGL-3783).
 *
 * A fresh checkout stamps every file with the time of the checkout, so a build
 * restored from the cache sees every source as changed and rebuilds it all.
 * Stamping each file from its git blob id instead gives the same content the
 * same time in every run, and changed content a different one, which is what
 * the build systems' change detection compares (alongside size). 2^29 seconds
 * from 1980 keeps every stamp in the past (before 1997).
 *
 * @param {string} oid the blob's object id (hex)
 * @returns {number} seconds since the epoch
 */
export function contentMtime(oid) {
  const BASE = 315532800 // 1980-01-01T00:00:00Z
  return BASE + (Number.parseInt(oid.slice(0, 8), 16) % 2 ** 29)
}

/** Directories get one fixed stamp: their listing, not their time, is what changes. */
export const DIRECTORY_MTIME = 315532800
