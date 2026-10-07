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

import { checkEntitlement } from '@aglyn/aglyn'
import { trackEvent } from '@aglyn/aglyn/app-utils/analytics-events'
import { formatBytes } from '@aglyn/aglyn/app-utils/measure-node-map'
import {
  AI_JOB_TERMINAL_STATUSES,
  type AiJobOutput,
  type AiJobSummary,
} from '../model/ai-jobs.types'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import { mdiChevronDown, mdiChevronUp } from '@aglyn/shared-data-mdi'
import { AppLink, MdiIcon } from '@aglyn/shared-ui-jsx'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  IconButton,
  Stack,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AI_JOB_PHASE_LABELS,
  aiJobActivityCounts,
  aiJobPhase,
  aiJobsHeaderChips,
  type AiJobActivityState,
  type AiJobPhase,
} from '../model/ai-job-activity'
import type { AiInsightSurface } from '../model/ai-insight'
import { cancelAiJobRequest, resumeAiJobRequest, type AiJobResumeOptions } from './ai-job-requests'
import { aiBuildCanRetry, aiBuildItemRows, aiSitePartialCopy } from '../model/ai-build-progress'
import { publishAiJob, type AiJobsOpenRequest } from './ai-jobs-store'
import { AiPageBriefDialog } from './ai-page-brief-dialog.component'
import { AiInsightDialog } from './ai-insight-dialog.component'
import { AiJobPlan } from './ai-job-plan.component'
import { aiJobOutputHref, aiJobPrimaryLink, aiSiteBuildHref } from './ai-job-links'
import { aiJobRefundCopy } from '../model/ai-job-failure-copy'
import { readEventFrames } from './ai-job-events'

// Where an output opens, and the stream reader, live beside the dialogs that
// share them (AGL-3593); this module has always exported them.
export { aiJobOutputHref, aiJobPrimaryLink, readEventFrames }

/**
 * The AI jobs drawer inside the Assist panel (AGL-2904): the workspace's
 * running and recent generation jobs, each step's progress, an "open
 * draft" link per output, and cancel.
 *
 * Reads through the routes, never Firestore directly, so the same
 * membership, flag and entitlement rungs answer every read; progress comes
 * from the events route's server-sent stream, re-opened when the server
 * says `reconnect`. Everything loads on EXPAND rather than on mount: the
 * panel opens on every console page, and a list nobody asked for is a read
 * on every page view.
 *
 * It opens EXPANDED while any of the workspace's jobs is moving or waiting
 * for the person (AGL-3593) — the shared list the top-bar indicator reads
 * says so — because a plan waiting behind a collapsed row is a site that
 * never gets built. An "Open AI jobs" anywhere in the console expands it,
 * scrolls to the job it names and highlights it for a moment.
 *
 * Hidden — not disabled — unless the flag shows it AND the plan carries
 * `aiGenerative`: a released-off feature does not exist, and a plan without
 * it is sold the add-on on the Billing page, not here.
 */

/** Jobs the drawer lists; the route caps higher, the drawer is a glance. */
const LIST_LIMIT = 10

/** How much of a brief a row shows. */
const BRIEF_PREVIEW_CHARS = 90

/**
 * A row's chip says where the job stands in the words every AI surface uses
 * (AGL-3593): a plan waiting to be confirmed is "Plan ready", never "Running"
 * and never the machine's `needs_review`.
 */
const PHASE_COLOR: Record<AiJobPhase, 'default' | 'primary' | 'success' | 'error' | 'warning'> = {
  queued: 'default',
  planning: 'primary',
  'plan-ready': 'warning',
  building: 'primary',
  attention: 'warning',
  done: 'success',
  failed: 'error',
  canceled: 'default',
}

/** The header's count chips, colored as the rows they count. */
const STATE_COLOR: Record<AiJobActivityState, 'primary' | 'warning'> = {
  'needs-you': 'warning',
  attention: 'warning',
  running: 'primary',
}

/** What each item state reads as in a row (AGL-3616). */
const ITEM_STATE_LABELS = {
  done: 'built',
  active: 'building',
  waiting: 'waiting',
  failed: 'failed',
  skipped: 'not built',
} as const

/** How long a job AI jobs was opened on stays highlighted. */
const HIGHLIGHT_MS = 2_500

/**
 * Where a guided start that ended unbuilt is tried again (AGL-3596): its
 * "Building your site" page, opened on its own answers (`?retry=1`). Only for
 * a job of the site the console is on, whose subdomain the address names;
 * `null` otherwise.
 */
export function aiJobRestartHref(
  job: Pick<AiJobSummary, 'id' | 'kind' | 'status' | 'hostId' | 'siteInputs'>,
  input: { orgSlug: string; hostId?: string | null; pathname: string },
): string | null {
  if (job.kind !== 'site' || (job.status !== 'failed' && job.status !== 'canceled')) return null
  if (!job.siteInputs || !job.hostId || job.hostId !== input.hostId) return null
  const subdomain = /^\/[^/]+\/hosts\/([^/?#]+)/.exec(input.pathname)?.[1] ?? null
  const href = aiSiteBuildHref(input.orgSlug, subdomain, job.id)
  return href ? `${href}?retry=1` : null
}

/** What a job cost the person: what it spent, less what we refunded. */
function netCredits(job: Pick<AiJobSummary, 'creditsSpent' | 'refundedCredits'>): number {
  return Math.max(0, (job.creditsSpent ?? 0) - (job.refundedCredits ?? 0))
}

/**
 * The navigation entry a page job proposes for the page it built (AGL-2907),
 * or `null`. The job writes no menu: the member adds the entry once the page
 * is live.
 */
export function aiJobNavigationProposal(output: AiJobOutput): string | null {
  if (output.resource !== 'screen') return null
  const navigation = output.proposal?.['navigation']
  if (!navigation || typeof navigation !== 'object') return null
  const label = (navigation as Record<string, unknown>)['label']
  return typeof label === 'string' && label.trim() ? label.trim() : null
}


export interface AssistJobsDrawerProps {
  /** The org the panel is scoped to — `undefined` where the page named none. */
  orgId: string | undefined
  org: Partial<AglynOrgBilling> | undefined
  orgReady: boolean
  orgSlug: string
  user: Parameters<typeof authorizedFetch>[0]
  /** The `release_ai_generative` verdict, staff bypass applied (the shell's). */
  visible: boolean
  /**
   * The viewer is staff (AGL-3078): a job that stopped for a broken rule shows
   * them where the refused answer broke it. Who may read a job is unchanged.
   */
  isStaff?: boolean
  /** The site the console page is on, when it is on one: a page is described for a site. */
  hostId?: string | null
  /**
   * The page's insight surface (AGL-2915) — a site's Analytics, Data or CRM
   * Reports page, or the workspace's Data page — with the site's subdomain;
   * `null` elsewhere, where no question about the figures is offered.
   */
  insight?: { surface: Exclude<AiInsightSurface, 'digest'>; host: string | null } | null
  /**
   * The workspace's jobs that are not yet settled, from the shared store the
   * top-bar indicator reads (AGL-3593). The header counts them, and the
   * drawer opens expanded while there is any. Absent, the drawer counts what
   * it loaded itself.
   */
  inFlight?: readonly AiJobSummary[]
  /**
   * The latest request to open AI jobs (AGL-3593): a new `seq` expands the
   * drawer, and a named job is scrolled to and highlighted.
   */
  focus?: AiJobsOpenRequest | null
}

export function AssistJobsDrawer({
  orgId,
  org,
  orgReady,
  orgSlug,
  user,
  visible,
  isStaff = false,
  hostId,
  insight,
  inFlight,
  focus,
}: AssistJobsDrawerProps): JSX.Element | null {
  const entitled = orgReady && checkEntitlement(org as never, 'aiGenerative')
  const [expanded, setExpanded] = useState(false)
  /**
   * The person opened or closed the list themselves: from then on the
   * expanded-by-default rule leaves their choice alone until the workspace
   * changes.
   */
  const toggledRef = useRef(false)
  /** The job AI jobs was opened on, highlighted for a moment once it is listed. */
  const [highlight, setHighlight] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const [jobs, setJobs] = useState<AiJobSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  /** Whether the page brief dialog is open (AGL-2907). */
  const [describing, setDescribing] = useState(false)
  /**
   * The insight dialog (AGL-2915): `'ask'` for a new question, a job id for an
   * answer a job already wrote, `null` when closed.
   */
  const [insightOpen, setInsightOpen] = useState<string | null>(null)
  /** Job ids whose terminal event has been tracked, so a re-read does not count twice. */
  const trackedRef = useRef(new Set<string>())
  /** The job whose stream is open, so a re-render does not open a second. */
  const watchingRef = useRef<string | null>(null)

  const patchJob = useCallback((next: AiJobSummary) => {
    // Every counting surface moves with the row (AGL-3593).
    publishAiJob(next)
    setJobs((prior) => {
      const index = prior.findIndex((job) => job.id === next.id)
      if (index === -1) return [next, ...prior].slice(0, LIST_LIMIT)
      const copy = [...prior]
      copy[index] = next
      return copy
    })
    if (
      AI_JOB_TERMINAL_STATUSES.includes(next.status) &&
      !trackedRef.current.has(next.id)
    ) {
      trackedRef.current.add(next.id)
      if (next.status === 'done') {
        trackEvent('ai_job_completed', { kind: next.kind, credits: next.creditsSpent })
      } else if (next.status === 'failed') {
        trackEvent('ai_job_failed', { kind: next.kind })
      }
    }
  }, [])

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setNotice(null)
    try {
      const response = await authorizedFetch(
        user,
        `/api/ai/jobs?orgId=${encodeURIComponent(orgId)}&limit=${LIST_LIMIT}`,
      )
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        setNotice(String(payload?.error ?? 'The AI jobs could not be loaded — try again.'))
        return
      }
      const payload = (await response.json()) as { jobs: AiJobSummary[] }
      // Every job that arrives already terminal is one the drawer did not
      // watch finish, so its outcome is not this session's to count.
      for (const job of payload.jobs) {
        if (AI_JOB_TERMINAL_STATUSES.includes(job.status)) trackedRef.current.add(job.id)
        // A job the indicator still counts that has settled since leaves it.
        publishAiJob(job)
      }
      setJobs(payload.jobs)
    } catch {
      setNotice('The AI jobs could not be loaded — try again.')
    } finally {
      setLoading(false)
    }
  }, [orgId, user])

  useEffect(() => {
    if (expanded) void load()
  }, [expanded, load])

  // Reset when the panel's org changes: a list from one workspace must not
  // show under another's key while the new one loads.
  useEffect(() => {
    setJobs([])
    setExpanded(false)
    toggledRef.current = false
    watchingRef.current = null
  }, [orgId])

  // Expanded by default while anything is moving or waiting (AGL-3593): a
  // plan waiting to be confirmed behind a collapsed row is a site that never
  // gets built. Otherwise collapsed, which reads nothing until asked.
  const anyInFlight = (inFlight?.length ?? 0) > 0
  useEffect(() => {
    if (anyInFlight && !toggledRef.current) setExpanded(true)
  }, [anyInFlight])

  // A request to open AI jobs (AGL-3593): expand, read the list again so a
  // job created a moment ago is in it, and highlight the job named.
  const focusSeq = focus?.seq ?? 0
  const focusJobId = focus?.jobId ?? null
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded
  useEffect(() => {
    if (!focusSeq) return
    toggledRef.current = true
    setHighlight(focusJobId)
    // An open list does not re-run the expand effect's read, so it reads here.
    if (expandedRef.current) void load()
    else setExpanded(true)
    // Only a new request runs this; `load` and the job are read as they stand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSeq])

  // Scroll to the highlighted job once it is listed, then let it fade.
  const highlightListed = highlight !== null && jobs.some((job) => job.id === highlight)
  useEffect(() => {
    if (!highlight || !highlightListed) return undefined
    const row = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[data-ai-job-id]') ?? [],
    ).find((element) => element.dataset['aiJobId'] === highlight)
    row?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    const timer = setTimeout(() => setHighlight(null), HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [highlight, highlightListed])

  // Watch the most recent job that is still moving. One stream at a time:
  // the route re-reads a document every two seconds per open stream, and a
  // drawer with three running jobs does not need three of them.
  const watched = jobs.find((job) => !AI_JOB_TERMINAL_STATUSES.includes(job.status))
  const watchedId = watched?.id ?? null
  useEffect(() => {
    if (!expanded || !orgId || !watchedId || watchingRef.current === watchedId) return
    watchingRef.current = watchedId
    const controller = new AbortController()
    const watch = async () => {
      // The server closes a stream at its deadline with `reconnect`; the
      // loop here re-opens it until the job settles or the drawer unmounts.
      let again = true
      while (again && !controller.signal.aborted) {
        again = false
        try {
          const response = await authorizedFetch(
            user,
            `/api/ai/jobs/${encodeURIComponent(watchedId)}/events?orgId=${encodeURIComponent(orgId)}`,
            { signal: controller.signal },
          )
          if (!response.ok || !response.body) return
          await readEventFrames(response.body, (event) => {
            if (event['type'] === 'state') patchJob(event['job'] as AiJobSummary)
            else if (event['type'] === 'reconnect') again = true
            else if (event['type'] === 'gone') {
              setJobs((prior) => prior.filter((job) => job.id !== watchedId))
            }
          })
        } catch {
          // The stream ended without a terminal state — a network blip or
          // the drawer closing. The next expand reloads the list.
          return
        }
      }
    }
    void watch().finally(() => {
      if (watchingRef.current === watchedId) watchingRef.current = null
    })
    return () => {
      controller.abort()
      if (watchingRef.current === watchedId) watchingRef.current = null
    }
  }, [expanded, orgId, watchedId, user, patchJob])

  // The same door the dialog that started the job cancels through (AGL-3593).
  const cancel = useCallback(
    async (jobId: string) => {
      if (!orgId) return
      const { job, error } = await cancelAiJobRequest(user, orgId, jobId)
      if (error) {
        setNotice(error)
        return
      }
      if (job) patchJob(job)
    },
    [orgId, user, patchJob],
  )

  /** The job whose resume is in flight, so its button cannot send twice. */
  const [resuming, setResuming] = useState<string | null>(null)

  // Confirms a plan, or tries again a step whose answer broke a building
  // rule (AGL-2935). The door runs the next step inline and answers with the
  // job, so the row moves on without waiting for the stream.
  const resume = useCallback(
    async (job: AiJobSummary, options?: AiJobResumeOptions) => {
      if (!orgId) return
      setResuming(job.id)
      setNotice(null)
      // The same door the dialog that started the job confirms through (AGL-3593).
      const { job: next, error } = await resumeAiJobRequest(user, orgId, job, options)
      if (next) patchJob(next)
      if (error) setNotice(error)
      setResuming(null)
    },
    [orgId, user, patchJob],
  )

  if (!visible || !orgId || !entitled) return null

  // Counted by state, never as one "running" figure (AGL-3593): a plan waiting
  // to be confirmed needs the person, and a stopped job is not moving.
  const chips = aiJobsHeaderChips(aiJobActivityCounts(inFlight ?? jobs))

  return (
    <Box sx={{ mb: 2, borderBottom: 1, borderColor: 'divider', pb: 1 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
          AI jobs
          {chips.map((chip) => (
            <Chip
              key={chip.state}
              size="small"
              color={STATE_COLOR[chip.state]}
              label={chip.label}
              sx={{ ml: 1 }}
            />
          ))}
        </Typography>
        {/* A question about the page's figures (AGL-2915). */}
        {insight && (
          <Button size="small" onClick={() => setInsightOpen('ask')}>
            Ask about your numbers
          </Button>
        )}
        {/* A page from a brief (AGL-2907), on a site's own routes. */}
        {hostId && (
          <Button size="small" onClick={() => setDescribing(true)}>
            Describe a page
          </Button>
        )}
        <IconButton
          size="small"
          aria-label={expanded ? 'Hide AI jobs' : 'Show AI jobs'}
          aria-expanded={expanded}
          onClick={() => {
            toggledRef.current = true
            setExpanded((prior) => !prior)
          }}
        >
          <MdiIcon
            path={expanded ? mdiChevronUp.path : mdiChevronDown.path}
            sx={{ fontSize: 18 }}
          />
        </IconButton>
      </Stack>
      <Collapse in={expanded} unmountOnExit>
        {notice && (
          <Typography variant="caption" color="error" component="div" sx={{ mt: 0.5 }}>
            {notice}
          </Typography>
        )}
        {loading && !jobs.length && (
          <CircularProgress size={16} sx={{ mt: 1 }} aria-label="Loading AI jobs" />
        )}
        {!loading && !jobs.length && !notice && (
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
            No AI jobs yet.
          </Typography>
        )}
        <Stack ref={listRef} spacing={1} sx={{ mt: 1 }} role="list" aria-label="AI jobs">
          {jobs.map((job) => {
            const restartHref = (row: AiJobSummary) =>
              aiJobRestartHref(row, {
                orgSlug,
                hostId,
                pathname: typeof window === 'undefined' ? '' : window.location.pathname,
              })
            const stepsDone = job.steps.filter((step) => step.status === 'done').length
            const current = job.steps.find((step) => step.status === 'running')
            const terminal = AI_JOB_TERMINAL_STATUSES.includes(job.status)
            const phase = aiJobPhase(job)
            const primary = aiJobPrimaryLink(job, orgSlug)
            const highlighted = highlight === job.id
            return (
              <Box
                key={job.id}
                role="listitem"
                data-ai-job-id={job.id}
                aria-current={highlighted ? 'true' : undefined}
                sx={{
                  borderRadius: 1,
                  bgcolor: highlighted ? 'action.selected' : 'action.hover',
                  outline: 2,
                  outlineColor: highlighted ? 'primary.main' : 'transparent',
                  transition: (theme) =>
                    theme.transitions.create(['background-color', 'outline-color'], {
                      duration: theme.transitions.duration.standard,
                    }),
                  px: 1.5,
                  py: 1,
                }}
              >
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Chip size="small" variant="outlined" label={job.kind} />
                  <Chip size="small" color={PHASE_COLOR[phase]} label={AI_JOB_PHASE_LABELS[phase]} />
                  <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
                    {stepsDone}/{job.steps.length} steps
                    {current ? ` — ${current.name}` : ''}
                    {/* Net of what a failure on our side gave back (AGL-3594). */}
                    {netCredits(job) > 0 ? ` · ${netCredits(job)} credits` : ''}
                  </Typography>
                  {!terminal && (
                    <Button size="small" onClick={() => void cancel(job.id)}>
                      Cancel
                    </Button>
                  )}
                </Stack>
                <Typography variant="body2" sx={{ mt: 0.5, wordBreak: 'break-word' }}>
                  {job.brief.length > BRIEF_PREVIEW_CHARS
                    ? `${job.brief.slice(0, BRIEF_PREVIEW_CHARS)}…`
                    : job.brief}
                </Typography>
                {job.error && (
                  <Typography variant="caption" color={job.status === 'failed' ? 'error' : 'warning.main'} component="div">
                    {job.error}
                  </Typography>
                )}
                {/* What became of its credits, from the job's recorded give-back (AGL-3596). */}
                {aiJobRefundCopy(job) && (
                  <Typography variant="caption" color="text.secondary" component="div">
                    {aiJobRefundCopy(job)}
                  </Typography>
                )}
                {/* A site that built part of itself says what, and that the rest was on us (AGL-3616). */}
                {aiSitePartialCopy(job) && (
                  <Typography variant="caption" color="text.secondary" component="div">
                    {aiSitePartialCopy(job)}
                  </Typography>
                )}
                {/* A build, item by item: where each stands, and what became of its credits (AGL-3616). */}
                {job.items?.length ? (
                  <Box component="ul" aria-label="Items" sx={{ m: 0, mt: 0.5, pl: 2 }}>
                    {aiBuildItemRows(job).map((row) => (
                      <Typography key={row.slot} component="li" variant="caption" data-item-state={row.state}>
                        {`${row.label} — ${ITEM_STATE_LABELS[row.state]}`}
                        {row.detail ? `. ${row.detail}` : ''}
                      </Typography>
                    ))}
                  </Box>
                ) : null}
                {aiBuildCanRetry(job) ? (
                  <Button
                    size="small"
                    variant="contained"
                    disabled={resuming === job.id}
                    onClick={() => void resume(job, { retry: 'failed-items' })}
                    sx={{ mt: 0.5 }}
                  >
                    {'Try again what failed'}
                  </Button>
                ) : null}
                {restartHref(job) ? (
                  <Button size="small" variant="contained" component={AppLink} href={restartHref(job) as string} sx={{ mt: 0.5 }}>
                    {'Try again'}
                  </Button>
                ) : null}
                {/* What a finished job built, first (AGL-3593). */}
                {primary ? (
                  <Button
                    size="small"
                    variant="contained"
                    component={AppLink}
                    href={primary.href}
                    sx={{ mt: 0.5 }}
                  >
                    {primary.label}
                  </Button>
                ) : null}
                {job.outputs.map((output, index) => {
                  const href = aiJobOutputHref(output, orgSlug)
                  const navigation = aiJobNavigationProposal(output)
                  return (
                    <Box key={`${output.resource}:${output.id}:${index}`} sx={{ mt: 0.5 }}>
                      {output.resource === 'insight' ? (
                        <Button size="small" onClick={() => setInsightOpen(output.id)}>
                          View answer
                        </Button>
                      ) : href ? (
                        <AppLink componentVariant="naked" href={href}>
                          Open draft — {output.label}
                        </AppLink>
                      ) : output.text ? (
                        <Typography
                          variant="body2"
                          component="pre"
                          sx={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', m: 0 }}
                        >
                          {output.text}
                        </Typography>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          {output.label}
                        </Typography>
                      )}
                      {output.load ? (
                        <Typography variant="caption" color="text.secondary" component="div">
                          About {formatBytes(output.load.totalBytes)} on a first visit
                        </Typography>
                      ) : null}
                      {output.note ? (
                        <Typography variant="caption" color="text.secondary" component="div">
                          {output.note}
                        </Typography>
                      ) : null}
                      {navigation ? (
                        <Typography variant="caption" color="text.secondary" component="div">
                          Add “{navigation}” to your navigation once the page is live.
                        </Typography>
                      ) : null}
                    </Box>
                  )
                })}
                <AiJobPlan
                  job={job}
                  onResume={(target, options) => void resume(target, options)}
                  busy={resuming === job.id}
                  staff={isStaff}
                  user={user}
                />
              </Box>
            )
          })}
        </Stack>
      </Collapse>
      {/*
        The brief dialog (AGL-2907). It starts a job and closes; the list
        below it is the only place the job is watched, so an open list reads
        the new job back as soon as the dialog hands it over.
      */}
      {insightOpen !== null && (
        <AiInsightDialog
          open
          onClose={() => {
            setInsightOpen(null)
            if (expanded) void load()
          }}
          orgId={orgId}
          orgSlug={orgSlug}
          hostId={insight?.host ? (hostId ?? null) : null}
          host={insight?.host ?? null}
          surface={insight?.surface ?? 'analytics'}
          user={user}
          uid={(user as { uid?: string } | null | undefined)?.uid ?? null}
          jobId={insightOpen === 'ask' ? null : insightOpen}
        />
      )}
      {hostId && (
        <AiPageBriefDialog
          open={describing}
          onClose={() => {
            setDescribing(false)
            if (expanded) void load()
          }}
          orgId={orgId}
          hostId={hostId}
          user={user}
          orgSlug={orgSlug}
          isStaff={isStaff}
        />
      )}
    </Box>
  )
}

export default AssistJobsDrawer
