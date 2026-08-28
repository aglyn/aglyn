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
 * Where the shared drive holding the Platform Docs is mounted, if anywhere.
 *
 * Several checks cross-reference a repo file against its counterpart on the
 * shared drive — the Pricing Source of Truth, the Pricing Decision Log, the
 * launch runbook, the GTM docs, the legal originals, the generated feature
 * matrix. That drive is a per-workstation mount: its path depends on the
 * operating system, the sync client, and which account the client is signed in
 * as. It is not a property of the repository, so it cannot be a literal in one.
 *
 * ## Why unset is a skip and never a failure
 *
 * CI has no Drive mount and never will — the checks that use this are gates on
 * the repo half of a cross-reference, and the Drive half is a bonus leg that
 * runs only where the bytes are reachable. A missing mount that failed the run
 * would make every one of those checks red everywhere except one laptop, which
 * is the fastest way to get a gate deleted. So an unset variable yields `null`,
 * every caller branches on it, and each prints a note saying the leg was
 * skipped rather than passing silently.
 *
 * A configured path that does not exist is treated the same way, by the same
 * `existsSync` the callers already run: a stale path is a mount that is not
 * there, and there is nothing useful to say about it that "not mounted" does
 * not already say.
 *
 * ## Pointing it at the right directory
 *
 * The value is the directory that directly contains the shared drives' folders
 * — `Platform Docs` and its siblings — not the account root above them and not
 * a single drive inside them. On a macOS Google Drive client that is
 *
 *   ~/Library/CloudStorage/GoogleDrive-<account>/Shared drives
 *
 * On Linux with rclone, or a Windows drive letter, it is wherever that client
 * puts the same folders. Nothing here assumes Google Drive; it assumes a
 * directory with `Platform Docs` inside it.
 */

import { join } from 'node:path'

/** The variable an operator or maintainer sets. */
export const DRIVE_MOUNT_ENV = 'AGLYN_DRIVE_MOUNT'

/**
 * The configured shared-drives root, or `null` when there is none.
 *
 * Whitespace-only is `null`, not an empty path: `AGLYN_DRIVE_MOUNT=` in a
 * shell profile is someone unsetting it, and resolving that to the process's
 * working directory would point a cross-check at whatever happened to be
 * there.
 */
export function driveMount(env = process.env) {
  const raw = env[DRIVE_MOUNT_ENV]
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  // Trailing separators only; `/` itself keeps its single slash.
  return trimmed.length > 1 ? trimmed.replace(/[/\\]+$/, '') || trimmed[0] : trimmed
}

/**
 * A path inside the shared drives, or `null` when no mount is configured.
 *
 * Returning `null` rather than throwing is what lets a caller write the skip
 * as a plain falsy check instead of a try/catch, and what keeps the "no mount"
 * path identical to the "mount is empty" path it already handles.
 */
export function driveDocPath(...segments) {
  const root = driveMount()
  if (!root) return null
  return join(root, ...segments.map(String))
}

/** What a check prints when it skips its Drive leg. */
export function driveMountSkipNote(what) {
  return (
    `note: ${what} is not mounted; skipping that leg. `
    + `It is not a gate — CI has no shared drive. `
    + `Set ${DRIVE_MOUNT_ENV} to the directory containing "Platform Docs" to run it.`
  )
}
