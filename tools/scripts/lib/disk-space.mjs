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
 * The free-disk preflight for the dev loop (AGL-1425).
 *
 * On 2026-08-11 the machine went to 1.8 GiB free of 460 GiB while work was in
 * flight, because `apps/console/.next/dev/cache/turbopack` had reached 110 GB
 * under a live dev server. What made it expensive was not the lost space, it
 * was the SHAPE of the failure: agents saw `ENOSPC` from unrelated tools, one
 * lost its shell entirely, and nobody was told "the disk is full" until the
 * diagnosis had already been paid for. Twice.
 *
 * So the decision is deliberately split in two. `evaluateFreeSpace` is a pure
 * function of a byte count and is therefore testable; `readFreeBytes` is the
 * one line that touches the filesystem and is not. The interesting failure
 * modes all live in the pure half.
 *
 * Two rules encode what the incident taught:
 *
 *   1. An UNREADABLE measurement never blocks. A dev loop that refuses to
 *      start because `statfs` failed is a worse bug than the one being
 *      prevented, and this check has no way to know it is right.
 *   2. Below the critical mark it DOES block, which is the opposite of the
 *      surrounding clean-next policy of never failing the serve target. That
 *      is intentional and it is a different condition: a cache that could not
 *      be pruned is an annoyance, whereas starting a Turbopack dev server with
 *      8 GiB of headroom reliably produces the exact baffling ENOSPC cascade
 *      this issue exists to stop. Failing here costs one clear message.
 */

import { statfsSync } from 'node:fs'

const BYTES_PER_GIB = 1024 * 1024 * 1024

/**
 * Defaults sized against the actual incident, not against round numbers.
 *
 * A console dev cache runs 2-3 GB steady-state and has twice gone past 50 GB
 * inside a single long session, so `warn` needs to leave room for one more
 * runaway to be noticed before it bites: 30 GiB is roughly "you would survive
 * another bad session". `critical` at 10 GiB is below any healthy working
 * state on this repo and above the point where tooling starts failing in ways
 * that do not name the disk.
 */
export const DEFAULT_FREE_SPACE_THRESHOLDS = Object.freeze({
  criticalGib: 10,
  warnGib: 30,
})

export const gib = (bytes) => bytes / BYTES_PER_GIB

export const formatGib = (bytes) => `${gib(bytes).toFixed(1)} GiB`

/**
 * Coerce one threshold, falling back when it is absent or nonsense.
 *
 * Thresholds arrive from `--flag=` strings and environment variables, so
 * `undefined`, `''` and `'abc'` are all routine rather than exceptional.
 * `Number('')` is 0, which would silently disable the check, so empty string
 * has to be rejected before the numeric conversion rather than after it.
 */
function coerceThreshold(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return parsed
}

/**
 * Normalise a threshold pair, including the inverted case.
 *
 * Someone raising `critical` past `warn` means "block me earlier", not "warn
 * me after blocking me" — an inverted pair that reported `warn` first would
 * make the louder signal unreachable. Clamping `warn` up to `critical` keeps
 * warn >= critical as an invariant the rest of the function can rely on.
 */
export function normaliseThresholds(thresholds = {}) {
  const criticalGib = coerceThreshold(
    thresholds.criticalGib,
    DEFAULT_FREE_SPACE_THRESHOLDS.criticalGib,
  )
  const warnGib = coerceThreshold(
    thresholds.warnGib,
    DEFAULT_FREE_SPACE_THRESHOLDS.warnGib,
  )
  return { criticalGib, warnGib: Math.max(warnGib, criticalGib) }
}

/**
 * Decide whether there is enough disk to start a dev server.
 *
 * Returns a verdict rather than printing or throwing, so the caller owns
 * presentation and the test owns the decision. `blocking` is the only field
 * callers must honour; `level` exists for the wording.
 *
 * @param {object} input
 * @param {number|null|undefined} input.freeBytes Bytes available, or null if
 *   the measurement failed. Anything non-finite reads as "unknown".
 * @param {{criticalGib?: number, warnGib?: number}} [input.thresholds]
 * @param {boolean} [input.disabled] Escape hatch, for the person who knows
 *   what they are doing at 4 GiB free.
 * @returns {{level: 'ok'|'warn'|'critical'|'unknown'|'disabled',
 *   blocking: boolean, freeBytes: number|null, freeGib: number|null,
 *   criticalGib: number, warnGib: number}}
 */
export function evaluateFreeSpace({ freeBytes, thresholds, disabled } = {}) {
  const { criticalGib, warnGib } = normaliseThresholds(thresholds)
  const base = {
    blocking: false,
    freeBytes: null,
    freeGib: null,
    criticalGib,
    warnGib,
  }

  if (disabled) return { ...base, level: 'disabled' }

  // A negative or non-numeric reading is a broken measurement, not an empty
  // disk. Both resolve to "unknown", which never blocks — see rule 1 above.
  if (
    typeof freeBytes !== 'number' ||
    !Number.isFinite(freeBytes) ||
    freeBytes < 0
  ) {
    return { ...base, level: 'unknown' }
  }

  const freeGib = gib(freeBytes)
  const measured = { ...base, freeBytes, freeGib }

  // Boundaries are inclusive-ok on purpose: exactly at the threshold is the
  // threshold being met, and an off-by-one here would fire the blocking path
  // for a machine that is precisely as healthy as it was asked to be.
  if (freeGib < criticalGib)
    return { ...measured, level: 'critical', blocking: true }
  if (freeGib < warnGib) return { ...measured, level: 'warn' }
  return { ...measured, level: 'ok' }
}

/**
 * Human-readable lines for a verdict.
 *
 * The message is the entire point of the feature — the incident was expensive
 * because the failure never named the disk or the path. Both loud levels name
 * the exact directory and the exact command, so the reader does not have to
 * find this issue to act.
 */
export function describeFreeSpace(verdict) {
  const { level, freeBytes, criticalGib, warnGib } = verdict
  const free = freeBytes === null ? 'unknown' : formatGib(freeBytes)

  switch (level) {
    case 'disabled':
      return ['Disk preflight disabled (DEV_DISK_CHECK=off).']
    case 'unknown':
      return ['Disk preflight: could not read free space — continuing.']
    case 'ok':
      return [`Disk preflight: ${free} free (warn under ${warnGib} GiB).`]
    case 'warn':
      return [
        `WARNING: only ${free} free — under the ${warnGib} GiB dev-loop margin.`,
        'A long Turbopack session can add tens of GB to .next/dev/cache/turbopack.',
        'Stop dev servers and run: npm run clean:next:prune',
      ]
    case 'critical':
      return [
        `REFUSING TO START: only ${free} free, under the ${criticalGib} GiB floor.`,
        '',
        'A Turbopack dev server started here will fill the disk, and it will not',
        'fail as "out of disk" — it surfaces as ENOSPC from unrelated tools, or as',
        'a shell that simply stops working. That is AGL-1425, and it has happened',
        'twice.',
        '',
        'Reclaim space first. The usual culprit is regenerable by definition:',
        '  apps/<app>/.next/dev/cache/turbopack',
        '',
        'With every dev server stopped:',
        '  npm run clean:next          # report sizes, delete nothing',
        '  npm run clean:next:prune    # delete regardless of size',
        '',
        'Override once you have checked: DEV_DISK_CHECK=off, or raise',
        `DEV_DISK_MIN_FREE_GB above ${criticalGib}.`,
      ]
    default:
      return []
  }
}

/**
 * Free bytes on the volume holding `path`, or null when unreadable.
 *
 * `bavail` rather than `bfree`: the latter counts blocks reserved for root,
 * which a dev server cannot use, and reporting space nobody can spend is how
 * a disk check ends up passing on a full disk.
 *
 * Untested by design — this is the fs boundary. All decision logic that could
 * be wrong lives in `evaluateFreeSpace`.
 */
export function readFreeBytes(path) {
  try {
    const stats = statfsSync(path)
    return Number(stats.bavail) * Number(stats.bsize)
  } catch {
    // No volume, no permission, or a platform without statfs. The caller
    // treats null as "unknown", which never blocks.
    return null
  }
}
