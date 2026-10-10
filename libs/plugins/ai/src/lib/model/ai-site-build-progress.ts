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

import { AI_JOB_CANCELED_LEDE, aiJobCanceledCreditsCopy } from './ai-job-cancel-copy'
import { aiJobConfirmingOwnPlan, aiJobKindNoun } from './ai-job-activity'
import { aiJobRefundCopy } from './ai-job-failure-copy'
import { aiBuildItemRows, aiBuildOpNoun, aiBuildOutcomeLine, aiSitePartialCopy } from './ai-build-progress'
import { AI_JOB_PAUSED_NEXT_COPY, aiJobPausedTitle } from './ai-job-notice'
import type { AiJobSummary } from './ai-jobs.types'

/**
 * What the "Building your site" page shows of a site job (AGL-3594): one row
 * a stage — planning the pages, then each page — with its state, the state
 * the whole job is in, and the job's one price.
 *
 * Read off the job summary every surface already follows: the plan step's
 * status, the plan's pages, and the pages the build has reported as outputs.
 * A scaffold builds its units in plan order and reports each page when it is
 * written, so the pages written so far are the first pages of the plan.
 *
 * Pure: no React, no request. The page and its spec read the same rows.
 */

/**
 * `paused` (AGL-3660): the row a job the meter paused stopped at — not
 * running, not failed, and carried on from by Resume.
 */
export type AiSiteBuildRowState = 'done' | 'active' | 'waiting' | 'failed' | 'skipped' | 'paused'

export interface AiSiteBuildRow {
  id: string
  label: string
  state: AiSiteBuildRowState
  /** What the person should know about this row (AGL-3616): a build item's failure, note or refund. */
  detail?: string | null
  /** What the row is doing while it is the active one, in a sentence. */
  hint?: string | null
  /** A page's planned sections, in order, so the person sees what is being written. */
  sections?: string[]
  /** The credits this row's work used, once it has finished; absent while it runs. */
  credits?: number
  /** When this row's work started, for the elapsed time beside the active row. */
  startedAt?: string | null
}

/** Where the whole job stands, as the page's header and actions read it. */
export type AiSiteBuildPhase = 'working' | 'done' | 'stopped' | 'failed' | 'canceled'

export function aiSiteBuildPhase(
  job: Pick<AiJobSummary, 'status'> & Partial<Pick<AiJobSummary, 'review' | 'autoConfirm' | 'updatedAt'>>,
): AiSiteBuildPhase {
  // A guided start's plan parked for the instant its confirmation takes is
  // the build going on (AGL-3596), never a stop.
  if (aiJobConfirmingOwnPlan(job)) return 'working'
  switch (job.status) {
    case 'done':
      return 'done'
    case 'failed':
      return 'failed'
    case 'canceled':
      return 'canceled'
    case 'needs_review':
    case 'needs_input':
      return 'stopped'
    default:
      return 'working'
  }
}

/** The creations a scaffold builds before its pages, in its build order, and what each row says. */
const CREATION_ROWS: ReadonlyArray<{ kind: string; resource: string; label: (name: string) => string }> = [
  { kind: 'theme-change', resource: 'theme', label: () => AI_SITE_LOOK_ROW_LABEL },
  { kind: 'layout', resource: 'layout', label: (name) => `Building the header and footer: ${name}` },
  { kind: 'form', resource: 'form', label: (name) => `Building the form: ${name}` },
]

/**
 * One row a stage: planning, then each creation the plan builds before its
 * pages — the colors, the layout, the form — then each page (AGL-3596). A
 * scaffold builds them in that order and reports each as an output when it
 * is written, so the first row without its output is where the build is, and
 * where a failure stopped it: a layout that broke is the layout's row, never
 * the first page's.
 */
export function aiSiteBuildRows(
  job: Pick<AiJobSummary, 'status' | 'steps' | 'plan' | 'outputs' | 'review'> &
    Partial<Pick<AiJobSummary, 'items' | 'kind' | 'siteInputs' | 'sitePublish'>>,
): AiSiteBuildRow[] {
  const rows = aiSiteBuildRowsOf(job)
  return job.status === 'needs_input' ? aiPausedRows(rows) : rows
}

/**
 * A job the meter paused (AGL-3660) shows no spinner: the row it stopped at —
 * one still marked running, else the first not yet built — reads `paused`,
 * with no running clock and no "building now" hint, and every row after it
 * keeps waiting.
 */
function aiPausedRows(rows: AiSiteBuildRow[]): AiSiteBuildRow[] {
  const at = rows.findIndex((row) => row.state === 'active' || row.state === 'paused')
  const index = at >= 0 ? at : rows.findIndex((row) => row.state === 'waiting')
  return rows.map((row, position) => {
    if (row.state === 'active' && position !== index) return { ...row, state: 'waiting', hint: null, startedAt: null }
    if (position !== index) return row
    return { ...row, state: 'paused', hint: null, startedAt: null }
  })
}

function aiSiteBuildRowsOf(
  job: Pick<AiJobSummary, 'status' | 'steps' | 'plan' | 'outputs' | 'review'> &
    Partial<Pick<AiJobSummary, 'items' | 'kind' | 'siteInputs' | 'sitePublish'>>,
): AiSiteBuildRow[] {
  const phase = aiSiteBuildPhase(job)
  // A build is read off its item ledger (AGL-3616): one row an item, each with
  // its own state and what became of its credits.
  if (job.items?.length) {
    const site = job.kind !== 'build'
    const pages = (job.items ?? []).filter((row) => row.op === 'page')
    // The plan keeps the credits it used once the items take over the page.
    const planStep = job.steps.find((step) => step.name === 'plan')
    return [
      {
        id: 'plan',
        label: site ? 'Planning your pages' : 'Planning what to build',
        state: 'done',
        ...(planStep ? { credits: Math.max(0, Math.floor(planStep.creditsSpent ?? 0)) } : {}),
      },
      ...aiBuildItemRows(job).map((row, index) => {
        const ledger = (job.items ?? [])[index]
        // A site keeps the scaffold's own words for each stage (AGL-3596).
        const label =
          !site || !ledger
            ? row.label
            : ledger.op === 'theme'
              ? AI_SITE_LOOK_ROW_LABEL
              : ledger.op === 'layout'
                ? `Building the header and footer: ${ledger.label}`
                : ledger.op === 'form'
                  ? `Building the form: ${ledger.label}`
                  : ledger.op === 'page'
                    ? `Writing page ${pages.indexOf(ledger) + 1} of ${pages.length}: ${ledger.label}`
                    : ledger.op === 'email'
                      ? 'Writing your welcome email'
                      : row.label
        const screen = ledger?.op === 'page' ? aiPlanScreenFor(job.plan, ledger.label, pages.indexOf(ledger)) : null
        const finished = row.state === 'done' || row.state === 'failed'
        const net = ledger ? Math.max(0, Math.floor((ledger.creditsSpent ?? 0) - (ledger.creditsRefunded ?? 0))) : 0
        return {
          id: row.slot,
          label,
          state: row.state,
          // A part that failed while the rest is still being built says the
          // build goes on (AGL-3596): read alone, it looked like the site had.
          detail:
            row.state === 'failed' && phase === 'working'
              ? [row.detail, site ? 'The rest of your site keeps building.' : 'The rest keeps building.'].filter(Boolean).join(' ')
              : row.detail,
          ...(row.state === 'active'
            ? {
                startedAt: row.startedAt ?? null,
                hint:
                  ledger?.op === 'page'
                    ? AI_SITE_PAGE_HINT
                    : site && ledger?.op === 'theme'
                      ? AI_SITE_LOOK_HINT
                      : AI_SITE_ITEM_HINT,
              }
            : {}),
          ...(screen?.sections.length ? { sections: screen.sections.map((section) => section.name) } : {}),
          ...(finished && ledger ? { credits: net } : {}),
        }
      }),
      ...aiSitePublishRow(job, phase),
    ]
  }
  const planStep = job.steps.find((step) => step.name === 'plan')
  const planDone = planStep?.status === 'done' || Boolean(job.plan)
  const stopped = phase === 'failed' || phase === 'stopped'
  const paused = job.status === 'needs_input'
  const planState: AiSiteBuildRowState = planDone
    ? 'done'
    : paused
      ? 'paused'
      : stopped
        ? 'failed'
        : phase === 'working'
          ? 'active'
          : 'waiting'
  const rows: AiSiteBuildRow[] = [
    {
      id: 'plan',
      label: 'Planning your pages',
      state: planState,
      startedAt: planStep?.startedAt ?? null,
      hint: planState === 'active' ? AI_SITE_PLAN_HINT : null,
      ...(planDone && planStep ? { credits: Math.max(0, Math.floor(planStep.creditsSpent ?? 0)) } : {}),
    },
  ]
  // Before there is a plan, the stages a guided start always goes through
  // are named from its answers, so the page shows the whole way from the
  // start rather than one row.
  if (!job.plan && job.kind !== 'build') {
    const pagesAsked = typeof job.siteInputs?.['pages'] === 'number' ? Math.round(job.siteInputs['pages'] as number) : 0
    if (job.siteInputs) {
      // The look is designed first, before the header and footer (AGL-3660).
      rows.push({ id: 'look', label: AI_SITE_LOOK_ROW_LABEL, state: 'waiting' })
      rows.push({ id: 'layout', label: 'Building the header and footer', state: 'waiting' })
      // A guided start that says where its contact form's submissions go
      // plans that form, built after the layout and before the pages (AGL-3596).
      const submissions = job.siteInputs['submissions']
      if (submissions === 'inbox' || submissions === 'lead') {
        rows.push({ id: 'form', label: 'Building your contact form', state: 'waiting' })
      }
      rows.push({
        id: 'pages',
        label: pagesAsked > 1 ? `Writing your ${pagesAsked} pages` : 'Writing your pages',
        state: 'waiting',
      })
      rows.push(...aiSitePublishRow(job, phase))
    }
    return rows
  }
  const built = new Map<string, number>()
  for (const output of job.outputs) built.set(output.resource, (built.get(output.resource) ?? 0) + 1)
  const take = (resource: string): boolean => {
    const left = built.get(resource) ?? 0
    if (left <= 0) return false
    built.set(resource, left - 1)
    return true
  }
  const stages: Array<{ id: string; label: string; resource: string; sections?: string[]; hint?: string }> = []
  // A scaffold designs its look first on every start (AGL-3660), and writes
  // its item ledger only with that first pass's outcome — so while the look
  // is being designed, the job is read here, without a ledger, and the look
  // is the stage it is on: a moving site job that has built nothing yet. A
  // job read without its ledger that has built something and no look is one
  // from before the look had a unit of its own, and has the stage only where
  // it built one.
  const moving = (phase === 'working' || paused) && job.outputs.length === 0
  for (const row of CREATION_ROWS) {
    const creation = job.plan?.create.find((entry) => entry.kind === row.kind)
    const look = row.resource === 'theme'
    if (
      creation ||
      (look && job.kind !== 'build' && moving) ||
      (look && job.outputs.some((output) => output.resource === 'theme'))
    ) {
      stages.push({
        id: look ? 'look' : row.resource,
        label: row.label(creation?.name ?? ''),
        resource: row.resource,
        ...(look ? { hint: AI_SITE_LOOK_HINT } : {}),
      })
    }
  }
  const pages = job.plan?.screens ?? []
  pages.forEach((page, index) => {
    stages.push({
      id: `page-${index}`,
      label: `Writing page ${index + 1} of ${pages.length}: ${page.title}`,
      resource: 'screen',
      sections: page.sections.map((section) => section.name),
    })
  })
  // The build step's start: when the first stage after the plan began.
  const buildStartedAt = job.steps.find((step) => step.name !== 'plan' && step.startedAt)?.startedAt ?? null
  let reached = false
  for (const stage of stages) {
    const done = phase === 'done' || take(stage.resource)
    const current = !done && !reached && planDone
    if (current) reached = true
    const state: AiSiteBuildRowState = done
      ? 'done'
      : current && paused
        ? 'paused'
        : current && stopped
          ? 'failed'
          : current && phase === 'working'
            ? 'active'
            : 'waiting'
    rows.push({
      id: stage.id,
      label: stage.label,
      state,
      ...(state === 'active' && stage.hint ? { hint: stage.hint, startedAt: buildStartedAt } : {}),
      ...(stage.sections?.length ? { sections: stage.sections } : {}),
    })
  }
  rows.push(...aiSitePublishRow(job, phase))
  return rows
}

/** The row the site's look is designed on (AGL-3660). */
export const AI_SITE_LOOK_ROW_LABEL = 'Designing your look'

/** What the look's row says while it runs. */
export const AI_SITE_LOOK_HINT =
  'Choosing a base theme, colors, fonts and the style of your buttons, cards and forms for your kind of site. This takes a few seconds.'

/** What the planning row says while it runs. */
export const AI_SITE_PLAN_HINT =
  'Reading your answers and choosing your pages, what each one says, and the forms and layout they need. This usually takes under a minute.'

/** What the page being written says while it is the active row (AGL-3596). */
export const AI_SITE_PAGE_HINT =
  'Writing this page’s sections from your plan. It is done once every section is in.'

/** What any other part being built says while it is the active row. */
export const AI_SITE_ITEM_HINT = 'Building this now. The next step starts when it is done.'

/** The plan's page an item builds: by its title, else by its place among the pages. */
function aiPlanScreenFor(
  plan: AiJobSummary['plan'],
  title: string,
  index: number,
): NonNullable<AiJobSummary['plan']>['screens'][number] | null {
  const screens = plan?.screens ?? []
  return screens.find((screen) => screen.title === title) ?? (index >= 0 ? (screens[index] ?? null) : null)
}

/**
 * A guided start ends by putting its pages live (AGL-3596): the last row, so
 * the person sees that step coming and when it is done. Only a site job
 * publishes on its own; a build publishes when asked, and says so in its plan.
 */
function aiSitePublishRow(
  job: Pick<AiJobSummary, 'status'> & Partial<Pick<AiJobSummary, 'kind' | 'sitePublish'>>,
  phase: AiSiteBuildPhase,
): AiSiteBuildRow[] {
  if (job.kind !== 'site') return []
  const published = (job.sitePublish?.published.length ?? 0) > 0
  return [
    {
      id: 'publish',
      label: 'Publishing your site',
      // A job that stopped or failed publishes nothing, so the row is passed over.
      state: phase === 'done' ? (published ? 'done' : 'skipped') : phase === 'working' ? 'waiting' : 'skipped',
    },
  ]
}

/**
 * How far the job is, from 0 to 1, by its rows: a finished row counts whole
 * and the active one half. `null` before there is more than one row to count.
 */
export function aiSiteBuildFraction(rows: readonly AiSiteBuildRow[]): number | null {
  if (rows.length < 2) return null
  const counted = rows.reduce(
    (sum, row) => sum + (row.state === 'active' ? 0.5 : row.state === 'waiting' || row.state === 'paused' ? 0 : 1),
    0,
  )
  return Math.min(1, counted / rows.length)
}

/**
 * The job's one price (AGL-3594), never a plan's on its own: what it has used
 * so far while it works, what it used once done, and, on a failure we gave
 * back, that nothing was charged.
 */
export function aiSiteBuildCreditsLine(
  job: Pick<AiJobSummary, 'status' | 'creditsSpent' | 'refundedCredits'> & Partial<Pick<AiJobSummary, 'kind'>>,
): string | null {
  const spent = Math.max(0, job.creditsSpent ?? 0)
  const refunded = Math.max(0, job.refundedCredits ?? 0)
  const net = Math.max(0, spent - refunded)
  const phase = aiSiteBuildPhase(job)
  // What the job made, by its kind; a job that names none is a site's.
  const subject = !job.kind || job.kind === 'site' ? 'This site' : aiJobKindNoun(job.kind) === 'AI job' ? 'This AI job' : `This ${aiJobKindNoun(job.kind)}`
  // A failure on our side says so in the words every surface uses (AGL-3596),
  // from the job's recorded give-back.
  const refund = phase === 'working' || phase === 'done' ? null : aiJobRefundCopy(job)
  if (refund && refunded > 0) return refund
  // A person's cancel keeps what ran charged, and says how much (AGL-3616).
  if (phase === 'canceled') return aiJobCanceledCreditsCopy(job)
  if (phase === 'done') return `${subject} used ${net} credits.`
  if (phase === 'working') return `Credits used so far: ${net}`
  if (refund) return `${subject} used ${net} credits. ${refund}`
  return net > 0 ? `${subject} used ${net} credits.` : null
}

/** The heading and the sentence under it, for one job's page in its current phase. */
export interface AiJobPageCopy {
  heading: string
  lede: string
}

/**
 * What one job's page says at the top (AGL-3594, AGL-3596). A site job reads
 * as "Building your site"; any other kind names what it makes — "Building
 * your page" — or, for a kind with no noun, the job itself.
 *
 * A guided site start publishes its pages when it finishes, and says so
 * (`sitePublish`): with a page live the heading is "Your site is live". A
 * done site job without that record — an older job, or one that was not a
 * guided start — built drafts, and says that instead.
 */
export function aiJobPageCopy(
  job: Pick<AiJobSummary, 'kind' | 'status' | 'review' | 'error'> &
    Partial<Pick<AiJobSummary, 'sitePublish' | 'items' | 'outputs'>>,
  brand: string,
): AiJobPageCopy {
  const phase = aiSiteBuildPhase(job)
  // Paused by the meter (AGL-3660): why, what is already built, and that it
  // carries on — never "was not built", which read as a dead end.
  if (job.status === 'needs_input') {
    return {
      heading: aiJobPausedTitle(job.kind),
      lede: [job.error, aiJobBuiltSoFar(job), AI_JOB_PAUSED_NEXT_COPY].filter(Boolean).join(' '),
    }
  }
  // A build is what the person asked for, item by item (AGL-3616).
  if (job.kind === 'build') return aiBuildPageCopy(job, brand)
  const noun = job.kind === 'site' ? 'site' : aiJobKindNoun(job.kind)
  const generic = noun === 'AI job'
  // `products` is the one plural noun.
  const isAre = noun.endsWith('s') ? 'are' : 'is'
  const why = job.review?.message ?? job.error ?? null
  if (phase === 'working') {
    return {
      heading: generic ? 'Your AI job is running' : `Building your ${noun}`,
      lede:
        job.kind === 'site'
          ? `${brand} AI is planning your pages and writing each one. You can leave this page; it keeps going.`
          : `${brand} AI is working on it. You can leave this page; it keeps going.`,
    }
  }
  if (phase === 'done') {
    const published = job.sitePublish?.published.length ?? 0
    // Part of the site was built (AGL-3616): what was, what was not, and its credits.
    const partial = job.kind === 'site' ? aiSitePartialCopy({ items: job.items, status: job.status }) : null
    if (job.kind === 'site' && published > 0) {
      return {
        heading: 'Your site is live',
        lede: [
          partial,
          job.sitePublish?.drafts.length
            ? 'Your pages are published, except the ones listed below, which stayed drafts.'
            : 'Your pages are published, and anyone can visit your site now.',
        ]
          .filter(Boolean)
          .join(' '),
      }
    }
    if (partial) return { heading: 'Your site is ready', lede: `${partial} Your new pages are drafts. Publish them when you’re happy.` }
    if (job.kind === 'site' && job.sitePublish) {
      return {
        heading: 'Your site is ready',
        lede: 'None of your new pages could be published, so they are drafts. The reasons are below.',
      }
    }
    return {
      heading: generic ? 'Your AI job finished' : `Your ${noun} ${isAre} ready`,
      lede:
        job.kind === 'site'
          ? 'Your new pages are drafts. Publish them when you’re happy.'
          : 'Everything it built is an unpublished draft until you publish it.',
    }
  }
  if (phase === 'canceled') {
    return { heading: generic ? 'Your AI job was canceled' : `You canceled your ${noun}`, lede: AI_JOB_CANCELED_LEDE }
  }
  return {
    heading: generic ? 'Your AI job stopped' : `Your ${noun} ${noun.endsWith('s') ? 'were' : 'was'} not built`,
    lede: why ?? (generic ? 'Something went wrong running this job.' : `Something went wrong building your ${noun}.`),
  }
}

const joinWords = (names: string[]): string =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

/**
 * What a job has already built, in a sentence (AGL-3660): its look, the header
 * and footer, its form, its pages — from the item ledger where it has one,
 * else from what it has reported as outputs. `null` when it has built nothing.
 */
export function aiJobBuiltSoFar(
  job: Pick<AiJobSummary, 'kind'> & Partial<Pick<AiJobSummary, 'items' | 'outputs'>>,
): string | null {
  const built = (job.items ?? []).filter((row) => row.status === 'succeeded' || row.status === 'degraded')
  const names: string[] = []
  if (job.items?.length) {
    for (const row of built) {
      if (row.op === 'theme') names.push('your look')
      else if (row.op === 'layout') names.push('the header and footer')
      else if (row.op === 'form') names.push(`the form “${row.label}”`)
      else if (row.op === 'page') names.push(`the page “${row.label}”`)
      else if (row.op === 'email') names.push('your welcome email')
      else names.push(`${aiBuildOpNoun(row.op).toLowerCase()} “${row.label}”`)
    }
  } else {
    const outputs = job.outputs ?? []
    const count = (resource: string) => outputs.filter((output) => output.resource === resource).length
    if (count('theme')) names.push('your look')
    if (count('layout')) names.push('the header and footer')
    if (count('form')) names.push(count('form') === 1 ? 'the form' : `${count('form')} forms`)
    const pages = count('screen')
    if (pages) names.push(pages === 1 ? '1 page' : `${pages} pages`)
  }
  return names.length ? `Built so far: ${joinWords(names)}.` : null
}

/** A build's page heading and sentence (AGL-3616). */
function aiBuildPageCopy(
  job: Pick<AiJobSummary, 'status' | 'review' | 'error'> & Partial<Pick<AiJobSummary, 'items' | 'sitePublish'>>,
  brand: string,
): AiJobPageCopy {
  const phase = aiSiteBuildPhase(job)
  const outcome = aiBuildOutcomeLine({ items: job.items ?? [], status: job.status })
  if (phase === 'working') {
    return {
      heading: 'Building what you asked for',
      lede: `${brand} AI is building each part in turn. You can leave this page; it keeps going.`,
    }
  }
  if (phase === 'stopped') {
    return {
      heading: job.review?.reason === 'plan' ? 'Your plan is ready' : 'Your build needs you',
      lede: job.review?.message ?? job.error ?? 'It waits for your decision.',
    }
  }
  if (phase === 'done') {
    const failed = (job.items ?? []).some((row) => row.status === 'failed' || row.status === 'skipped')
    const live = job.sitePublish?.published.length ?? 0
    return {
      heading: failed ? 'Most of it is ready' : 'Everything you asked for is ready',
      lede: [
        outcome,
        live ? 'Your new pages are published.' : 'Everything it built is an unpublished draft until you publish it.',
        failed ? 'Try again builds only what failed.' : '',
      ]
        .filter(Boolean)
        .join(' '),
    }
  }
  if (phase === 'canceled') return { heading: 'Your build was canceled', lede: AI_JOB_CANCELED_LEDE }
  return {
    heading: 'Nothing could be built',
    lede: [job.error ?? 'Something went wrong building what you asked for.', outcome].filter(Boolean).join(' '),
  }
}
