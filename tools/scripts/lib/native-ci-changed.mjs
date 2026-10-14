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
 * (AGL-3704). `.github/workflows/native-tests.yml` always reports both checks,
 * because required checks must; this decides whether a run does the work or
 * passes in seconds.
 *
 * A path is native-relevant when it is native source, a generator or list that
 * writes native source, or a TypeScript module one of those lists reads (the
 * contracts and pure-module lists name them, and a change to one of them can
 * change what the generated Swift and Kotlin must say).
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
  /^tools\/scripts\/native-ci-changed\.mjs$/,
  /^plugins\.config\.json$/,
  /^\.github\/workflows\/native-tests\.yml$/,
]

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
