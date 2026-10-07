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
import type { ConsolePluginPageProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { AppLink } from '@aglyn/shared-ui-jsx'
import { authorizedFetch, type MaybeTokenSource } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Container,
  List,
  ListItemButton,
  Stack,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AI_JOB_PHASE_LABELS, aiJobKindNoun, aiJobPhase, type AiJobPhase } from '../model/ai-job-activity'
import type { AiJobSummary } from '../model/ai-jobs.types'
import { publishAiJob } from './ai-jobs-store'
import { useAiJobSite } from './ai-job-site'

/**
 * A site's AI jobs (AGL-3596), at `/ai-jobs` under the site: every job that
 * worked on this site, newest first, each linking to its own page.
 *
 * Read through the jobs route, never Firestore, so the membership, flag and
 * plan rungs that answer every other jobs read answer this one. The site is
 * a query on the route (`hostId`), not a filter of the workspace's list.
 *
 * Every wait ends: the site's read and the list's each settle on content,
 * the empty state, or a sentence with Try again.
 */

/** The most jobs the page lists; the newest, which is what a person comes for. */
export const AI_JOBS_PAGE_LIMIT = 50

/** How long the list may take before the page says it could not be loaded. */
export const AI_JOBS_LIST_TIMEOUT_MS = 20_000

/** How much of a brief a row shows. */
const BRIEF_PREVIEW_CHARS = 120

/** A row's chip, colored as the AI jobs drawer colors it. */
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

const WHEN = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' })

/** What a job cost the person: what it spent, less what we refunded. */
export function aiJobNetCredits(job: Pick<AiJobSummary, 'creditsSpent' | 'refundedCredits'>): number {
  return Math.max(0, (job.creditsSpent ?? 0) - (job.refundedCredits ?? 0))
}

/** The kind as a row names it: `Site`, `Page`, `AI job`. */
export function aiJobKindLabel(kind: AiJobSummary['kind']): string {
  const noun = aiJobKindNoun(kind)
  return noun === 'AI job' ? noun : noun.charAt(0).toUpperCase() + noun.slice(1)
}

type ListState =
  | { status: 'loading' }
  | { status: 'ready'; jobs: AiJobSummary[] }
  | { status: 'error'; message: string }

const LOAD_ERROR = 'This site’s AI jobs could not be loaded. Try again in a moment.'

async function readSiteJobs(
  user: MaybeTokenSource,
  orgId: string,
  hostId: string,
  signal: AbortSignal,
): Promise<ListState> {
  try {
    const response = await authorizedFetch(
      user,
      `/api/ai/jobs?orgId=${encodeURIComponent(orgId)}&hostId=${encodeURIComponent(hostId)}&limit=${AI_JOBS_PAGE_LIMIT}`,
      { signal },
    )
    const payload = (await response.json().catch(() => null)) as { jobs?: AiJobSummary[]; error?: string } | null
    if (!response.ok) return { status: 'error', message: String(payload?.error ?? LOAD_ERROR) }
    const jobs = payload?.jobs ?? []
    // A job the top-bar indicator still counts that has settled since leaves it.
    for (const job of jobs) publishAiJob(job)
    return { status: 'ready', jobs }
  } catch {
    return { status: 'error', message: LOAD_ERROR }
  }
}

export function AiJobsListPage({ hostId, basePath }: ConsolePluginPageProps) {
  const { data: user } = useUser()
  const userRef = useRef<MaybeTokenSource>(user)
  userRef.current = user
  const site = useAiJobSite(hostId)
  const orgId = site.status === 'ready' ? site.orgId : null
  const [list, setList] = useState<ListState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const uid = user?.uid ?? null

  useEffect(() => {
    if (!orgId || !hostId || !uid) return undefined
    const controller = new AbortController()
    let settled = false
    setList({ status: 'loading' })
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      controller.abort()
      setList({ status: 'error', message: LOAD_ERROR })
    }, AI_JOBS_LIST_TIMEOUT_MS)
    void readSiteJobs(userRef.current, orgId, hostId, controller.signal).then((next) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      setList(next)
    })
    return () => {
      settled = true
      clearTimeout(timer)
      controller.abort()
    }
  }, [orgId, hostId, uid, attempt])

  const retry = useCallback(() => setAttempt((count) => count + 1), [])

  const siteName = site.status === 'ready' ? site.name : ''
  const state: ListState =
    site.status === 'error'
      ? { status: 'error', message: 'This site could not be read. Check your connection and reload the page.' }
      : list

  return (
    <Container maxWidth="md" sx={{ py: { xs: 3, sm: 5 }, px: { xs: 2, sm: 3 } }}>
      <Stack spacing={3}>
        <Stack spacing={1}>
          {siteName ? (
            <Typography variant="overline" color="text.secondary">
              {siteName}
            </Typography>
          ) : null}
          <Typography variant="h4" component="h1">
            {'AI jobs'}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {`What ${PLATFORM_BRAND_NAME} AI has done and is doing on this site, newest first.`}
          </Typography>
        </Stack>
        {state.status === 'loading' ? (
          <Stack sx={{ alignItems: 'center', py: 4 }}>
            <CircularProgress aria-label="Loading AI jobs" />
          </Stack>
        ) : state.status === 'error' ? (
          <Alert
            severity="warning"
            action={
              site.status === 'error' ? undefined : (
                <Button color="inherit" size="small" onClick={retry}>
                  {'Try again'}
                </Button>
              )
            }
          >
            {state.message}
          </Alert>
        ) : state.jobs.length === 0 ? (
          <Card variant="outlined" sx={{ borderRadius: 2, p: { xs: 2, sm: 3 } }}>
            <Stack spacing={1}>
              <Typography variant="h6" component="h2">
                {'No AI jobs on this site yet'}
              </Typography>
              <Typography variant="body1" color="text.secondary">
                {`An AI job is ${PLATFORM_BRAND_NAME} AI building something for this site from a short ` +
                  'description you write: a page, a page template, a layout, a form or a reusable component. ' +
                  'Each one gets a page here that shows its progress and what it built.'}
              </Typography>
              <Typography variant="body1" color="text.secondary">
                {'To start one, choose Describe it on this site’s Pages, Templates, Layouts, Forms or ' +
                  'Components page. A new site can also be built with AI when it is created.'}
              </Typography>
            </Stack>
          </Card>
        ) : (
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <List disablePadding aria-label="AI jobs">
              {state.jobs.map((job, index) => {
                const phase = aiJobPhase(job)
                const credits = aiJobNetCredits(job)
                const brief =
                  job.brief.length > BRIEF_PREVIEW_CHARS ? `${job.brief.slice(0, BRIEF_PREVIEW_CHARS)}…` : job.brief
                const created = new Date(job.createdAt)
                return (
                  <ListItemButton
                    key={job.id}
                    component={AppLink}
                    href={`${basePath ?? ''}/${encodeURIComponent(job.id)}`}
                    divider={index < state.jobs.length - 1}
                    sx={{ display: 'block', py: 1.5 }}
                  >
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
                      <Chip size="small" variant="outlined" label={aiJobKindLabel(job.kind)} />
                      <Chip size="small" color={PHASE_COLOR[phase]} label={AI_JOB_PHASE_LABELS[phase]} />
                      <Box sx={{ flexGrow: 1 }} />
                      <Typography variant="caption" color="text.secondary">
                        {credits > 0 ? `${credits.toLocaleString('en-US')} credits · ` : ''}
                        {Number.isNaN(created.getTime()) ? null : (
                          <time dateTime={job.createdAt}>{WHEN.format(created)}</time>
                        )}
                      </Typography>
                    </Stack>
                    <Typography variant="body2" sx={{ mt: 0.75, wordBreak: 'break-word' }}>
                      {brief}
                    </Typography>
                  </ListItemButton>
                )
              })}
            </List>
          </Card>
        )}
        {state.status === 'ready' && state.jobs.length >= AI_JOBS_PAGE_LIMIT ? (
          <Typography variant="body2" color="text.secondary">
            {`Showing the ${AI_JOBS_PAGE_LIMIT} most recent jobs.`}
          </Typography>
        ) : null}
      </Stack>
    </Container>
  )
}

export default AiJobsListPage
