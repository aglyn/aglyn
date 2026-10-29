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

import { PageHeaderRecord } from '@aglyn/aglyn/app-utils/page-header-record-context'
import { buildRoute, Route } from '@aglyn/aglyn/app-utils/console-routes'
import {
  mdiAlertCircle,
  mdiCheckCircle,
  mdiChevronDown,
  mdiClockOutline,
  mdiMinusCircleOutline,
  mdiOpenInNew,
} from '@aglyn/shared-data-mdi'
import { AppLink, HelpTip, MdiIcon } from '@aglyn/shared-ui-jsx'
import type { MaybeTokenSource } from '@aglyn/shared-util-http/authorized-token'
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
import { useCallback, useState, type ReactNode } from 'react'
import type { AiJobSummary } from '../model/ai-jobs.types'
import { aiSiteImportReviewWave, aiSiteImportRunningWave, type AiSiteImportWave } from '../model/ai-site-import'
import {
  aiSiteImportFoundText,
  aiSiteImportHeldCopy,
  aiSiteImportLeftOutLines,
  aiSiteImportPhaseOf,
  aiSiteImportPlanText,
  aiSiteImportStartAction,
  aiSiteImportStartAllAction,
  aiSiteImportVerdictNote,
  aiSiteImportWaveRows,
  aiSiteImportWaveSpent,
  type AiSiteImportClaim,
  type AiSiteImportRowState,
} from '../model/ai-site-import-view'
import { AiJobCancelButton } from './ai-job-cancel.component'
import { aiCreditsBillingHref, aiJobOutputHref } from './ai-job-links'
import { AI_SITE_IMPORT_HELP } from './ai-site-import-start.component'
import { AiSiteOwnershipProof, postAiSiteOwnership } from './ai-site-ownership-proof.component'

const ROW_ICON: Readonly<Record<Exclude<AiSiteImportRowState, 'active'>, { path: string; color: string; label: string }>> = {
  done: { path: mdiCheckCircle.path, color: 'success.main', label: 'In' },
  waiting: { path: mdiClockOutline.path, color: 'text.disabled', label: 'Waiting' },
  failed: { path: mdiAlertCircle.path, color: 'error.main', label: 'Could not be brought in' },
  skipped: { path: mdiMinusCircleOutline.path, color: 'text.disabled', label: 'Left out' },
}

function RowIcon({ state }: { state: AiSiteImportRowState }) {
  if (state === 'active') return <CircularProgress size={20} aria-label="In progress" />
  const icon = ROW_ICON[state]
  return (
    <Box component="span" role="img" aria-label={icon.label} sx={{ color: icon.color, display: 'inline-flex', fontSize: (theme) => theme.spacing(2.5) }}>
      <MdiIcon path={icon.path} aria-hidden />
    </Box>
  )
}

/** One wave's pages: where each was, where it is now, how it went, and its draft to open. */
function WaveRows({ job, wave, orgSlug }: { job: AiJobSummary; wave: AiSiteImportWave; orgSlug: string }) {
  const rows = aiSiteImportWaveRows(job, wave)
  return (
    <Box component="ol" aria-label={wave.label} sx={{ listStyle: 'none', m: 0, p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        {rows.map((row) => {
          const output = row.outputId ? job.outputs.find((entry) => entry.id === row.outputId) : undefined
          const href = output ? aiJobOutputHref(output, orgSlug) : null
          return (
            <Stack component="li" key={row.slot} direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
              <Box sx={{ width: (theme) => theme.spacing(3), display: 'flex', justifyContent: 'center' }}>
                <RowIcon state={row.state} />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <Typography variant="body1" color={row.state === 'waiting' || row.state === 'skipped' ? 'text.secondary' : 'text.primary'}>
                    {row.title}
                  </Typography>
                  {href && row.state === 'done' ? (
                    <Button size="small" component={AppLink} href={href}>
                      {'Open draft'}
                    </Button>
                  ) : null}
                </Stack>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                    {`${row.from} → ${row.to}`}
                  </Typography>
                  <Button
                    size="small"
                    component="a"
                    href={row.oldPage}
                    target="_blank"
                    rel="noopener noreferrer"
                    endIcon={<MdiIcon path={mdiOpenInNew.path} aria-hidden />}
                    aria-label={`Old page: ${row.from}, opens in a new tab`}
                    sx={{ minWidth: 0, py: 0 }}
                  >
                    {'Old page'}
                  </Button>
                </Stack>
                {row.build || row.words ? (
                  <Typography variant="body2" color="text.secondary">
                    {[row.build, row.words].filter(Boolean).join(' · ')}
                  </Typography>
                ) : null}
                {row.photos ? (
                  <Typography variant="body2" color="text.secondary">
                    {row.photos}
                  </Typography>
                ) : null}
                {row.note && row.state !== 'done' ? (
                  <Typography variant="body2" color="text.secondary">
                    {row.note}
                  </Typography>
                ) : null}
              </Box>
            </Stack>
          )
        })}
      </Stack>
    </Box>
  )
}

function Frame({ siteName, heading, lede, children }: { siteName?: string; heading: string; lede?: string; children?: ReactNode }) {
  return (
    <Container maxWidth="sm" sx={{ py: { xs: 3, sm: 5 }, px: { xs: 2, sm: 3 } }}>
      <PageHeaderRecord title={heading} />
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

export interface AiSiteImportJobProps {
  job: AiJobSummary
  orgId: string | null
  orgSlug: string
  /** The site's subdomain, which its Pages list is addressed by. */
  host: string | null
  siteName?: string
  user: MaybeTokenSource
  busy: boolean
  notice: string | null
  /** Starts the next wave, or reads the site again: the resume door. */
  onResume: () => void
  /**
   * Starts every remaining wave with no review between them (AGL-4083). The
   * button is drawn only where the page can start them this way.
   */
  onStartAll?: () => void
  onJob: (job: AiJobSummary) => void
}

/**
 * "Bring my site" (AGL-3976), on the import job's own page: the site read
 * and its waves planned with each one's quote, a wave running page by page,
 * a wave in for its review with its drafts to open, and the next wave's
 * button — the only way the next one starts. A wave held for a new proof, the
 * day's limit or a site that could not be read says so and offers the way on.
 */
export function AiSiteImportJob({ job, orgId, orgSlug, host, siteName, user, busy, notice, onResume, onStartAll, onJob }: AiSiteImportJobProps) {
  const phase = aiSiteImportPhaseOf(job)
  const state = job.siteImport ?? null
  const start = aiSiteImportStartAction(job)
  const startAll = onStartAll ? aiSiteImportStartAllAction(job) : null
  const held = aiSiteImportHeldCopy(job)
  const pagesHref = host && orgSlug ? buildRoute(Route.HOST_SCREENS, { orgSlug, host }) : null
  const [claim, setClaim] = useState<AiSiteImportClaim | null>(null)
  const [claimNotice, setClaimNotice] = useState<string | null>(null)
  const verifyAgain = useCallback(async () => {
    if (!orgId || !state) return
    setClaimNotice(null)
    const answer = await postAiSiteOwnership(user, { orgId, action: 'claim', domain: state.domain })
    if (answer.claim) setClaim(answer.claim)
    else setClaimNotice(answer.message)
  }, [orgId, state, user])

  const cancel = (
    <Box>
      <AiJobCancelButton job={job} user={user} orgId={orgId} onJob={onJob} variant="text" size="small" />
    </Box>
  )
  const startButton = start ? (
    <Stack spacing={1}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
        <Box>
          <Button variant="contained" size="large" disabled={busy} onClick={onResume}>
            {busy ? 'Starting…' : start.label}
          </Button>
        </Box>
        {startAll && onStartAll ? (
          <Box>
            <Button variant="outlined" size="large" disabled={busy} onClick={onStartAll}>
              {startAll.label}
            </Button>
          </Box>
        ) : null}
      </Stack>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          {`${start.quote}, from your AI credits. Its pages land in your site’s preview, or as drafts where the site is not in preview.`}
        </Typography>
        <HelpTip {...AI_SITE_IMPORT_HELP.waves} ariaLabel="How waves work" />
      </Stack>
      {startAll && onStartAll ? (
        <Typography variant="body2" color="text.secondary">
          {`${startAll.quote} for every remaining wave (${startAll.waves}), one after another with no review between them. You review the last one.`}
        </Typography>
      ) : null}
    </Stack>
  ) : null
  const waves = state ? (
    <Accordion variant="outlined" disableGutters sx={{ borderRadius: 2, '&::before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<MdiIcon path={mdiChevronDown.path} />}>
        <Typography variant="subtitle1">{`Every wave (${state.waves.length})`}</Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Stack component="ol" spacing={1} sx={{ m: 0, pl: 2.5 }}>
          {state.waves.map((wave) => (
            <Typography component="li" variant="body2" key={wave.index}>
              {`${wave.label}: ${wave.slots.length} ${wave.slots.length === 1 ? 'page' : 'pages'}${wave.frame ? ', with your header and footer' : ''}${
                wave.status === 'done' || wave.status === 'review'
                  ? ' (in)'
                  : wave.status === 'running'
                    ? ' (running)'
                    : wave.status === 'stopped'
                      ? wave.startedAt
                        ? ' (stopped)'
                        : ' (not started)'
                      : ''
              }`}
            </Typography>
          ))}
        </Stack>
      </AccordionDetails>
    </Accordion>
  ) : null
  const leftOut = state ? aiSiteImportLeftOutLines(state) : []
  const leftOutCard = leftOut.length ? (
    <Accordion variant="outlined" disableGutters sx={{ borderRadius: 2, '&::before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<MdiIcon path={mdiChevronDown.path} />}>
        <Typography variant="subtitle1">{`Not brought in (${leftOut.reduce((total, line) => total + line.count, 0)})`}</Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1.5}>
          {leftOut.map((line) => (
            <Box key={line.reason}>
              <Typography variant="body2">{`${line.count} · ${line.text}`}</Typography>
              {line.paths.length ? (
                <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                  {line.paths.slice(0, 8).join(', ')}
                  {line.paths.length > 8 || line.count > line.paths.length ? ', …' : ''}
                </Typography>
              ) : null}
              {line.reason === 'plan-limit' && orgSlug ? (
                <Button size="small" component={AppLink} href={aiCreditsBillingHref(orgSlug)} sx={{ mt: 0.5 }}>
                  {'See plans'}
                </Button>
              ) : null}
            </Box>
          ))}
        </Stack>
      </AccordionDetails>
    </Accordion>
  ) : null

  if (phase === 'reading') {
    return (
      <Frame siteName={siteName} heading="Reading your site" lede="AglynBot reads robots.txt first, then your sitemap and your pages. Nothing is built yet, and reading uses no AI credits.">
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <LinearProgress aria-label="Reading your site" />
          <Typography variant="body2" color="text.secondary" sx={{ p: { xs: 2, sm: 3 } }}>
            {'This takes a minute or two. You can leave this page; we tell you when your site is read.'}
          </Typography>
        </Card>
        {cancel}
      </Frame>
    )
  }

  if (phase === 'ready' && state) {
    return (
      <Frame siteName={siteName} heading="Your site is read" lede={job.review?.message ?? undefined}>
        {notice && <Alert severity="warning">{notice}</Alert>}
        {aiSiteImportVerdictNote(state) ? <Alert severity="warning">{aiSiteImportVerdictNote(state)}</Alert> : null}
        <Stack spacing={1}>
          <Typography variant="body1">{aiSiteImportFoundText(state)}</Typography>
          <Typography variant="body2" color="text.secondary">
            {aiSiteImportPlanText(state)}
          </Typography>
        </Stack>
        {start ? (
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <Typography variant="subtitle1" sx={{ px: { xs: 2, sm: 3 }, pt: { xs: 2, sm: 3 } }}>
              {`First: ${start.wave.label}`}
            </Typography>
            <WaveRows job={job} wave={start.wave} orgSlug={orgSlug} />
          </Card>
        ) : null}
        {startButton}
        {waves}
        {leftOutCard}
        {cancel}
      </Frame>
    )
  }

  if ((phase === 'running' || phase === 'starting') && state) {
    const wave = aiSiteImportRunningWave(state) ?? start?.wave ?? null
    const rows = wave ? aiSiteImportWaveRows(job, wave) : []
    const done = rows.filter((row) => row.state !== 'waiting' && row.state !== 'active').length
    return (
      <Frame
        siteName={siteName}
        heading={wave ? `Bringing in ${wave.label}` : 'Bringing in your site'}
        lede="Each page is rewritten into your new site’s design with its own words, facts and photos. You review the wave when it is in."
      >
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          {rows.length ? (
            <LinearProgress variant="determinate" value={Math.round((done / rows.length) * 100)} aria-label={`${done} of ${rows.length} in`} />
          ) : (
            <LinearProgress aria-label="Starting the wave" />
          )}
          {wave ? <WaveRows job={job} wave={wave} orgSlug={orgSlug} /> : null}
        </Card>
        {waves}
        {cancel}
      </Frame>
    )
  }

  if (phase === 'review' && state) {
    const wave = aiSiteImportReviewWave(state) as AiSiteImportWave
    const spent = aiSiteImportWaveSpent(job, wave)
    return (
      <Frame siteName={siteName} heading={`${wave.label} is in`} lede="Open each page to review it. They are drafts: nothing is published until you publish it.">
        {notice && <Alert severity="warning">{notice}</Alert>}
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <WaveRows job={job} wave={wave} orgSlug={orgSlug} />
        </Card>
        <Typography variant="body2" color="text.secondary">
          {`This wave used ${spent.toLocaleString('en-US')} AI ${spent === 1 ? 'credit' : 'credits'}.`}
        </Typography>
        {pagesHref ? (
          <Box>
            <Button variant="outlined" component={AppLink} href={pagesHref}>
              {'Open your draft pages'}
            </Button>
          </Box>
        ) : null}
        {start ? (
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <Typography variant="subtitle1" sx={{ px: { xs: 2, sm: 3 }, pt: { xs: 2, sm: 3 } }}>
              {`Next: ${start.wave.label}`}
            </Typography>
            <WaveRows job={job} wave={start.wave} orgSlug={orgSlug} />
          </Card>
        ) : null}
        {startButton}
        {waves}
        {leftOutCard}
        {cancel}
      </Frame>
    )
  }

  // The home page was turned away or could not be read (AGL-4083): nothing was
  // planned or spent, and Check again reads the site again, for free.
  if (phase === 'held' && held) {
    return (
      <Frame siteName={siteName} heading={held.heading}>
        {notice && <Alert severity="warning">{notice}</Alert>}
        <Alert severity="warning">{held.message}</Alert>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <Button variant="contained" disabled={busy} onClick={onResume}>
            {busy ? 'Checking…' : held.action}
          </Button>
          <HelpTip {...AI_SITE_IMPORT_HELP.turnedAway} ariaLabel="How to let AglynBot in" />
        </Stack>
        {leftOutCard}
        {cancel}
      </Frame>
    )
  }

  if (phase === 'held' || phase === 'paused') {
    const ownership = job.review?.reason === 'ownership'
    return (
      <Frame siteName={siteName} heading={ownership ? 'Verify your site again' : phase === 'paused' ? 'Your site import is paused' : 'Your site import is waiting'}>
        {notice && <Alert severity="warning">{notice}</Alert>}
        <Alert severity="info">{job.review?.message ?? job.error ?? 'It stopped for your decision.'}</Alert>
        {ownership && orgId ? (
          claim ? (
            <AiSiteOwnershipProof orgId={orgId} user={user} claim={claim} onClaim={setClaim} />
          ) : (
            <Box>
              <Button variant="outlined" onClick={() => void verifyAgain()}>
                {'Verify again'}
              </Button>
              {claimNotice ? <Alert severity="warning" sx={{ mt: 1 }}>{claimNotice}</Alert> : null}
            </Box>
          )
        ) : null}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
          <Button variant="contained" disabled={busy || (ownership && !claim?.current)} onClick={onResume}>
            {busy ? 'Starting…' : phase === 'paused' ? 'Resume' : start ? `${start.label} again` : 'Read the site again'}
          </Button>
          {phase === 'paused' && orgSlug ? (
            <Button variant="outlined" component={AppLink} href={aiCreditsBillingHref(orgSlug)}>
              {'Get more AI credits'}
            </Button>
          ) : null}
        </Stack>
        {waves}
        {cancel}
      </Frame>
    )
  }

  if (phase === 'done' && state) {
    const brought = (job.items ?? []).filter((row) => row.op === 'page' && (row.status === 'succeeded' || row.status === 'degraded')).length
    return (
      <Frame
        siteName={siteName}
        heading="Your site is in"
        lede={`${brought} ${brought === 1 ? 'page was' : 'pages were'} brought in from ${state.domain}. They are drafts: review them, then publish them when you are ready.`}
      >
        {pagesHref ? (
          <Box>
            <Button variant="contained" size="large" component={AppLink} href={pagesHref}>
              {'Open your draft pages'}
            </Button>
          </Box>
        ) : null}
        {state.waves.map((wave) => (
          <Card key={wave.index} variant="outlined" sx={{ borderRadius: 2 }}>
            <Typography variant="subtitle1" sx={{ px: { xs: 2, sm: 3 }, pt: { xs: 2, sm: 3 } }}>
              {wave.label}
            </Typography>
            <WaveRows job={job} wave={wave} orgSlug={orgSlug} />
          </Card>
        ))}
        {leftOutCard}
      </Frame>
    )
  }

  return (
    <Frame siteName={siteName} heading={job.status === 'canceled' ? 'Your site import was stopped' : 'Your site import stopped'}>
      <Alert severity="info">
        {job.error ??
          (job.status === 'canceled'
            ? 'Nothing more is brought in. The pages already in stay where they are: in your site’s preview, or as drafts.'
            : 'It could not go on. The pages already in stay where they are: in your site’s preview, or as drafts.')}
      </Alert>
      {pagesHref ? (
        <Box>
          <Button variant="outlined" component={AppLink} href={pagesHref}>
            {'Open your draft pages'}
          </Button>
        </Box>
      ) : null}
      {/* Which waves came in and which stopped (AGL-4107). */}
      {waves}
    </Frame>
  )
}

export default AiSiteImportJob
