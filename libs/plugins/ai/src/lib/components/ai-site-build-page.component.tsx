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
import {
  mdiAlertCircle,
  mdiCheckCircle,
  mdiChevronDown,
  mdiClockOutline,
} from '@aglyn/shared-data-mdi'
import { AppLink, MdiIcon } from '@aglyn/shared-ui-jsx'
import type { MaybeTokenSource } from '@aglyn/shared-util-http/authorized-token'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
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
import { doc, getDoc } from 'firebase/firestore'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  aiSiteBuildCreditsLine,
  aiSiteBuildPhase,
  aiSiteBuildRows,
  type AiSiteBuildRowState,
} from '../model/ai-site-build-progress'
import { aiSiteStarterFallbackOffered } from '../model/ai-job-failure-copy'
import type { AiJobSummary } from '../model/ai-jobs.types'
import { followAiJobEvents } from './ai-job-events'
import { aiSiteBuildDoneLinks } from './ai-job-links'
import { resumeAiJobRequest } from './ai-job-requests'
import { AiSiteStarterFallback } from './ai-site-starter-fallback.component'

/**
 * "Building your site" (AGL-3594): where the guided start sends a person the
 * moment they plan a site, and where a notification about that job opens.
 *
 * A guided site start confirms its own plan (`autoConfirm`), so there is no
 * approval to make here: the page says what is happening, step by step, live
 * from the job's events route; shows what is being built; and, when the job
 * ends, leads with the next thing to do — the site to look at and the pages
 * to edit, or, where it stopped, the plain sentence for why and what to do
 * about it. It is linkable and survives a reload, because it reads the job by
 * the id in its own address under the site's own route.
 *
 * Mounted by the shell's generic plugin route as an unlisted page: no tab on
 * the site's strip, an address under it.
 */

/** The site's name, subdomain and org, read off the site document the reader may already read. */
interface SiteFacts {
  orgId: string
  name: string
}

/** Follows one job by id: its latest summary, `null` while the first state is out, `'missing'` when the route had none. */
export function useAiJobById(
  user: MaybeTokenSource,
  orgId: string | null,
  jobId: string | null,
): [AiJobSummary | 'missing' | null, (job: AiJobSummary) => void] {
  const userRef = useRef(user)
  userRef.current = user
  const [job, setJob] = useState<AiJobSummary | 'missing' | null>(null)
  const status = job && job !== 'missing' ? job.status : null
  const moving = status === null || status === 'queued' || status === 'running'
  useEffect(() => {
    if (!orgId || !jobId || !moving) return undefined
    const controller = new AbortController()
    let heard = false
    void followAiJobEvents(() => userRef.current, orgId, jobId, controller.signal, (next) => {
      heard = true
      setJob(next)
    }).then(() => {
      if (!heard && !controller.signal.aborted) setJob((current) => current ?? 'missing')
    })
    return () => controller.abort()
  }, [orgId, jobId, moving])
  return [job, setJob]
}

const ROW_ICON: Readonly<Record<Exclude<AiSiteBuildRowState, 'active'>, { path: string; color: string; label: string }>> = {
  done: { path: mdiCheckCircle.path, color: 'success.main', label: 'Done' },
  waiting: { path: mdiClockOutline.path, color: 'text.disabled', label: 'Waiting' },
  failed: { path: mdiAlertCircle.path, color: 'error.main', label: 'Stopped' },
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

export function AiSiteBuildPage({ hostId, segments, basePath }: ConsolePluginPageProps) {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const jobId = segments?.[0] ? decodeURIComponent(String(segments[0])) : null
  const orgSlug = (basePath ?? '').split('/')[1] ?? ''
  const [site, setSite] = useState<SiteFacts | null>(null)
  useEffect(() => {
    if (!hostId) return
    let active = true
    void getDoc(doc(firestore, 'hosts', hostId))
      .then((snapshot) => {
        if (!active) return
        const data = (snapshot.data() ?? {}) as { orgId?: string; displayName?: string }
        setSite({ orgId: String(data.orgId ?? ''), name: String(data.displayName ?? '') })
      })
      .catch(() => {
        if (active) setSite({ orgId: '', name: '' })
      })
    return () => {
      active = false
    }
  }, [firestore, hostId])

  const [job, setJob] = useAiJobById(user, site?.orgId || null, jobId)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const tryAgain = useCallback(async () => {
    if (!site?.orgId || !job || job === 'missing') return
    setBusy(true)
    setNotice(null)
    const decision = await resumeAiJobRequest(user, site.orgId, job)
    if (decision.job) setJob(decision.job)
    if (decision.error) setNotice(decision.error)
    setBusy(false)
  }, [site, job, user, setJob])

  const ready = job && job !== 'missing' ? job : null
  const phase = ready ? aiSiteBuildPhase(ready) : 'working'
  const heading =
    phase === 'done' ? 'Your site is ready' : phase === 'working' ? 'Building your site' : 'Your site was not built'
  const lede =
    phase === 'done'
      ? 'Your new pages are drafts. Publish them when you’re happy.'
      : phase === 'working'
        ? `${PLATFORM_BRAND_NAME} AI is planning your pages and writing each one. You can leave this page; it keeps going.`
        : phase === 'canceled'
          ? 'The job was canceled.'
          : (ready?.review?.message ?? ready?.error ?? 'Something went wrong building your site.')
  const rows = ready ? aiSiteBuildRows(ready) : []
  const credits = ready ? aiSiteBuildCreditsLine(ready) : null
  const links = ready && phase === 'done' ? aiSiteBuildDoneLinks(ready, orgSlug) : { view: null, pages: null }
  const retryRefusal = ready?.review?.retryRefusal
  const canRetry = phase === 'stopped' && ready?.review?.reason === 'doctrine'

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 3, sm: 5 }, px: { xs: 2, sm: 3 } }}>
      <Stack spacing={4}>
        <Stack spacing={1}>
          {site?.name ? (
            <Typography variant="overline" color="text.secondary">
              {site.name}
            </Typography>
          ) : null}
          <Typography variant="h4" component="h1">
            {heading}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {lede}
          </Typography>
        </Stack>
        {job === 'missing' ? (
          <Alert severity="info">{'This job could not be found. It may belong to another workspace.'}</Alert>
        ) : !ready ? (
          <Stack sx={{ alignItems: 'center', py: 4 }}>
            <CircularProgress aria-label="Loading the job" />
          </Stack>
        ) : (
          <>
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
                      <Typography
                        variant="body1"
                        color={row.state === 'waiting' ? 'text.secondary' : 'text.primary'}
                      >
                        {row.label}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              </Box>
            </Card>
            {credits && (
              <Typography variant="body2" color="text.secondary">
                {credits}
              </Typography>
            )}
            {phase === 'done' && (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                {links.view && (
                  <Button variant="contained" size="large" component={AppLink} href={links.view}>
                    {'View your site'}
                  </Button>
                )}
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
          </>
        )}
      </Stack>
    </Container>
  )
}

export default AiSiteBuildPage
