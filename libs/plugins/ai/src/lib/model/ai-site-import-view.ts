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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { aiCreditRangeText } from './ai-credit-estimate'
import type { AiJobItemLedger, AiJobSummary } from './ai-jobs.types'
import {
  AI_SITE_IMPORT_FRAME_SLOT,
  AI_SITE_IMPORT_LEFT_OUT_COPY,
  AI_SITE_IMPORT_LEFT_OUT_REASONS,
  AI_SITE_IMPORT_UNREAD_REASONS,
  aiSiteImportNextWave,
  aiSiteImportPagesText,
  aiSiteImportQuoteText,
  aiSiteImportReadStops,
  aiSiteImportReadVerdictMessage,
  aiSiteImportReadVerdictReason,
  aiSiteImportRemainingCreditRange,
  aiSiteImportReviewWave,
  aiSiteImportRunningWave,
  aiSiteImportWaveCreditRange,
  aiSiteImportWaveOwed,
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
  // A read that stopped at its home page is held, and its Check again reads again (AGL-4083).
  const stopped = aiSiteImportReadStops(state?.verdict)
  if (job.status === 'done') return 'done'
  if (job.status === 'failed' || job.status === 'canceled') return 'stopped'
  if (job.status === 'needs_input') return 'paused'
  if (job.status === 'needs_review') {
    if (job.review?.reason !== 'wave' || !state || stopped) return 'held'
    return aiSiteImportReviewWave(state) ? 'review' : 'ready'
  }
  if (!state || stopped) return 'reading'
  return aiSiteImportRunningWave(state) ? 'running' : 'starting'
}

/**
 * How a hold that is the site's to fix reads (AGL-4083): its heading, its
 * sentence and its button. A home page bot protection turned away, or one
 * that could not be read, is checked again for free; `null` for any other
 * hold, which keeps its own words.
 */
export function aiSiteImportHeldCopy(
  job: Pick<AiJobSummary, 'review' | 'siteImport'>,
): { heading: string; message: string; action: string } | null {
  const state = job.siteImport ?? null
  const fromState = aiSiteImportReadStops(state?.verdict) ? aiSiteImportReadVerdictReason(state?.verdict) : null
  const reason = job.review?.reason === 'blocked' || job.review?.reason === 'unreadable' ? job.review.reason : fromState
  if (!reason) return null
  const message =
    (fromState && state ? aiSiteImportReadVerdictMessage(state.verdict, state.domain) : null) ?? job.review?.message ?? ''
  return {
    heading: reason === 'blocked' ? 'AglynBot was turned away' : 'Your home page could not be read',
    message,
    action: 'Check again',
  }
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
  /** The page on the old site, to open beside the draft (AGL-4083). */
  oldPage: string
  /** "1,204 of 1,310 words", once the page is in and the step has counted them. */
  words: string | null
  /** "Copied as it is" or "Arranged by Aglyn AI", once the step has chosen. */
  build: string | null
}

function rowState(row: AiJobItemLedger | undefined, active: boolean): AiSiteImportRowState {
  if (!row) return 'waiting'
  if (row.status === 'succeeded' || row.status === 'degraded') return 'done'
  if (row.status === 'failed') return 'failed'
  if (row.status === 'skipped') return 'skipped'
  return active ? 'active' : 'waiting'
}

/**
 * "3 photos added", "2 photos added, 1 already in your media library"; with
 * photos that could not come in, against all it tried: "3 of 5 photos: 2
 * added, 1 already in your media library, 2 could not be brought in".
 */
export function aiSiteImportPhotosText(
  photos: { brought: number; reused: number; skipped?: number } | null | undefined,
): string | null {
  if (!photos) return null
  const skipped = Math.max(0, photos.skipped ?? 0)
  const into = photos.brought + photos.reused
  if (into === 0 && skipped === 0) return null
  if (!skipped) {
    const added = photos.brought ? `${photos.brought} ${photos.brought === 1 ? 'photo' : 'photos'} added` : ''
    const reused = photos.reused ? `${photos.reused} already in your media library` : ''
    return [added, reused].filter(Boolean).join(', ')
  }
  const parts = [
    photos.brought ? `${photos.brought} added` : '',
    photos.reused ? `${photos.reused} already in your media library` : '',
    `${skipped} could not be brought in`,
  ].filter(Boolean)
  const tried = into + skipped
  return `${into} of ${tried} ${tried === 1 ? 'photo' : 'photos'}: ${parts.join(', ')}`
}

const BUILD_COPY = { copied: 'Copied as it is', arranged: `Arranged by ${PLATFORM_BRAND_NAME} AI` } as const

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
      oldPage: `https://${state.domain}/`,
      words: null,
      build: null,
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
      oldPage: page.url,
      words: page.brought ? `${page.brought.words.toLocaleString('en-US')} of ${page.words.toLocaleString('en-US')} words` : null,
      build: page.build ? BUILD_COPY[page.build] : null,
    })
  }
  return rows
}

/**
 * "About 189 credits (up to 650)" for the wave, as it stands; once the step
 * has chosen how its pages are built, it names them: "…: 7 pages arranged by
 * Aglyn AI, 3 copied as they are" (AGL-4083).
 */
export function aiSiteImportWaveQuote(job: Pick<AiJobSummary, 'items' | 'siteImport'>, wave: AiSiteImportWave): string {
  const state = job.siteImport as AiSiteImportState
  const range = aiSiteImportWaveCreditRange(state, wave, job.items ?? null)
  return aiSiteImportQuoteText(range, aiSiteImportWaveOwed(state, wave, job.items ?? null))
}

/** What a wave cost, its pages' credits less what was given back. */
export function aiSiteImportWaveSpent(job: Pick<AiJobSummary, 'items'>, wave: AiSiteImportWave): number {
  const slots = new Set([...wave.slots, ...(wave.frame ? [AI_SITE_IMPORT_FRAME_SLOT] : [])])
  return (job.items ?? [])
    .filter((row) => slots.has(row.slot))
    .reduce((total, row) => total + Math.max(0, (row.creditsSpent ?? 0) - (row.creditsRefunded ?? 0)), 0)
}

/** Pages the site has that AglynBot could not read: turned away, unanswered, too large or never reached. */
export function aiSiteImportUnreadCount(state: AiSiteImportState): number {
  return AI_SITE_IMPORT_UNREAD_REASONS.reduce((total, reason) => total + (state.leftOutCount[reason] ?? 0), 0)
}

/**
 * The read site in one sentence: "Found 21 pages on harbor-dental.com: Main
 * pages (6) and Blog (14)." — and how many more could not be read (AGL-4083).
 */
export function aiSiteImportFoundText(state: AiSiteImportState): string {
  const groups = state.groups.map((group) => `${group.label} (${group.pages})`)
  const listed =
    groups.length <= 1 ? groups.join('') : `${groups.slice(0, -1).join(', ')} and ${groups[groups.length - 1]}`
  const found = `Found ${aiSiteImportPagesText(state.found)} on ${state.domain}`
  const lead = listed ? `${found}: ${listed}.` : `${found}.`
  const unread = aiSiteImportUnreadCount(state)
  return unread ? `${lead} ${unread.toLocaleString('en-US')} more could not be read; see Not brought in.` : lead
}

/** Why the read stopped short, when it did and left pages unread (AGL-4083). */
export function aiSiteImportStopText(state: AiSiteImportState): string | null {
  const unreached = state.leftOutCount['not-reached'] ?? 0
  if (!unreached) return null
  const first = `Only the first ${aiSiteImportPagesText(state.found)}`
  const rest = 'the rest are listed under Not brought in as not reached.'
  switch (state.stoppedBy) {
    case 'time':
      return `${first} could be read in the time allowed; ${rest}`
    case 'total-bytes':
      return `${first} could be read before the read reached its size limit; ${rest}`
    default:
      return `${first} could be read this time; ${rest}`
  }
}

/** The read's warning when most of the site was turned away though its home page came in (AGL-4083). */
export function aiSiteImportVerdictNote(state: AiSiteImportState): string | null {
  return state.verdict?.kind === 'mostly-blocked' ? aiSiteImportReadVerdictMessage(state.verdict, state.domain) : null
}

/** The plan's page count against the site: "Your plan includes 25 pages and this site has 0, so 20 are brought in." */
export function aiSiteImportPlanText(state: AiSiteImportState): string {
  const kept = state.pages.length
  const waves = state.waves.length
  const plan =
    state.pageLimit === null
      ? 'Your plan has no page limit'
      : `Your plan includes ${aiSiteImportPagesText(state.pageLimit)} and this site has ${state.existingPages}`
  const lead = `${plan}, so ${aiSiteImportPagesText(kept)} ${kept === 1 ? 'is' : 'are'} brought in, in ${waves === 1 ? 'one wave' : `${waves} waves`}.`
  const stop = aiSiteImportStopText(state)
  return stop ? `${lead} ${stop}` : lead
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

/**
 * "Start every remaining wave" (AGL-4083), off by default: offered beside the
 * next wave's button when more than one wave waits, quoted as all of them.
 */
export function aiSiteImportStartAllAction(
  job: Pick<AiJobSummary, 'siteImport' | 'items'>,
): { label: string; quote: string; waves: number } | null {
  const state = job.siteImport ?? null
  if (!state || !aiSiteImportNextWave(state)) return null
  const waves = state.waves.filter((wave) => wave.status === 'waiting').length
  if (waves < 2) return null
  return {
    label: 'Start every remaining wave',
    quote: aiCreditRangeText(aiSiteImportRemainingCreditRange(state, job.items ?? null)),
    waves,
  }
}
