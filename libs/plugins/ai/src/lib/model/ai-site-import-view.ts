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
import { aiMediaCreditsPerPicture } from './ai-media-credits'
import type { AiJobItemLedger, AiJobSummary } from './ai-jobs.types'
import {
  AI_SITE_IMPORT_FRAME_SLOT,
  AI_SITE_IMPORT_GENERATED_PICTURES_PER_PAGE,
  AI_SITE_IMPORT_LAYOUT_KEPT,
  AI_SITE_IMPORT_PLAN_FELL_BACK,
  AI_SITE_IMPORT_LEFT_OUT_COPY,
  AI_SITE_IMPORT_LEFT_OUT_REASONS,
  AI_SITE_IMPORT_DEFAULT_CHOICE,
  AI_SITE_IMPORT_UNREAD_REASONS,
  aiSiteImportChoiceOf,
  aiSiteImportGeneratedPicturesOn,
  aiSiteImportNextWave,
  aiSiteImportPagesText,
  aiSiteImportPlanAccepted,
  aiSiteImportPlanAwaits,
  aiSiteImportQuoteText,
  aiSiteImportReadStops,
  aiSiteImportReadVerdictMessage,
  aiSiteImportReadVerdictReason,
  aiSiteImportRemainingCreditRange,
  aiSiteImportReviewWave,
  aiSiteImportRunningWave,
  aiSiteImportWaveChoice,
  aiSiteImportWaveCreditRange,
  aiSiteImportWaveIsGenerative,
  aiSiteImportWaveOwed,
  aiSiteImportWordingCredits,
  aiSiteImportWordingPages,
  type AiSiteImportChoice,
  type AiSiteImportFinish,
  type AiSiteImportLeftOutReason,
  type AiSiteImportPage,
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

/**
 * Why an import that had started is waiting with no wave to review (AGL-4083):
 * the sentence its stop left, which says what is not in yet and what to start.
 * `null` for one that has not started, and one waiting for its review.
 */
export function aiSiteImportStoppedCopy(job: Pick<AiJobSummary, 'status' | 'review' | 'siteImport'>): string | null {
  const state = job.siteImport ?? null
  if (aiSiteImportPhaseOf(job) !== 'ready' || !state?.waves.some((wave) => wave.startedAt)) return null
  return job.review?.message || null
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
  /**
   * "Copied as it is" or "Arranged by Aglyn AI", once the step has chosen;
   * "Arranged and reworded by Aglyn AI" once its wave improved its words, and
   * "Arranged by Aglyn AI · Words kept" for a policy page on such a wave (AGL-4152).
   * Under a generative Improve it: "Redesigned by Aglyn AI · 2 new sections",
   * or "Layout kept: the redesign did not pass".
   */
  build: string | null
  /** "New: Why us, FAQ (4)": the sections a redesign added (AGL-4152). */
  added?: string | null
  /** "1 stock photo, 1 generated picture": the pictures a redesign took beside its own (AGL-4152). */
  pictures?: string | null
  /** A page the site's plan proposed (AGL-4152): it has no old page to open. */
  isNew?: boolean
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

const BUILD_COPY = {
  copied: 'Copied as it is',
  arranged: `Arranged by ${PLATFORM_BRAND_NAME} AI`,
  /** A main page redesigned from its ledger (AGL-4152). */
  redesigned: `Redesigned by ${PLATFORM_BRAND_NAME} AI`,
  /** A main page whose wording was improved (AGL-4152). */
  reworded: `Arranged and reworded by ${PLATFORM_BRAND_NAME} AI`,
  /** A policy page on a wave that improved the wording of the rest: it keeps every word. */
  wordsKept: `Arranged by ${PLATFORM_BRAND_NAME} AI · Words kept`,
} as const

/** A page's build as its row says it, with whether its words were improved where its wave improved wording (AGL-4152). */
function buildCopy(page: AiSiteImportPage, choice: AiSiteImportChoice, generative = false): string | null {
  if (!page.build) return null
  // A redesign that did not pass (AGL-4152): today's compile drew the page.
  if (page.redesign === 'layout-kept') return AI_SITE_IMPORT_LAYOUT_KEPT
  if (page.redesign === 'redesigned') {
    const added = page.added?.length ?? 0
    return added ? `${BUILD_COPY.redesigned} · ${added} new ${added === 1 ? 'section' : 'sections'}` : BUILD_COPY.redesigned
  }
  if (generative && page.build === 'arranged' && page.wording === 'improved') return BUILD_COPY.redesigned
  if (page.build === 'arranged' && page.wording === 'improved') return BUILD_COPY.reworded
  if (page.build === 'arranged' && page.wording === 'kept' && choice.wording) return BUILD_COPY.wordsKept
  return BUILD_COPY[page.build]
}

/** "New: Why us, FAQ (4)": the sections a redesign added, as its row says (AGL-4152). */
export function aiSiteImportAddedText(page: Pick<AiSiteImportPage, 'added'>): string | null {
  const added = page.added ?? []
  return added.length ? `New: ${added.map((section) => (section.items ? `${section.heading} (${section.items})` : section.heading)).join(', ')}` : null
}

/** "1 stock photo, 1 generated picture": what a redesign's pictures came from beside the page's own (AGL-4152). */
export function aiSiteImportPicturesText(page: Pick<AiSiteImportPage, 'pictures'>): string | null {
  const pictures = page.pictures
  if (!pictures) return null
  const parts = [
    pictures.stock ? `${pictures.stock} stock ${pictures.stock === 1 ? 'photo' : 'photos'}` : '',
    pictures.generated ? `${pictures.generated} generated ${pictures.generated === 1 ? 'picture' : 'pictures'}` : '',
    pictures.unplaced.length ? `${pictures.unplaced.length} of your photos not placed` : '',
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

/** What the row of a page whose words were improved says in place of its word count (AGL-4152). */
export const AI_SITE_IMPORT_REWORDED_WORDS = 'Every fact kept'

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
  const choice = aiSiteImportWaveChoice(state, wave)
  const generative = aiSiteImportWaveIsGenerative(state, wave)
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
      // What a generative Improve it says of a page beside its build (AGL-4152).
      ...(aiSiteImportAddedText(page) ? { added: aiSiteImportAddedText(page) } : {}),
      ...(aiSiteImportPicturesText(page) ? { pictures: aiSiteImportPicturesText(page) } : {}),
      ...(page.origin === 'proposed' ? { isNew: true } : {}),
      photos: aiSiteImportPhotosText(page.photos),
      outputId: row?.outputs[0] ?? null,
      oldPage: page.url,
      // Beside the old page's own words, its main region's as the wave read them: its menu and footer are the site's (AGL-4084).
      // A page whose words were improved keeps its facts, not its count (AGL-4152).
      words: page.brought && page.origin !== 'proposed'
        ? page.wording === 'improved'
          ? AI_SITE_IMPORT_REWORDED_WORDS
          : `${page.brought.words.toLocaleString('en-US')} of ${(page.read?.words ?? page.words).toLocaleString('en-US')} words`
        : null,
      build: buildCopy(page, choice, generative),
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
  return aiSiteImportQuoteText(range, aiSiteImportWaveOwed(state, wave, job.items ?? null), aiSiteImportWaveIsGenerative(state, wave) ? { generative: true } : {})
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
  job: Pick<AiJobSummary, 'siteImport' | 'items'> & Partial<Pick<AiJobSummary, 'status'>>,
): { wave: AiSiteImportWave; label: string; quote: string } | null {
  const state = job.siteImport ?? null
  // An import that stopped inside a wave waits on that wave, which starts again where it stopped (AGL-4083).
  const wave = (job.status === 'needs_review' ? aiSiteImportRunningWave(state) : null) ?? aiSiteImportNextWave(state)
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

/*------------------------------------------
 * Keep my site, or Improve it (AGL-4152)
 *-----------------------------------------*/

/** What Bring my site asks, and what each answer means, as the console draws it. */
export const AI_SITE_IMPORT_FINISH_COPY = {
  heading: 'How should your new site look?',
  keep: {
    label: 'Keep my site',
    description: `Your pages stay laid out as they are, in your site’s colors, buttons and fonts. ${PLATFORM_BRAND_NAME} tidies spacing, type and color so every page reads well. Every word stays as you wrote it.`,
  },
  improve: {
    label: 'Improve it',
    description: `${PLATFORM_BRAND_NAME} AI redesigns each page with your pictures, menus and forms, in a theme built around your brand.`,
  },
  wording: {
    label: 'Also improve my wording',
    description: `${PLATFORM_BRAND_NAME} AI rewrites the headings, paragraphs and buttons of your main pages so they read better. Every name, price, number, date, address, phone number and email stays exactly as you wrote it. Quotes, policies, tables and forms keep every word.`,
  },
  helper: 'You can change this before each wave.',
  /** The job page's line before it opens the choice: "How your new site looks: Keep my site". */
  current: 'How your new site looks',
  change: 'Change',
} as const

/**
 * The same choice under a generative Improve it (AGL-4152): the improve option's
 * and the switch's words; everything else stands. Only drawn under the flag.
 */
export const AI_SITE_IMPORT_FINISH_COPY_GENERATIVE = {
  ...AI_SITE_IMPORT_FINISH_COPY,
  improve: {
    label: 'Improve it',
    description: `${PLATFORM_BRAND_NAME} AI plans your menu and footer, and redesigns each page with your pictures and forms, in a theme built around your brand. It shows you the plan before anything is built.`,
  },
  wording: {
    label: 'Also write new copy',
    description: `${PLATFORM_BRAND_NAME} AI writes new headings, paragraphs and sections for your main pages from what your site says. It never makes up a name, number, price, date, testimonial, client, award, credential, address or guarantee. Off, every word stays as you wrote it, and your layout and menu are still redesigned.`,
  },
} as const

/** The choice in a few words: "Keep my site", "Improve it", or "Improve it, and my wording"; under a generative Improve it, "Improve it, with new copy". */
export function aiSiteImportChoiceText(choice: AiSiteImportChoice, options: { generative?: boolean } = {}): string {
  if (choice.finish === 'keep') return AI_SITE_IMPORT_FINISH_COPY.keep.label
  if (!choice.wording) return AI_SITE_IMPORT_FINISH_COPY.improve.label
  return options.generative ? `${AI_SITE_IMPORT_FINISH_COPY.improve.label}, with new copy` : `${AI_SITE_IMPORT_FINISH_COPY.improve.label}, and my wording`
}

/** How a wave was built, as its heading says it: "Keep my site", "Improved", or "Improved, wording too"; under a generative Improve it, "Redesigned" or "Redesigned, new copy". */
export function aiSiteImportBuiltText(choice: AiSiteImportChoice, options: { generative?: boolean } = {}): string {
  if (choice.finish === 'keep') return AI_SITE_IMPORT_FINISH_COPY.keep.label
  if (options.generative) return choice.wording ? 'Redesigned, new copy' : 'Redesigned'
  return choice.wording ? 'Improved, wording too' : 'Improved'
}

/**
 * A wave's heading (AGL-4152): once it has started, its name and how it was
 * built, "Main pages · Keep my site"; before, its name alone, since how it is
 * built is still the owner's to change.
 */
export function aiSiteImportWaveHeading(state: Pick<AiSiteImportState, 'finish' | 'wording'> | null | undefined, wave: AiSiteImportWave): string {
  if (!wave.startedAt) return wave.label
  return `${wave.label} · ${aiSiteImportBuiltText(aiSiteImportWaveChoice(state, wave), wave.generative ? { generative: true } : {})}`
}

/** What a running wave's page says it does with each page, the way the wave is built (AGL-4152). */
export function aiSiteImportRunningLede(choice: AiSiteImportChoice, options: { generative?: boolean } = {}): string {
  const review = 'You review the wave when it is in.'
  if (choice.finish === 'keep') return `Each page keeps its layout and every word as you wrote it, in your site’s own look. ${review}`
  if (options.generative && choice.wording) return `${PLATFORM_BRAND_NAME} AI redesigns each page and writes new copy from what your site says, making up no name, number, price or date. ${review}`
  return choice.wording
    ? `${PLATFORM_BRAND_NAME} AI redesigns each page and improves its wording, keeping every name, price, number, date, address, phone number and email as you wrote it. ${review}`
    : `${PLATFORM_BRAND_NAME} AI redesigns each page with its own words, pictures, menus and forms. ${review}`
}

/**
 * What Also improve my wording adds (AGL-4152): for a wave, its pages'
 * rewrites, "Adds about 162 AI credits to this wave."; before the site is
 * read, a main page's.
 */
export function aiSiteImportWordingCreditsText(
  scope: { job: Pick<AiJobSummary, 'items' | 'siteImport'>; wave: AiSiteImportWave } | null,
): string {
  if (!scope?.job.siteImport) return `About ${aiSiteImportWordingCredits(1).likely.toLocaleString('en-US')} more AI credits for each main page.`
  const pages = aiSiteImportWordingPages(scope.job.siteImport, scope.wave, { finish: 'improve', wording: true }, scope.job.items ?? null)
  if (!pages) return 'This wave’s pages keep every word, so it adds no AI credits.'
  return `Adds about ${aiSiteImportWordingCredits(pages).likely.toLocaleString('en-US')} AI credits to this wave.`
}

/**
 * The choice as Bring my site draws it (AGL-4152): the finish, and where the
 * Also improve my wording switch sits, which counts only under Improve it, so
 * a person who picks Keep my site and then Improve it finds it on.
 */
export interface AiSiteImportFinishField {
  finish: AiSiteImportFinish
  wording: boolean
}

/** The field an import's page opens with: the import's choice, the switch on where it was never turned off under Improve it. */
export function aiSiteImportFinishFieldOf(state: Pick<AiSiteImportState, 'finish' | 'wording'> | null | undefined): AiSiteImportFinishField {
  const choice = aiSiteImportChoiceOf(state)
  return choice.finish === 'improve' ? choice : { finish: 'keep', wording: AI_SITE_IMPORT_DEFAULT_CHOICE.wording }
}

/** The choice a field asks for: its wording only under Improve it. */
export function aiSiteImportFieldChoice(field: AiSiteImportFinishField): AiSiteImportChoice {
  return { finish: field.finish, wording: field.finish === 'improve' && field.wording }
}

/*------------------------------------------
 * Your new site (AGL-4152)
 *-----------------------------------------*/

/** The "Your new site" panel's words: what the site is, its menu, its main button, its footer, and what its owner may switch. */
export interface AiSiteImportPlanView {
  what: string
  audience: string
  /** Each menu entry: its label and the pages under it; one page is a plain link. */
  menu: Array<{ label: string; pages: string[] }>
  /** "Book a visit → Contact". */
  cta: string | null
  footer: Array<{ label: string; pages: string[] }>
  /** The page it proposes, whether it was kept or switched off. */
  proposed: { title: string; purpose: string; address: string } | null
  /** Whether the owner still decides: the plan waits on them. */
  editable: boolean
}

/** The panel's fixed words, one place for its specs and its screen. */
export const AI_SITE_IMPORT_PLAN_COPY_TEXT = {
  heading: 'Your new site',
  menu: 'Menu',
  cta: 'Main button',
  footer: 'Footer',
  addPage: 'Add this new page',
  addPageHelp: 'One new page, written from what your site says. It counts toward your plan’s page limit.',
  pictures: 'Create pictures with AI where needed',
  build: 'Build my new site',
  whatsNew: 'What’s new',
} as const

/** The panel as a plan reads, or `null` with none: every import the flag is off for, and every plan that did not pass. */
export function aiSiteImportPlanViewOf(state: AiSiteImportState | null | undefined): AiSiteImportPlanView | null {
  const plan = state?.plan
  if (!state || !plan) return null
  const name = (id: string) => (plan.proposed?.draftId === id ? plan.proposed.title : (state.pages.find((page) => page.draftId === id)?.title ?? ''))
  const named = (groups: ReadonlyArray<{ label: string; pages: string[] }>) => groups.map((group) => ({ label: group.label, pages: group.pages.map(name).filter(Boolean) })).filter((group) => group.pages.length)
  const cta = plan.nav.primaryCta
  const where = !cta ? '' : cta.target === 'phone' ? 'your phone number' : name(cta.target === 'form' ? (cta.page ?? '') : cta.target)
  return {
    what: plan.site.what,
    audience: plan.site.audience,
    menu: named(plan.nav.groups),
    cta: cta && where ? `${cta.label} → ${where}` : null,
    footer: named(plan.nav.footer),
    proposed: plan.proposed && (aiSiteImportPlanAwaits(state) || plan.proposed.on) ? { title: plan.proposed.title, purpose: plan.proposed.purpose, address: `/${plan.proposed.slug}` } : null,
    editable: aiSiteImportPlanAwaits(state),
  }
}

/** What the plan that did not pass says, or `null`: a plan that passed, and every import with none asked. */
export function aiSiteImportPlanFellBackText(state: Pick<AiSiteImportState, 'plan'> | null | undefined): string | null {
  return state?.plan === null ? AI_SITE_IMPORT_PLAN_FELL_BACK : null
}

/** The credits a generated picture is quoted at, on a paid plan: an import is one. */
export const aiSiteImportPictureCredits = (): number => aiMediaCreditsPerPicture('photo', undefined, '1K')

/** What the generated pictures switch says it adds: how many at most, and what each costs, before it is on. */
export function aiSiteImportPicturesSwitchText(state: AiSiteImportState): string {
  const pages = state.pages.filter((page) => page.wording === 'improved' && !page.refused).length
  const each = aiSiteImportPictureCredits()
  const most = pages * AI_SITE_IMPORT_GENERATED_PICTURES_PER_PAGE
  return `Only where your own photos and the stock library have nothing that fits: a page’s opening picture or a section’s lead, up to ${AI_SITE_IMPORT_GENERATED_PICTURES_PER_PAGE} a page. About ${each.toLocaleString('en-US')} AI credits each${most ? `, so at most ${(most * each).toLocaleString('en-US')} for this wave` : ''}. A picture that is not made costs nothing.`
}

/** Whether generated pictures are switched on now, for the panel's first draw. */
export function aiSiteImportPlanFieldOf(state: AiSiteImportState | null | undefined): { addPage: boolean; pictures: boolean } {
  return { addPage: state?.plan?.proposed?.on !== false, pictures: aiSiteImportGeneratedPicturesOn(state) }
}

/** Whether a plan's generated pictures switch means anything: only pages with new copy ask for a picture. */
export function aiSiteImportPlanTakesPictures(state: Pick<AiSiteImportState, 'pages'>): boolean {
  return state.pages.some((page) => page.wording === 'improved' && !page.refused)
}

/** The wave's quote as the plan's switches stand now (AGL-4152), before they are saved: with or without its new page, and its pictures. */
export function aiSiteImportPlanQuote(job: Pick<AiJobSummary, 'items' | 'siteImport'>, field: { addPage: boolean; pictures: boolean }): string | null {
  const state = job.siteImport ?? null
  const plan = state?.plan
  if (!state || !plan) return null
  const asked: AiSiteImportState = { ...state, generatedPictures: field.pictures, plan: { ...plan, proposed: plan.proposed ? { ...plan.proposed, on: field.addPage } : null } }
  const next = aiSiteImportPlanAccepted(asked, job.items ?? [])
  const wave = aiSiteImportRunningWave(next.state)
  return wave ? aiSiteImportWaveQuote({ items: next.items, siteImport: next.state }, wave) : null
}

/** One page's lines of a wave's "What's new" (AGL-4152): its new sections, and its pictures. */
export interface AiSiteImportWhatsNewLine {
  page: string
  lines: string[]
}

/** A wave's "What's new" (AGL-4152): what its redesigns added, page by page. Empty on every other wave. */
export function aiSiteImportWhatsNew(state: AiSiteImportState, wave: AiSiteImportWave): AiSiteImportWhatsNewLine[] {
  return wave.slots.flatMap((slot) => {
    const page = state.pages.find((entry) => entry.slot === slot)
    if (!page || page.redesign !== 'redesigned') return []
    const lines = [page.origin === 'proposed' ? 'A new page, written from what your site says' : '', aiSiteImportAddedText(page) ?? '', aiSiteImportPicturesText(page) ?? ''].filter(Boolean)
    return lines.length ? [{ page: page.title, lines }] : []
  })
}
