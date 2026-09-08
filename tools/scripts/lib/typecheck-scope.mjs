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
 * When `--changed` is not a safe scope, and how it knows (AGL-2682).
 *
 * `--changed` resolves changed FILES to their owning project's tsconfigs. That
 * is exactly right for the failure it was built for — a spec compiled by
 * nothing — and exactly wrong for one shape:
 *
 *     export * from './lib/use-debounce'      ← delete this line
 *
 * Two imports in `apps/console/components/media/` stopped resolving.
 * `typecheck:changed` reported **9/9 configs clean**, because the console's
 * files did not change; only the barrel's did. The full run caught both. The
 * check was not broken, it was answering about the wrong files.
 *
 * A barrel is the one file whose blast radius is unbounded: every project that
 * imports the package by name reads it, and none of them shows up in a diff.
 * So a changed barrel widens the scope to the whole workspace.
 *
 * ## Why the barrel list is DERIVED, not a glob
 *
 * `**\/src/index.ts` would be a guess that drifts. A barrel is precisely a file
 * some other project can import BY PACKAGE NAME, and `tsconfig.base.json`'s
 * `paths` is the authority on which files those are — it is what makes
 * `@aglyn/shared-util-vendor` resolve at all. Reading it means a new library
 * is covered the day its mapping lands, and a file that merely happens to be
 * called `index.ts` is not.
 *
 * Wildcard mappings are deliberately skipped. `"@aglyn/shared-util-vendor/*"`
 * points at a directory of individual modules; importing one is a normal file
 * dependency, and it is the ESCAPE HATCH this repo uses to take something off
 * a barrel without deleting it. Widening on those would make every deep-import
 * edit a whole-workspace run for no reason.
 */

/**
 * The barrel files, repo-relative with forward slashes, from a parsed
 * `tsconfig.base.json`.
 *
 * Tolerant of a missing or malformed `paths` — an empty list degrades to
 * today's behaviour (never widening), which is the safe direction for a
 * helper that can only ever make a check run MORE.
 */
export function barrelEntryPoints(baseTsconfig) {
  const paths = baseTsconfig?.compilerOptions?.paths
  if (!paths || typeof paths !== 'object') return []
  const found = new Set()
  for (const [specifier, targets] of Object.entries(paths)) {
    if (specifier.includes('*')) continue
    if (!Array.isArray(targets)) continue
    for (const target of targets) {
      if (typeof target !== 'string') continue
      if (target.includes('*')) continue
      found.add(target.replace(/^\.\//, ''))
    }
  }
  return [...found].sort()
}

/**
 * The changed files that force a whole-workspace run, or an empty array.
 *
 * Returns the FILES rather than a boolean so the caller can name them. A
 * scope that silently grew from 9 configs to 145 reads as a hang; one that
 * says which barrel did it reads as a reason.
 */
export function barrelsAmong(files, barrels) {
  const set = new Set(barrels)
  return files.filter((file) => set.has(file.replace(/^\.\//, '')))
}
