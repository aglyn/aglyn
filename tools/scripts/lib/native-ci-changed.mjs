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
 * Which changed paths make the native Kotlin and Swift tests worth running
 * (AGL-3704), and which of the two each one needs (AGL-3783).
 * `.github/workflows/native-tests.yml` always reports both checks, because
 * required checks must; this decides whether a run does the work or passes in
 * seconds, and so whether `native swift` needs a macOS runner at all.
 *
 * A path is native-relevant when it is native source, a generator or list that
 * writes native source, or a TypeScript module one of those lists reads (the
 * contracts and pure-module lists name them, and a change to one of them can
 * change what the generated Swift and Kotlin must say).
 *
 * A relevant path needs BOTH sides unless it is in one side's own tree and the
 * other side cannot reach it: screen specs are read by both renderers wherever
 * they sit, and a file the other side links to is the other side's input too.
 */

/** Native source, generators and the files that drive them. */
export const NATIVE_PATH_PATTERNS = [
  /^apps\/android\//,
  /^apps\/ios\//,
  /^libs\/native\//,
  /^libs\/plugins\/[^/]+\/src\/(android|ios)\//,
  /^tools\/scripts\/native-[^/]*\.json$/,
  /^tools\/scripts\/mobile-pure-modules\.json$/,
  /^tools\/scripts\/lib\/(native|mobile)-[^/]*\.mjs$/,
  /^tools\/scripts\/generate-(native|mobile)-[^/]*\.mjs$/,
  /^tools\/scripts\/generate-plugin-manifests\.mjs$/,
  /^tools\/scripts\/native-(ci-changed|swift-tests)\.mjs$/,
  /^plugins\.config\.json$/,
  /^\.github\/workflows\/native-tests\.yml$/,
]

/** Trees only the Swift side builds: the Apple apps, AglynKit, plugin Apple packages. */
export const SWIFT_ONLY_PATTERNS = [/^apps\/ios\//, /^libs\/native\/apple\//, /^libs\/plugins\/[^/]+\/src\/ios\//]

/** Trees only the Kotlin side builds: the Android apps, the Kotlin libs, plugin Android modules. */
export const KOTLIN_ONLY_PATTERNS = [
  /^apps\/android\//,
  /^libs\/native\/kotlin\//,
  /^libs\/plugins\/[^/]+\/src\/android\//,
]

/**
 * Read by both sides whichever tree holds them. A plugin's screen spec lives
 * in its Apple package and its Android module links to it, and AglynKit's
 * ScreenSpecTests walks every plugin's src/android/screens.
 */
export const SHARED_PATTERNS = [/(^|\/)screens\//, /\.screens\.json$/]

/**
 * The workspace modules the native lists name: `native-contracts.json`'s
 * `modules` keys and `mobile-pure-modules.json`'s `modules[].path`.
 *
 * @param {{ contracts?: unknown, pureModules?: unknown }} lists parsed JSON
 * @returns {Set<string>}
 */
export function listedModules({ contracts, pureModules } = {}) {
  const out = new Set()
  const contractModules = contracts && typeof contracts === 'object' ? contracts.modules : undefined
  if (contractModules && typeof contractModules === 'object') {
    for (const path of Object.keys(contractModules)) out.add(path)
  }
  const pure = pureModules && typeof pureModules === 'object' ? pureModules.modules : undefined
  if (Array.isArray(pure)) {
    for (const entry of pure) {
      if (typeof entry === 'string') out.add(entry)
      else if (entry && typeof entry.path === 'string') out.add(entry.path)
    }
  }
  return out
}

/**
 * @param {string[]} changed repo-relative paths
 * @param {Set<string>} modules from {@link listedModules}
 * @returns {string[]} the changed paths that are native-relevant, in input order
 */
export function nativeRelevantPaths(changed, modules = new Set()) {
  return changed.filter(
    (path) => modules.has(path) || NATIVE_PATH_PATTERNS.some((pattern) => pattern.test(path)),
  )
}

const BOTH = Object.freeze({ kotlin: true, swift: true })

/**
 * Which side or sides one native-relevant path needs.
 *
 * @param {string} path repo-relative
 * @param {{ path: string, target: string }[]} links the tracked symlinks,
 *   each with its repo-relative resolved target
 * @returns {{ kotlin: boolean, swift: boolean }}
 */
export function platformsOf(path, links = []) {
  if (SHARED_PATTERNS.some((pattern) => pattern.test(path))) return BOTH
  const swift = SWIFT_ONLY_PATTERNS.some((pattern) => pattern.test(path))
  const kotlin = KOTLIN_ONLY_PATTERNS.some((pattern) => pattern.test(path))
  if (swift === kotlin) return BOTH
  // A link in the other side's tree that resolves to this path (or a folder
  // holding it) makes it that side's input as well.
  const other = swift ? KOTLIN_ONLY_PATTERNS : SWIFT_ONLY_PATTERNS
  const reached = links.some(
    (link) =>
      other.some((pattern) => pattern.test(link.path)) &&
      (path === link.target || path.startsWith(`${link.target}/`)),
  )
  return reached ? BOTH : { kotlin, swift }
}

/**
 * The relevant paths split by the side that needs them. A path both need is
 * in both lists.
 *
 * @param {string[]} changed repo-relative paths
 * @param {Set<string>} modules from {@link listedModules}
 * @param {{ path: string, target: string }[]} links see {@link platformsOf}
 * @returns {{ kotlin: string[], swift: string[] }}
 */
export function nativePathsByPlatform(changed, modules = new Set(), links = []) {
  const out = { kotlin: [], swift: [] }
  for (const path of nativeRelevantPaths(changed, modules)) {
    const sides = platformsOf(path, links)
    if (sides.kotlin) out.kotlin.push(path)
    if (sides.swift) out.swift.push(path)
  }
  return out
}

const ZERO_SHA = /^0+$/

/**
 * Whether a base can be diffed against at all: a push that creates a branch
 * reports `before` as forty zeros, and a missing input is an empty string.
 * Either way what changed is unknown, and the answer to that is to run.
 *
 * @param {string | undefined} base
 */
export function usableBase(base) {
  return typeof base === 'string' && /^[0-9a-f]{7,64}$/i.test(base) && !ZERO_SHA.test(base)
}
