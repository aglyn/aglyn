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

import { restoreQuotaLimit } from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  usageMeterTone,
  type UsageMeterTone,
} from '@aglyn/shared-ui-jsx/components/usage-meter.component'
import { formatStorageMb } from '../../utils/usage-alert-notice'

/**
 * The media library's toolbar readout (AGL-3470): how many files, and how
 * much of the plan's storage they use.
 *
 * ## One band for the whole workspace
 *
 * Storage is not a per-library allowance. Since AGL-2075 every site's library
 * and the org's shared library count against ONE band,
 * `hostLimit × storagePerHostMb`, which is what ingress refuses at, what the
 * invoice subtracts and what the usage alerts warn on. So the cap on screen is
 * that band, and the only figure ever written "of" it is the pooled total.
 * The open library's own bytes are stated beside it, labelled as this
 * library's, whenever the two differ: one library's bytes written "of" the
 * whole band would read as free space that other libraries are already using.
 *
 * ## Where the numbers come from
 *
 * `/api/media/storage` answers with `resolveOrgMediaBand` — the band and the
 * pool the upload gate itself reads — plus this library's share of that same
 * read. The open library's counter is already live in the page, so the pool is
 * kept current as the other libraries as read, plus this one as it is now:
 * an upload moves the meter without another round trip.
 *
 * Nothing here knows a plan figure. The band arrives resolved, so a plan whose
 * storage changes needs no edit to this file or its spec.
 */

const KB = 1024
const MB = KB * 1024
const GB = MB * 1024

/** Bytes as the library prints them: `512 KB`, `4.0 MB`, `1.2 GB`. */
export function formatMediaBytes(bytes: number): string {
  const value = Math.max(0, Number(bytes) || 0)
  if (value >= GB) return `${(value / GB).toFixed(1)} GB`
  if (value >= MB) return `${(value / MB).toFixed(1)} MB`
  return `${value === 0 ? 0 : Math.max(1, Math.round(value / KB))} KB`
}

/** The org's storage band, as `/api/media/storage` reports it. */
export interface MediaStorageBand {
  /** The org-wide band in MB; `Infinity` when the plan caps nothing. */
  allowanceMb: number
  /** Every library the org owns, summed, at the moment of the read. */
  usedBytes: number
  /** The open library's share of `usedBytes`, from the same read. */
  scopeBytes: number
  /**
   * Whether an upload past the band is REFUSED rather than billed — an
   * unmetered plan, or a library whose storage does not reach the invoice
   * yet. The same arm `mediaStorageGate` refuses on.
   */
  hardBand: boolean
}

const finiteBytes = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null

/**
 * The route's answer, or `null` for anything that is not one.
 *
 * `null` is "say nothing about a cap", which is the only safe reading of a
 * failed or malformed answer: a band guessed from a partial payload could tell
 * a paying workspace it is on Free's.
 */
export function parseMediaStorageBand(payload: unknown): MediaStorageBand | null {
  if (!payload || typeof payload !== 'object') return null
  const raw = payload as Record<string, unknown>
  const usedBytes = finiteBytes(raw['usedBytes'])
  const scopeBytes = finiteBytes(raw['scopeBytes'])
  if (usedBytes === null || scopeBytes === null) return null
  const unlimited = raw['unlimited'] === true
  const allowance = raw['allowanceMb']
  if (!unlimited && (typeof allowance !== 'number' || !(allowance > 0))) {
    return null
  }
  return {
    allowanceMb: restoreQuotaLimit(
      typeof allowance === 'number' ? allowance : null,
      unlimited,
    ),
    usedBytes,
    scopeBytes,
    hardBand: raw['hardBand'] === true,
  }
}

/**
 * The pool now: every OTHER library as the band read it, plus this one as
 * its live counter says. Never less than this library alone.
 */
export function pooledMediaBytes(
  band: MediaStorageBand,
  liveScopeBytes: number,
): number {
  const others = Math.max(0, band.usedBytes - band.scopeBytes)
  return others + Math.max(0, Number(liveScopeBytes) || 0)
}

const files = (count: number) =>
  `${count.toLocaleString('en-US')} file${count === 1 ? '' : 's'}`

/** What the grid is inside, for the files half of the readout. */
export type MediaFilesPlace =
  | { kind: 'folder'; name: string; count: number; withSubfolders?: boolean }
  | { kind: 'root'; count: number }

/**
 * "17 files" with no folder open; "15 files in Project photos · 17 in the
 * library" with one.
 *
 * Both figures are totals — the folder's from the rail's server-side count,
 * the library's from its counter — never the number of cards loaded so far.
 * The old "15 of 17 files" put the two side by side with nothing to say which
 * was which, and read as an upload in progress.
 */
export function mediaFilesLabel(input: {
  libraryCount: number
  place?: MediaFilesPlace | null
}): string {
  const libraryCount = Math.max(0, Number(input.libraryCount) || 0)
  const place = input.place
  if (!place) return files(libraryCount)
  const where =
    place.kind === 'root'
      ? 'not in a folder'
      : `in ${place.name}${place.withSubfolders ? ' and its subfolders' : ''}`
  return `${files(Math.max(0, place.count))} ${where} · ${libraryCount.toLocaleString('en-US')} in the library`
}

/** The storage half of the readout, and the meter under it. */
export interface MediaStorageReadout {
  text: string
  /** How full the band is, in percent; `null` when no cap is stated. */
  percent: number | null
  /** The shared usage meters' tone for `percent`. */
  tone: UsageMeterTone
}

/**
 * - No band yet (or none to be had): this library's bytes, no cap — the line
 *   the toolbar always showed.
 * - Unlimited: this library's bytes, and that storage is unlimited.
 * - A band, and this library holds the whole pool: "<here> of <band> used".
 * - A band, and other libraries hold bytes too: "<here> here · <pool> of
 *   <band> used across your workspace".
 */
export function mediaStorageReadout(input: {
  scopeBytes: number
  band: MediaStorageBand | null
}): MediaStorageReadout {
  const { band } = input
  const scopeBytes = Math.max(0, Number(input.scopeBytes) || 0)
  const here = formatMediaBytes(scopeBytes)
  if (!band) return { text: `${here} used`, percent: null, tone: 'primary' }
  if (!Number.isFinite(band.allowanceMb)) {
    return {
      text: `${here} used · unlimited storage`,
      percent: null,
      tone: 'primary',
    }
  }
  const pooled = pooledMediaBytes(band, scopeBytes)
  const cap = formatStorageMb(band.allowanceMb)
  const percent = (pooled / (band.allowanceMb * MB)) * 100
  const text =
    pooled > scopeBytes
      ? `${here} here · ${formatMediaBytes(pooled)} of ${cap} used across your workspace`
      : `${here} of ${cap} used`
  return { text, percent, tone: usageMeterTone(percent) }
}

export interface MediaUploadStorageVerdict {
  allowed: boolean
  /** The band refused at, in MB; `null` when allowed. */
  limitMb: number | null
}

/**
 * The library's early answer to "will this upload fit" — the friendlier
 * refusal before any bytes leave the browser. The server's gate is the
 * authority; this may only ever agree with it or say nothing.
 *
 * It refuses only where the server certainly would: a hard band, on the
 * pooled total, by the gate's own rounding (`Math.ceil(usedMb) - 1` against
 * the cap). With no band, an unlimited one, or a band past which the plan
 * bills, it allows and lets the server decide — a paid upload past the band is
 * accepted and billed there, and turning it away here would be the client
 * refusing something the customer is entitled to.
 */
export function mediaUploadStorageVerdict(input: {
  band: MediaStorageBand | null
  /** The open library's bytes, live. */
  scopeBytes: number
  /** This file plus whatever this batch has already added. */
  incomingBytes: number
}): MediaUploadStorageVerdict {
  const { band } = input
  if (!band || !band.hardBand || !Number.isFinite(band.allowanceMb)) {
    return { allowed: true, limitMb: null }
  }
  const usedMb =
    (pooledMediaBytes(band, input.scopeBytes) +
      Math.max(0, Number(input.incomingBytes) || 0)) /
    MB
  return Math.ceil(usedMb) - 1 < band.allowanceMb
    ? { allowed: true, limitMb: null }
    : { allowed: false, limitMb: band.allowanceMb }
}

/** The refusal `mediaUploadStorageVerdict` stands for, as the toolbar says it. */
export function mediaStorageLimitMessage(limitMb: number): string {
  return (
    `Storage limit reached (${formatStorageMb(limitMb)} across your ` +
    'workspace) — see Billing to upgrade'
  )
}
