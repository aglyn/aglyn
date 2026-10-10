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

'use client'

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn'
import { PageHeaderRecord } from '@aglyn/aglyn/app-utils/page-header-record-context'
import type { ConsolePluginPageProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import {
  mdiAlertCircle,
  mdiCheckCircle,
  mdiChevronDown,
  mdiClockOutline,
  mdiMinusCircleOutline,
  mdiPauseCircle,
} from '@aglyn/shared-data-mdi'
import { AppLink, MdiIcon } from '@aglyn/shared-ui-jsx'
import { newTabLinkProps } from '@aglyn/shared-ui-jsx/utils/new-tab'
import {
  SITE_LIVE_NOTICE_BODY,
  SITE_LIVE_NOTICE_TITLE,
  SiteLiveNotice,
} from '@aglyn/shared-ui-jsx/components/site-live-notice.component'
import type { MaybeTokenSource } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CircularProgress,
  Container,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import {
  aiJobPageCopy,
  aiSiteBuildCreditsLine,
  aiSiteBuildFraction,
  aiSiteBuildPhase,
  aiSiteBuildRows,
  type AiSiteBuildRowState,
} from '../model/ai-site-build-progress'
import { aiJobRefundCopy, aiSiteStarterFallbackOffered } from '../model/ai-job-failure-copy'
import { aiSiteStartAnswersFromInputs } from '../model/ai-site-start'
import { AiSiteStartCard } from './ai-site-start-card.component'
import { AI_JOB_TERMINAL_STATUSES, type AiJobSummary } from '../model/ai-jobs.types'
import { followAiJobEvents } from './ai-job-events'
import { aiCreditsBillingHref, aiSiteBuildDoneLinks } from './ai-job-links'
import { AiJobPlan } from './ai-job-plan.component'
import { aiBuildCanRetry, aiBuildRetryCreditRange } from '../model/ai-build-progress'
import { resumeAiJobRequest, type AiJobResumeOptions } from './ai-job-requests'
import { AiCreditsPromptNotice } from './ai-credits-prompt.component'
import { aiCreditRangeText, type AiCreditsPrompt } from '../model/ai-credit-estimate'
import { useAiJobSite } from './ai-job-site'
import { AiSiteStarterFallback } from './ai-site-starter-fallback.component'
import { AiJobCancelButton } from './ai-job-cancel.component'
import { AI_JOB_CANCELING_COPY } from '../model/ai-job-cancel-copy'

/**
 * "Building your site" (AGL-3594): one job's page, at `/ai-jobs/{jobId}`
 * under its site — where the guided start sends a person the moment they
 * plan a site, and where a notification about that job opens.
 *
 * A guided site start confirms its own plan (`autoConfirm`), so there is no
 * approval to make here: the page says what is happening, step by step, live
 * from the job's events route; shows what is being built; and, when the job
 * ends, leads with the next thing to do — the live site and the pages to
 * edit, or, where it stopped, the plain sentence for why and what to do
 * about it. It is linkable and survives a reload, because it reads the job by
 * the id in its own address under the site's own route.
 *
 * Every wait ends (AGL-3596): a site that cannot be read, a job the route
 * does not know, a route that fails, and a first state that never arrives
 * each end on a sentence instead of a spinner.
 *
 * Mounted by `AiJobsPage`, the plugin's unlisted `/ai-jobs` route: no tab on
 * the site's strip, an address under it.
 */

/** How long the job's first state may take before the page says it could not be loaded. */
export const AI_JOB_FIRST_STATE_TIMEOUT_MS = 20_000

/**
 * One job, followed by id: its latest summary; `null` while the first state
 * is out; `'missing'` when the route says there is no such job for this
 * reader; `'error'` when the route failed or no state arrived in time.
 */
export type AiJobByIdState = AiJobSummary | 'missing' | 'error' | null

/** Follows one job by id. `retry` follows it again after a `'missing'` or `'error'`. */
export function useAiJobById(
  user: MaybeTokenSource,
  orgId: string | null,
  jobId: string | null,
): [AiJobByIdState, (job: AiJobSummary) => void, () => void] {
  const userRef = useRef(user)
  userRef.current = user
  const [job, setJob] = useState<AiJobByIdState>(null)
  const [attempt, setAttempt] = useState(0)
  const status = job && typeof job === 'object' ? job.status : null
  // Followed until the job ENDS (AGL-3596), not until it first stops: a guided
  // start parks on its plan for the instant it takes to confirm it, and a page
  // that stopped following there showed that park — the plan's 13 credits and
  // "the plan is ready" — after the job had built, spent and failed.
  const moving = status === null || !AI_JOB_TERMINAL_STATUSES.includes(status)
  useEffect(() => {
    if (!orgId || !jobId || !moving) return undefined
    const controller = new AbortController()
    let heard = false
    const timer = setTimeout(() => {
      if (!heard) setJob((current) => current ?? 'error')
    }, AI_JOB_FIRST_STATE_TIMEOUT_MS)
    void followAiJobEvents(() => userRef.current, orgId, jobId, controller.signal, (next) => {
      heard = true
      setJob(next)
    }).then((end) => {
      if (heard || controller.signal.aborted) return
      const unheard: AiJobByIdState = end === 'not-found' ? 'missing' : 'error'
      setJob((current) => (current && typeof current === 'object' ? current : unheard))
    })
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [orgId, jobId, moving, attempt])
  const retry = useCallback(() => {
    setJob(null)
    setAttempt((count) => count + 1)
  }, [])
  return [job, setJob, retry]
}

const ROW_ICON: Readonly<Record<Exclude<AiSiteBuildRowState, 'active'>, { path: string; color: string; label: string }>> = {
  done: { path: mdiCheckCircle.path, color: 'success.main', label: 'Done' },
  waiting: { path: mdiClockOutline.path, color: 'text.disabled', label: 'Waiting' },
  failed: { path: mdiAlertCircle.path, color: 'error.main', label: 'Couldn’t be built' },
  skipped: { path: mdiMinusCircleOutline.path, color: 'text.disabled', label: 'Not built' },
  // Paused by the meter (AGL-3660): no spinner — it is not running.
  paused: { path: mdiPauseCircle.path, color: 'warning.main', label: 'Paused' },
}

function RowIcon({ state }: { state: AiSiteBuildRowState }) {
  if (state === 'active') {
    return <CircularProgress size={20} aria-label="In progress" />
  }
  const icon = ROW_ICON[state]
  return (
    <Box component="span" role="img" aria-label={icon.label} sx={{ color: icon.color, display: 'inline-flex', fontSize: (theme) => theme.spacing(2.5) }}>
      <MdiIcon path={icon.path} aria-hidden />
    </Box>
  )
}

/** The page's frame: the site's name over the heading and its sentence. */
/** "0:42", "3:05": how long the active row has been running, from when it started or was first seen. */
function useElapsed(key: string | null, startedAt: string | null | undefined): string | null {
  const [now, setNow] = useState(() => Date.now())
  const seen = useRef<{ key: string | null; at: number }>({ key: null, at: Date.now() })
  if (seen.current.key !== key) seen.current = { key, at: Date.now() }
  useEffect(() => {
    if (!key) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [key])
  if (!key) return null
  const started = startedAt ? Date.parse(startedAt) : NaN
  const from = Number.isFinite(started) ? Math.min(started, seen.current.at) : seen.current.at
  const seconds = Math.max(0, Math.floor((now - from) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function Frame({
  siteName,
  heading,
  lede,
  children,
}: {
  siteName?: string
  /** Left out when the content leads with a heading of its own. */
  heading?: string
  lede?: string
  children?: ReactNode
}) {
  return (
    <Container maxWidth="sm" sx={{ py: { xs: 3, sm: 5 }, px: { xs: 2, sm: 3 } }}>
      <Stack spacing={4}>
        <Stack spacing={1}>
          {siteName ? (
            <Typography variant="overline" color="text.secondary">
              {siteName}
            </Typography>
          ) : null}
          {heading ? (
            <Typography variant="h4" component="h1">
              {heading}
            </Typography>
          ) : null}
          {lede ? (
            <Typography variant="body1" color="text.secondary">
              {lede}
            </Typography>
          ) : null}
        </Stack>
        {children}
      </Stack>
    </Container>
  )
}

export function AiSiteBuildPage({ hostId, segments, basePath }: ConsolePluginPageProps) {
  const { data: user } = useUser()
  const jobId = segments?.[0] ? decodeURIComponent(String(segments[0])) : null
  const orgSlug = (basePath ?? '').split('/')[1] ?? ''
  // `/{orgSlug}/hosts/{subdomain}/ai-jobs`: the site's subdomain, which a console URL names it by.
  const hostSubdomain = (basePath ?? '').split('/')[3] || null
  const site = useAiJobSite(hostId)
  const orgId = site.status === 'ready' ? site.orgId : null
  const siteName = site.status === 'ready' ? site.name : undefined

  const [job, setJob, retry] = useAiJobById(user, orgId, jobId)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // A failed guided start's Try again reopens its questions, filled in (AGL-3596);
  // `?retry=1` — what the AI jobs drawer links — opens them on arrival.
  const [retrying, setRetrying] = useState(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('retry') === '1',
  )
  // A Free Try again past what is left (AGL-3722): its prompt, until chosen.
  const [retryPrompt, setRetryPrompt] = useState<AiCreditsPrompt | null>(null)
  const tryAgain = useCallback(
    async (options: { creditsConfirmed?: boolean } = {}) => {
      if (!orgId || !job || typeof job !== 'object') return
      setBusy(true)
      setNotice(null)
      setRetryPrompt(null)
      // A finished build tries again only what failed (AGL-3616).
      const retry = aiBuildCanRetry(job)
      const decision = await resumeAiJobRequest(user, orgId, job, retry ? { retry: 'failed-items', ...options } : {})
      if (decision.job) setJob(decision.job)
      if (decision.credits && retry) setRetryPrompt(decision.credits)
      else if (decision.error) setNotice(decision.error)
      setBusy(false)
    },
    [orgId, job, user, setJob],
  )
  const confirmPlan = useCallback(
    async (target: AiJobSummary, options: AiJobResumeOptions = {}) => {
      if (!orgId) return
      setBusy(true)
      setNotice(null)
      const decision = await resumeAiJobRequest(user, orgId, target, options)
      if (decision.job) setJob(decision.job)
      // A plan past what is left draws its own prompt from the job (AGL-3722).
      if (decision.error && !(decision.credits && target.status === 'needs_review')) setNotice(decision.error)
      setBusy(false)
    },
    [orgId, user, setJob],
  )

  const ready = job && typeof job === 'object' ? job : null
  const copy = ready ? aiJobPageCopy(ready, PLATFORM_BRAND_NAME) : null
  // The active row's running time, read before any early return (a hook).
  const liveRow =
    ready && aiSiteBuildPhase(ready) === 'working'
      ? (aiSiteBuildRows(ready).find((row) => row.state === 'active') ?? null)
      : null
  const elapsed = useElapsed(liveRow ? `${ready?.id}:${liveRow.id}` : null, liveRow?.startedAt)
  // The shell's header names the job's page as the page does, and its trail
  // walks back to the site's AI jobs.
  const record = <PageHeaderRecord title={copy?.heading} />

  if (site.status === 'error') {
    return (
      <Frame heading="This site could not be read">
        <Alert severity="warning">
          {'The site this job belongs to could not be loaded. Check your connection and reload the page.'}
        </Alert>
      </Frame>
    )
  }
  if (job === 'missing') {
    return (
      <Frame siteName={siteName} heading="This job could not be found">
        <Alert severity="info">{'It may belong to another workspace, or it may have expired.'}</Alert>
        {basePath ? (
          <Box>
            <Button variant="outlined" component={AppLink} href={basePath}>
              {'See this site’s AI jobs'}
            </Button>
          </Box>
        ) : null}
      </Frame>
    )
  }
  if (job === 'error') {
    return (
      <Frame siteName={siteName} heading="This job could not be loaded">
        <Alert
          severity="warning"
          action={
            <Button color="inherit" size="small" onClick={retry}>
              {'Try again'}
            </Button>
          }
        >
          {'Something went wrong reading it. It may still be running: try again in a moment.'}
        </Alert>
      </Frame>
    )
  }
  if (!ready || !copy) {
    return (
      <Frame siteName={siteName} heading="Building your site">
        <Stack sx={{ alignItems: 'center', py: 4 }}>
          <CircularProgress aria-label="Loading the job" />
        </Stack>
      </Frame>
    )
  }

  const phase = aiSiteBuildPhase(ready)
  const terminal = AI_JOB_TERMINAL_STATUSES.includes(ready.status)
  const rows = aiSiteBuildRows(ready)
  const fraction = aiSiteBuildFraction(rows)
  const activeRow = phase === 'working' ? (rows.find((row) => row.state === 'active') ?? null) : null
  const credits = aiSiteBuildCreditsLine(ready)
  const links = phase === 'done' ? aiSiteBuildDoneLinks(ready, orgSlug) : { view: null, pages: null }
  const sitePublish = ready.kind === 'site' && phase === 'done' ? (ready.sitePublish ?? null) : null
  const liveUrl = sitePublish && sitePublish.published.length > 0 ? sitePublish.liveUrl : null
  // Paused by the meter (AGL-3660): out of credits or at a cap, carried on by Resume.
  const paused = ready.status === 'needs_input'
  const retryRefusal = ready.review?.retryRefusal
  const buildRetry = aiBuildCanRetry(ready)
  const retryRange = buildRetry ? aiBuildRetryCreditRange(ready) : null
  const canRetry = (phase === 'stopped' && ready.review?.reason === 'doctrine') || buildRetry
  const buildPlanWaiting = ready.kind === 'build' && phase === 'stopped' && ready.review?.reason === 'plan'
  // A guided start that ended without building its site starts over from its
  // own answers, as a fresh job: the questions reopen filled in.
  const restartAnswers =
    ready.kind === 'site' && (phase === 'failed' || phase === 'canceled')
      ? aiSiteStartAnswersFromInputs(ready.siteInputs)
      : null
  const refund = phase === 'failed' || phase === 'stopped' || phase === 'canceled' ? aiJobRefundCopy(ready) : null
  // A whole site put live says so in the words every new site goes live in
  // (AGL-3663); a partial build or a page left a draft keeps its own account.
  const liveNotice =
    liveUrl !== null &&
    !sitePublish?.drafts.length &&
    copy.heading === SITE_LIVE_NOTICE_TITLE &&
    copy.lede === SITE_LIVE_NOTICE_BODY

  return (
    <Frame siteName={siteName} {...(liveNotice ? {} : { heading: copy.heading, lede: copy.lede })}>
      {record}
      {liveNotice && <SiteLiveNotice liveUrl={liveUrl} pagesHref={links.pages} headingComponent="h1" />}
      {notice && <Alert severity="warning">{notice}</Alert>}
      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        {phase === 'working' &&
          (fraction !== null ? (
            <LinearProgress
              variant="determinate"
              value={Math.round(fraction * 100)}
              aria-label={`Building: ${rows.filter((row) => row.state === 'done').length} of ${rows.length} steps done`}
            />
          ) : (
            <LinearProgress aria-label="Building" />
          ))}
        <Box component="ol" aria-label="Progress" sx={{ listStyle: 'none', m: 0, p: { xs: 2, sm: 3 } }}>
          <Stack spacing={2}>
            {rows.map((row) => (
              <Stack component="li" key={row.id} direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
                <Box sx={{ width: (theme) => theme.spacing(3), display: 'flex', justifyContent: 'center' }}>
                  <RowIcon state={row.state} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <Typography
                      variant="body1"
                      color={row.state === 'waiting' || row.state === 'skipped' ? 'text.secondary' : 'text.primary'}
                    >
                      {row.label}
                    </Typography>
                    {row.id === activeRow?.id && elapsed ? (
                      <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {elapsed}
                      </Typography>
                    ) : typeof row.credits === 'number' && row.credits > 0 ? (
                      <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                        {`${row.credits} ${row.credits === 1 ? 'credit' : 'credits'}`}
                      </Typography>
                    ) : null}
                  </Stack>
                  {row.id === activeRow?.id && row.hint ? (
                    <Typography variant="body2" color="text.secondary">
                      {row.hint}
                    </Typography>
                  ) : null}
                  {row.sections?.length && (row.state === 'active' || row.state === 'done') ? (
                    <Typography variant="body2" color="text.secondary">
                      {`${row.state === 'active' ? 'Writing' : 'Wrote'}: ${row.sections.join(', ')}`}
                    </Typography>
                  ) : null}
                  {/* A build item's failure, note or refund (AGL-3616). */}
                  {row.detail ? (
                    <Typography variant="body2" color="text.secondary">
                      {row.detail}
                    </Typography>
                  ) : null}
                </Box>
              </Stack>
            ))}
          </Stack>
        </Box>
      </Card>
      {refund && (ready.refundedCredits ?? 0) > 0 ? (
        <Alert severity="info">{refund}</Alert>
      ) : credits ? (
        <Typography variant="body2" color="text.secondary">
          {credits}
        </Typography>
      ) : null}
      {ready.cancelRequested && !terminal ? (
        // Asked to cancel while a step is in flight (AGL-3616): it finishes
        // or stops, and the page turns to "canceled" when it has.
        <Alert severity="info">{AI_JOB_CANCELING_COPY}</Alert>
      ) : null}
      {retrying && restartAnswers && hostId ? (
        <AiSiteStartCard
          hostId={hostId}
          orgId={orgId ?? undefined}
          orgSlug={orgSlug}
          host={hostSubdomain}
          initialAnswers={restartAnswers}
          startBlank={() => setRetrying(false)}
          leave={() => setRetrying(false)}
        />
      ) : null}
      {buildPlanWaiting ? (
        // A build's plan, confirmed here as in the chat (AGL-3616).
        <AiJobPlan
          job={ready}
          busy={busy}
          orgSlug={orgSlug}
          onResume={(target, options) => void confirmPlan(target, options)}
        />
      ) : null}
      {sitePublish && sitePublish.drafts.length > 0 && (
        // The pages the publish left as drafts, each with its plain reason;
        // Edit your pages is where they are fixed and published.
        <Alert severity="warning">
          <Typography variant="body2" sx={{ mb: 1 }}>
            {sitePublish.drafts.length === 1 ? 'This page stayed a draft:' : 'These pages stayed drafts:'}
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {sitePublish.drafts.map((draft) => (
              <li key={draft.id}>
                <Typography variant="body2">{`${draft.label}: ${draft.reason}`}</Typography>
              </li>
            ))}
          </Box>
          <Typography variant="body2" sx={{ mt: 1 }}>
            {'Open Edit your pages to fix and publish them.'}
          </Typography>
        </Alert>
      )}
      {phase === 'done' && buildRetry && (
        <Box>
          <Button variant="outlined" disabled={busy} onClick={() => void tryAgain()}>
            {retryRange ? `Try again what failed · ${aiCreditRangeText(retryRange)}` : 'Try again what failed'}
          </Button>
        </Box>
      )}
      {retryPrompt && (
        <AiCreditsPromptNotice
          prompt={retryPrompt}
          noun={ready.kind === 'site' ? 'site' : 'build'}
          orgSlug={orgSlug}
          busy={busy}
          onBuildWhatFits={() => void tryAgain({ creditsConfirmed: true })}
        />
      )}
      {phase === 'done' && !liveNotice && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          {liveUrl ? (
            // The live site, in a tab of its own: the console stays where it is.
            <Button
              variant="contained"
              size="large"
              component="a"
              href={liveUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {'View your site'}
            </Button>
          ) : links.view ? (
            // The console's own view of the first page, but still a VIEW, so
            // it opens beside this page like the live one above (AGL-3660).
            <Button
              variant="contained"
              size="large"
              component={AppLink}
              href={links.view}
              {...newTabLinkProps}
            >
              {'View your site'}
            </Button>
          ) : null}
          {links.pages && (
            <Button variant="outlined" size="large" component={AppLink} href={links.pages}>
              {'Edit your pages'}
            </Button>
          )}
        </Stack>
      )}
      {paused && (
        // Paused by the meter (AGL-3660): the way to more credits — the
        // workspace's own Billing page, where plans and the AI add-on are
        // sold — and Resume, which carries on this same job from its paused
        // step once credits are there again.
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
          <Button variant="contained" disabled={busy} onClick={() => void confirmPlan(ready)}>
            {busy ? 'Resuming…' : 'Resume'}
          </Button>
          {orgSlug ? (
            <Button variant="outlined" component={AppLink} href={aiCreditsBillingHref(orgSlug)}>
              {'Get more AI credits'}
            </Button>
          ) : null}
        </Stack>
      )}
      {!paused && (phase === 'stopped' || phase === 'failed' || phase === 'canceled') && (
        <Stack spacing={1}>
          {retryRefusal && (
            <Typography variant="body2" color="text.secondary">
              {retryRefusal}
            </Typography>
          )}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
            {restartAnswers && hostId && (
              // A fresh job from the same answers; a canceled one starts again.
              <Button variant="contained" onClick={() => setRetrying(true)}>
                {phase === 'canceled' ? 'Start again' : 'Try again'}
              </Button>
            )}
            {canRetry && (
              <Button
                variant="contained"
                disabled={busy || Boolean(retryRefusal)}
                onClick={() => void tryAgain()}
              >
                {'Try again'}
              </Button>
            )}
            {aiSiteStarterFallbackOffered(ready) && user ? <AiSiteStarterFallback job={ready} user={user} /> : null}
          </Stack>
        </Stack>
      )}
      {/* Cancel (AGL-3616): while the job can stop, and disabled with its reason once it cannot. */}
      <Box>
        <AiJobCancelButton
          job={ready}
          user={user}
          orgId={orgId}
          onJob={setJob}
          variant={terminal ? 'text' : 'outlined'}
          size={terminal ? 'small' : 'medium'}
        />
      </Box>
      {ready.plan && ready.plan.screens.length > 0 && (
        <Accordion
          // Open while the site is built, so the plan is in view as each part of it is written.
          defaultExpanded={phase === 'working'}
          variant="outlined"
          disableGutters
          sx={{ borderRadius: 2, '&::before': { display: 'none' } }}
        >
          <AccordionSummary expandIcon={<MdiIcon path={mdiChevronDown.path} />}>
            <Typography variant="subtitle1">{'What we’re building'}</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Stack component="ul" spacing={1.5} sx={{ m: 0, pl: 2.5 }}>
              {ready.plan.screens.map((screen, index) => (
                <Box component="li" key={`${screen.slug}-${index}`}>
                  <Typography variant="body1">{`${screen.title} — ${screen.slug}`}</Typography>
                  {screen.sections.length > 0 && (
                    <Typography variant="body2" color="text.secondary">
                      {screen.sections.map((section) => section.name).join(', ')}
                    </Typography>
                  )}
                </Box>
              ))}
            </Stack>
          </AccordionDetails>
        </Accordion>
      )}
    </Frame>
  )
}

export default AiSiteBuildPage
