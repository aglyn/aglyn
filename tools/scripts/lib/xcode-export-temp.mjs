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

// `xcodebuild -exportArchive` stages every export in an
// `XcodeDistPipeline.~~~XXXXXX` folder (~300 MB) in the user's temp folder and
// never removes it. native-release.mjs exports on every TestFlight upload, and
// by 2026-10-20 forty of those folders (~12 GB) had piled up.
//
// So an export runs inside withExportTempCleanup, which removes the staging
// folders that appeared while it ran and nothing else. A folder that was
// already there may belong to an Xcode Organizer export still in progress.
// native-release holds the shared xcodebuild lock around the export, so no
// other export from this repo can start one at the same time.
//
//   node --test tools/scripts/lib/xcode-export-temp.test.mjs

import { execFileSync } from 'node:child_process'
import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const STAGING_PREFIX = 'XcodeDistPipeline.'

/**
 * The temp folders xcodebuild may stage an export in: $TMPDIR and the per-user
 * temp folder macOS reports, which differ when a shell overrides TMPDIR.
 *
 * @returns {string[]}
 */
export function exportTempRoots() {
  const roots = new Set()
  if (process.env.TMPDIR) roots.add(process.env.TMPDIR)
  try {
    roots.add(
      execFileSync('getconf', ['DARWIN_USER_TEMP_DIR'], {
        encoding: 'utf8',
      }).trim(),
    )
  } catch {
    // Not macOS, so there is no Xcode export to clean up after.
  }
  return [...new Set([...roots].map((root) => root.replace(/\/+$/, '')))]
}

/**
 * The export staging folders under `roots`, by path. A root that cannot be
 * read contributes none.
 *
 * @param {string[]} roots
 * @returns {Set<string>}
 */
export function exportStagingFolders(roots) {
  const found = new Set()
  for (const root of roots) {
    let names
    try {
      names = readdirSync(root)
    } catch {
      continue
    }
    for (const name of names) {
      if (name.startsWith(STAGING_PREFIX)) found.add(join(root, name))
    }
  }
  return found
}

/**
 * Runs `work` (an `xcodebuild -exportArchive`), then removes the staging
 * folders that appeared while it ran, whether it succeeded or threw.
 *
 * @template T
 * @param {() => T} work
 * @param {string[]} [roots]
 * @returns {T}
 */
export function withExportTempCleanup(work, roots = exportTempRoots()) {
  const before = exportStagingFolders(roots)
  try {
    return work()
  } finally {
    for (const path of exportStagingFolders(roots)) {
      if (!before.has(path)) rmSync(path, { recursive: true, force: true })
    }
  }
}
