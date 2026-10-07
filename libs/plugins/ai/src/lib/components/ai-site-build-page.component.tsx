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
} from '@aglyn/shared-data-mdi'
import { AppLink, MdiIcon } from '@aglyn/shared-ui-jsx'
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
  aiSiteBuildPhase,
  aiSiteBuildRows,
  type AiSiteBuildRowState,
} from '../model/ai-site-build-progress'
import { aiJobRefundCopy, aiSiteStarterFallbackOffered } from '../model/ai-job-failure-copy'
import { aiSiteStartAnswersFromInputs } from '../model/ai-site-start'
import { AiSiteStartCard } from './ai-site-start-card.component'
import { AI_JOB_TERMINAL_STATUSES, type AiJobSummary } from '../model/ai-jobs.types'
import { followAiJobEvents } from './ai-job-events'
import { aiSiteBuildDoneLinks } from './ai-job-links'
import { AiJobPlan } from './ai-job-plan.component'
import { aiBuildCanRetry } from '../model/ai-build-progress'
import { resumeAiJobRequest } from './ai-job-requests'
import { useAiJobSite } from './ai-job-site'
import { AiSiteStarterFallback } from './ai-site-starter-fallback.component'

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
  failed: { path: mdiAlertCircle.path, color: 'error.main', label: 'Stopped' },
  skipped: { path: mdiMinusCircleOutline.path, color: 'text.disabled', label: 'Not built' },
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
function Frame({
  siteName,
  heading,
  lede,
  children,
}: {
  siteName?: string
  heading: string
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
          <Typography variant="h4" component="h1">
            {heading}
          </Typography>
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
  const tryAgain = useCallback(async () => {
    if (!orgId || !job || typeof job !== 'object') return
    setBusy(true)
    setNotice(null)
    // A finished build tries again only what failed (AGL-3616).
    const decision = await resumeAiJobRequest(
      user,
      orgId,
      job,
      aiBuildCanRetry(job) ? { retry: 'failed-items' } : {},
    )
    if (decision.job) setJob(decision.job)
    if (decision.error) setNotice(decision.error)
    setBusy(false)
  }, [orgId, job, user, setJob])
  const confirmPlan = useCallback(
    async (target: AiJobSummary, options: { publish?: boolean } = {}) => {
      if (!orgId) return
      setBusy(true)
      setNotice(null)
      const decision = await resumeAiJobRequest(user, orgId, target, options)
      if (decision.job) setJob(decision.job)
      if (decision.error) setNotice(decision.error)
      setBusy(false)
    },
    [orgId, user, setJob],
  )

  const ready = job && typeof job === 'object' ? job : null
  const copy = ready ? aiJobPageCopy(ready, PLATFORM_BRAND_NAME) : null
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
  const rows = aiSiteBuildRows(ready)
  const credits = aiSiteBuildCreditsLine(ready)
  const links = phase === 'done' ? aiSiteBuildDoneLinks(ready, orgSlug) : { view: null, pages: null }
  const sitePublish = ready.kind === 'site' && phase === 'done' ? (ready.sitePublish ?? null) : null
  const liveUrl = sitePublish && sitePublish.published.length > 0 ? sitePublish.liveUrl : null
  const retryRefusal = ready.review?.retryRefusal
  const buildRetry = aiBuildCanRetry(ready)
  const canRetry = (phase === 'stopped' && ready.review?.reason === 'doctrine') || buildRetry
  const buildPlanWaiting = ready.kind === 'build' && phase === 'stopped' && ready.review?.reason === 'plan'
  // A guided start that ended without building its site starts over from its
  // own answers, as a fresh job: the questions reopen filled in.
  const restartAnswers =
    ready.kind === 'site' && (phase === 'failed' || phase === 'canceled')
      ? aiSiteStartAnswersFromInputs(ready.siteInputs)
      : null
  const refund = phase === 'failed' || phase === 'stopped' || phase === 'canceled' ? aiJobRefundCopy(ready) : null

  return (
    <Frame siteName={siteName} heading={copy.heading} lede={copy.lede}>
      {record}
      {notice && <Alert severity="warning">{notice}</Alert>}
      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        {phase === 'working' && <LinearProgress aria-label="Building" />}
        <Box component="ol" aria-label="Progress" sx={{ listStyle: 'none', m: 0, p: { xs: 2, sm: 3 } }}>
          <Stack spacing={2}>
            {rows.map((row) => (
              <Stack component="li" key={row.id} direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                <Box sx={{ width: (theme) => theme.spacing(3), display: 'flex', justifyContent: 'center' }}>
                  <RowIcon state={row.state} />
                </Box>
                <Box>
                  <Typography
                    variant="body1"
                    color={row.state === 'waiting' || row.state === 'skipped' ? 'text.secondary' : 'text.primary'}
                  >
                    {row.label}
                  </Typography>
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
        <AiJobPlan job={ready} busy={busy} onResume={(target, options) => void confirmPlan(target, options)} />
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
            {'Try again what failed'}
          </Button>
        </Box>
      )}
      {phase === 'done' && (
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
            <Button variant="contained" size="large" component={AppLink} href={links.view}>
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
      {(phase === 'stopped' || phase === 'failed' || phase === 'canceled') && (
        <Stack spacing={1}>
          {retryRefusal && (
            <Typography variant="body2" color="text.secondary">
              {retryRefusal}
            </Typography>
          )}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
            {restartAnswers && hostId && (
              <Button variant="contained" onClick={() => setRetrying(true)}>
                {'Try again'}
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
      {ready.plan && ready.plan.screens.length > 0 && (
        <Accordion variant="outlined" disableGutters sx={{ borderRadius: 2, '&::before': { display: 'none' } }}>
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
