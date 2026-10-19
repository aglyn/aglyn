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

/*==========================================
 * BRING MY SITE, AS THE CONSOLE SHOWS IT (AGL-3976).
 *
 * Pure: what the "Create site" choice card says before anyone clicks, and
 * what an import job's page shows in each of its states — the site read and
 * its waves planned, a wave running, a wave in for review, a wave held for a
 * proof or the day's limit, the import done. The components draw these; the
 * specs hold them.
 *=========================================*/

import { aiCreditRangeText } from './ai-credit-estimate'
import type { AiJobItemLedger, AiJobSummary } from './ai-jobs.types'
import {
  AI_SITE_IMPORT_FRAME_SLOT,
  AI_SITE_IMPORT_LEFT_OUT_COPY,
  AI_SITE_IMPORT_LEFT_OUT_REASONS,
  aiSiteImportNextWave,
  aiSiteImportPagesText,
  aiSiteImportReviewWave,
  aiSiteImportRunningWave,
  aiSiteImportWaveCreditRange,
  type AiSiteImportLeftOutReason,
  type AiSiteImportState,
  type AiSiteImportWave,
} from './ai-site-import'

/** A domain ownership claim, as the ownership door answers it. */
export interface AiSiteImportClaim {
  domain: string
  status: 'pending' | 'proven'
  current: boolean
  provenMethod: 'dns' | 'meta' | 'email' | null
  provenAt: number | null
  provenDetail: string | null
  lastChecks: Partial<Record<'dns' | 'meta' | 'email', 'proven' | 'not-yet' | 'unreachable'>>
  dns: { host: string; type: 'TXT'; value: string }
  meta: { name: string; content: string; tag: string }
  email: { domain: string; pendingAddress: string | null; expiresAt: number | null; attemptsLeft: number | null }
}

/** Whether "Bring my site" is offered here, and if not why. */
export type AiSiteImportAvailability =
  | { state: 'checking' }
  /** The release flag is off, or the doors cannot be reached: the card is not drawn. */
  | { state: 'hidden' }
  /** Something the workspace can change stands in the way: the card is drawn disabled, with the reason. */
  | { state: 'blocked'; reason: 'plan' | 'role'; message: string }
  | { state: 'ready'; claims: AiSiteImportClaim[] }

/** What the card says to a plan that does not include it. */
export const AI_SITE_IMPORT_PLAN_COPY =
  'Bring your current website in, every page and photo, on any paid plan. Upgrade to bring yours in.'

/** What the card says to a member who cannot. */
export const AI_SITE_IMPORT_ROLE_COPY = 'Only the workspace owner or an admin can bring a site in.'

/**
 * The jobs list's `siteImport` offer (AGL-3976), as the card's state: absent
 * is the flag off, and the card is not drawn; `plan` and `role` are drawn
 * disabled with the reason.
 */
export function aiSiteImportOfferOf(offer: unknown): AiSiteImportAvailability {
  if (offer === 'ready') return { state: 'ready', claims: [] }
  if (offer === 'plan') return { state: 'blocked', reason: 'plan', message: AI_SITE_IMPORT_PLAN_COPY }
  if (offer === 'role') return { state: 'blocked', reason: 'role', message: AI_SITE_IMPORT_ROLE_COPY }
  return { state: 'hidden' }
}

/** Where an import job's page is. */
export type AiSiteImportPhase =
  /** The site is being read. */
  | 'reading'
  /** Read and planned; the first wave waits to be started. */
  | 'ready'
  /** A wave was started and has not begun yet. */
  | 'starting'
  | 'running'
  /** A wave is in; the next waits to be started. */
  | 'review'
  /** Held for something the person does: verify again, wait for tomorrow, read again. */
  | 'held'
  /** Out of AI credits or at a cap: the meter's pause, carried on by Resume. */
  | 'paused'
  | 'done'
  | 'stopped'

export function aiSiteImportPhaseOf(job: Pick<AiJobSummary, 'status' | 'review' | 'siteImport'>): AiSiteImportPhase {
  const state = job.siteImport ?? null
  if (job.status === 'done') return 'done'
  if (job.status === 'failed' || job.status === 'canceled') return 'stopped'
  if (job.status === 'needs_input') return 'paused'
  if (job.status === 'needs_review') {
    if (job.review?.reason !== 'wave' || !state) return 'held'
    return aiSiteImportReviewWave(state) ? 'review' : 'ready'
  }
  if (!state) return 'reading'
  return aiSiteImportRunningWave(state) ? 'running' : 'starting'
}

export type AiSiteImportRowState = 'waiting' | 'active' | 'done' | 'failed' | 'skipped'

export interface AiSiteImportRowView {
  slot: string
  title: string
  /** Where it is on the old site. */
  from: string
  /** Where it is on the new one. */
  to: string
  state: AiSiteImportRowState
  /** Why it failed or was left out, or what the person should know. */
  note: string | null
  /** "3 photos added, 1 already in your library". */
  photos: string | null
  /** The draft the row wrote, by its output id. */
  outputId: string | null
}

function rowState(row: AiJobItemLedger | undefined, active: boolean): AiSiteImportRowState {
  if (!row) return 'waiting'
  if (row.status === 'succeeded' || row.status === 'degraded') return 'done'
  if (row.status === 'failed') return 'failed'
  if (row.status === 'skipped') return 'skipped'
  return active ? 'active' : 'waiting'
}

/** "3 photos added", "2 photos added, 1 already in your library". */
export function aiSiteImportPhotosText(photos: { brought: number; reused: number } | null | undefined): string | null {
  if (!photos || photos.brought + photos.reused === 0) return null
  const added = photos.brought ? `${photos.brought} ${photos.brought === 1 ? 'photo' : 'photos'} added` : ''
  const reused = photos.reused ? `${photos.reused} already in your media library` : ''
  return [added, reused].filter(Boolean).join(', ')
}

/** One wave's rows, the header and footer first where the wave builds them. */
export function aiSiteImportWaveRows(
  job: Pick<AiJobSummary, 'items' | 'siteImport' | 'status'>,
  wave: AiSiteImportWave,
): AiSiteImportRowView[] {
  const state = job.siteImport as AiSiteImportState
  const items = new Map((job.items ?? []).map((row) => [row.slot, row]))
  const running = wave.status === 'running' && (job.status === 'running' || job.status === 'queued')
  let activeTaken = false
  const active = (row: AiJobItemLedger | undefined) => {
    if (!running || activeTaken || !row || (row.status !== 'pending' && row.status !== 'running')) return false
    activeTaken = true
    return true
  }
  const rows: AiSiteImportRowView[] = []
  if (wave.frame && state.frame) {
    const row = items.get(AI_SITE_IMPORT_FRAME_SLOT)
    rows.push({
      slot: AI_SITE_IMPORT_FRAME_SLOT,
      title: 'Header and footer',
      from: `Your menu on ${state.domain}`,
      to: 'Every page',
      state: rowState(row, active(row)),
      note: row?.failure?.message ?? row?.note ?? null,
      photos: null,
      outputId: row?.outputs[0] ?? null,
    })
  }
  for (const slot of wave.slots) {
    const page = state.pages.find((entry) => entry.slot === slot)
    if (!page) continue
    const row = items.get(slot)
    rows.push({
      slot,
      title: page.title,
      from: page.path,
      to: page.slug === '/' ? '/' : `/${page.slug}`,
      state: rowState(row, active(row)),
      note: row?.failure?.message ?? row?.note ?? (page.refused ? AI_SITE_IMPORT_LEFT_OUT_COPY[page.refused] : null),
      photos: aiSiteImportPhotosText(page.photos),
      outputId: row?.outputs[0] ?? null,
    })
  }
  return rows
}

/** "About 189 credits (up to 650)" for the wave, as it stands. */
export function aiSiteImportWaveQuote(job: Pick<AiJobSummary, 'items' | 'siteImport'>, wave: AiSiteImportWave): string {
  return aiCreditRangeText(aiSiteImportWaveCreditRange(job.siteImport as AiSiteImportState, wave, job.items ?? null))
}

/** What a wave cost, its pages' credits less what was given back. */
export function aiSiteImportWaveSpent(job: Pick<AiJobSummary, 'items'>, wave: AiSiteImportWave): number {
  const slots = new Set([...wave.slots, ...(wave.frame ? [AI_SITE_IMPORT_FRAME_SLOT] : [])])
  return (job.items ?? [])
    .filter((row) => slots.has(row.slot))
    .reduce((total, row) => total + Math.max(0, (row.creditsSpent ?? 0) - (row.creditsRefunded ?? 0)), 0)
}

/** The read site in one sentence: "Found 21 pages on harbor-dental.com: Main pages (6) and Blog (14)." */
export function aiSiteImportFoundText(state: AiSiteImportState): string {
  const groups = state.groups.map((group) => `${group.label} (${group.pages})`)
  const listed =
    groups.length <= 1 ? groups.join('') : `${groups.slice(0, -1).join(', ')} and ${groups[groups.length - 1]}`
  const found = `Found ${aiSiteImportPagesText(state.found)} on ${state.domain}`
  return listed ? `${found}: ${listed}.` : `${found}.`
}

/** The plan's page count against the site: "Your plan includes 25 pages and this site has 0, so 20 are brought in." */
export function aiSiteImportPlanText(state: AiSiteImportState): string {
  const kept = state.pages.length
  const waves = state.waves.length
  const plan =
    state.pageLimit === null
      ? 'Your plan has no page limit'
      : `Your plan includes ${aiSiteImportPagesText(state.pageLimit)} and this site has ${state.existingPages}`
  return `${plan}, so ${aiSiteImportPagesText(kept)} ${kept === 1 ? 'is' : 'are'} brought in, in ${waves === 1 ? 'one wave' : `${waves} waves`}.`
}

/** What was left out, by reason, most first. */
export function aiSiteImportLeftOutLines(state: AiSiteImportState): Array<{ reason: AiSiteImportLeftOutReason; count: number; text: string; paths: string[] }> {
  return AI_SITE_IMPORT_LEFT_OUT_REASONS.map((reason) => ({
    reason,
    count: state.leftOutCount[reason] ?? 0,
    text: AI_SITE_IMPORT_LEFT_OUT_COPY[reason],
    paths: state.leftOut.filter((entry) => entry.reason === reason).map((entry) => entry.path),
  }))
    .filter((line) => line.count > 0)
    .sort((a, b) => b.count - a.count)
}

/** The wave a page offers to start next, and its button's words. */
export function aiSiteImportStartAction(
  job: Pick<AiJobSummary, 'siteImport' | 'items'>,
): { wave: AiSiteImportWave; label: string; quote: string } | null {
  const state = job.siteImport ?? null
  const wave = aiSiteImportNextWave(state)
  if (!state || !wave) return null
  return { wave, label: `Start ${wave.label}`, quote: aiSiteImportWaveQuote(job, wave) }
}
