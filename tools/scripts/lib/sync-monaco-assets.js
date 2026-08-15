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
 * Vendor Monaco's `min/vs` into an app's `public/` at build time (AGL-1779).
 *
 * `@monaco-editor/loader` ships ONE default and no fallback:
 *
 *   config = { paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs' } }
 *
 * and `init()` injects `<script src="${paths.vs}/loader.js">` into
 * `document.body` with no `integrity` and no `crossOrigin`. Until this
 * landed, opening the besigner's Edit -> Raw JSON executed an unpinned,
 * un-SRI'd third-party script inside the `app.aglyn.com` origin — with the
 * session cookie, the DOM and every live Firestore listener in scope — for
 * any org member with edit rights, site collaborators included. The console
 * CSP could not stop it: `script-src` carries a bare `https:`
 * (`apps/console/middleware.ts`), deliberately, because `strict-dynamic`
 * took violations from 1 to 70.
 *
 * The fix is to serve the same bytes from our own origin, which brings the
 * load under `'self'` and removes the supply chain entirely.
 *
 * WHY THIS IS A COPY AND NOT A CHECKED-IN DIRECTORY
 *
 * `min/vs` is ~15 MB across 121 files. Committed, it would rot silently
 * against the `monaco-editor` version in `package.json` — nothing would ever
 * tell us the two had diverged. Copied from `node_modules` at build time,
 * the package version is the single source of truth by construction.
 *
 * WHY IT CANNOT FAIL QUIETLY
 *
 * The dangerous shape for a build-time copy is "the step silently doesn't
 * run on the host, so the editor works locally and 404s in production". Two
 * things prevent that here:
 *
 *  1. The call site is `apps/console/next.config.js`, evaluated as the FIRST
 *     step of every `next build` and `next dev` however they are invoked —
 *     `nx build console`, a bare `next build`, or whatever command Vercel's
 *     dashboard runs for the `aglyn-console` project (root directory `.`,
 *     so the command is not in this repo and cannot be relied on).
 *  2. This function THROWS rather than returning a failure. A missing
 *     `monaco-editor`, a short copy, or an empty required file aborts the
 *     build. There is deliberately no CDN fallback: a fallback would restore
 *     the exact exposure this closes, and would be invisible because the
 *     local path normally wins.
 *
 * Re-running is cheap: a stamp file records the version and the file count,
 * and a match short-circuits before any directory walk.
 */

// MARK – IMPORTS
const fs = require('fs')
const path = require('path')

// MARK – GLOBALS

/**
 * Files the AMD loader fetches by name, so a truncated copy is caught here
 * rather than as a 404 in a customer's editor.
 *
 * `@monaco-editor/loader` requests `${vs}/loader.js`, then hands
 * `require.config({ paths: { vs } })` to it and asks for
 * `vs/editor/editor.main` — which pulls `editor.main.js` and its stylesheet.
 * `assets/` holds the language web workers that `editor.main` spawns.
 */
const REQUIRED_ENTRIES = [
  'loader.js',
  'editor/editor.main.js',
  'editor/editor.main.css',
]

/** Directories that must exist and be non-empty after the copy. */
const REQUIRED_DIRECTORIES = ['assets', 'editor', 'language', 'basic-languages']

/** Name of the stamp written beside `vs/`, used to skip an unchanged copy. */
const STAMP_FILE = '.monaco-sync.json'

// MARK – HELPERS

/** Recursively count the files under `dir`. */
function countFiles(dir) {
  let total = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    total += entry.isDirectory() ? countFiles(path.join(dir, entry.name)) : 1
  }
  return total
}

/**
 * Assert the copy at `vsDir` is one Monaco can actually boot from.
 *
 * Checked AFTER the copy, not instead of it: `fs.cpSync` reporting no error
 * is not evidence that the tree it produced is loadable.
 */
function assertUsable(vsDir, sourceFileCount) {
  for (const entry of REQUIRED_ENTRIES) {
    const file = path.join(vsDir, entry)
    let size
    try {
      size = fs.statSync(file).size
    } catch {
      throw new Error(
        `[monaco] vendored copy is missing ${entry} at ${file}. ` +
          `Delete ${vsDir} and rebuild.`,
      )
    }
    if (!size) {
      throw new Error(`[monaco] vendored ${entry} is empty at ${file}.`)
    }
  }

  for (const dir of REQUIRED_DIRECTORIES) {
    const target = path.join(vsDir, dir)
    if (!fs.existsSync(target) || !fs.readdirSync(target).length) {
      throw new Error(
        `[monaco] vendored copy is missing or empty directory ${dir}/ at ${target}.`,
      )
    }
  }

  const copied = countFiles(vsDir)
  if (copied !== sourceFileCount) {
    throw new Error(
      `[monaco] vendored copy is short: ${copied} files at ${vsDir}, ` +
        `expected ${sourceFileCount} from node_modules/monaco-editor/min/vs.`,
    )
  }
}

// MARK – MAIN

/**
 * Copy `monaco-editor/min/vs` into `<publicDir>/monaco/vs`.
 *
 * @param {Object} options
 * @param {string} options.publicDir Absolute path to the app's `public/`.
 * @returns {{ version: string, files: number, skipped: boolean }}
 * @throws when the copy cannot be produced or is not loadable. Callers must
 *   NOT catch this: the alternative to a local copy is the jsDelivr default.
 */
function syncMonacoAssets({ publicDir }) {
  let monacoPackageJson
  try {
    monacoPackageJson = require.resolve('monaco-editor/package.json')
  } catch {
    throw new Error(
      '[monaco] `monaco-editor` is not installed, so the Raw JSON editor ' +
        "would fall back to `@monaco-editor/loader`'s jsDelivr default and " +
        'run third-party script in this origin (AGL-1779). Run `npm ci`.',
    )
  }

  const { version } = require(monacoPackageJson)
  const sourceDir = path.join(path.dirname(monacoPackageJson), 'min', 'vs')
  if (!fs.existsSync(sourceDir)) {
    throw new Error(
      `[monaco] monaco-editor@${version} has no min/vs at ${sourceDir}.`,
    )
  }
  const sourceFileCount = countFiles(sourceDir)

  const destRoot = path.join(publicDir, 'monaco')
  const vsDir = path.join(destRoot, 'vs')
  const stampPath = path.join(destRoot, STAMP_FILE)

  let stamp = null
  try {
    stamp = JSON.parse(fs.readFileSync(stampPath, 'utf8'))
  } catch {
    /* no stamp, or an unreadable one — treat as a cold copy */
  }

  if (stamp && stamp.version === version && stamp.files === sourceFileCount) {
    // Still verify. A stamp proves what was written once, not what is on
    // disk now — a pruned or half-deleted `public/` must not read as fresh.
    assertUsable(vsDir, sourceFileCount)
    return { version, files: sourceFileCount, skipped: true }
  }

  fs.rmSync(destRoot, { recursive: true, force: true })
  fs.mkdirSync(destRoot, { recursive: true })
  fs.cpSync(sourceDir, vsDir, { recursive: true })

  assertUsable(vsDir, sourceFileCount)

  fs.writeFileSync(
    stampPath,
    `${JSON.stringify({ version, files: sourceFileCount }, null, 2)}\n`,
  )

  return { version, files: sourceFileCount, skipped: false }
}

module.exports = { syncMonacoAssets, STAMP_FILE }
