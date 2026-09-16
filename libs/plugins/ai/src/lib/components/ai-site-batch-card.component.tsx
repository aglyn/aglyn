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

import { lockdownRefusalText, parseLockdownRefusal } from '@aglyn/aglyn'
import type { ConsoleOrgSitesZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AI_JOB_TERMINAL_STATUSES,
  type AiJobStatus,
  type AiJobSummary,
} from '../model/ai-jobs.types'
import {
  AI_SITE_BATCH_MAX,
  AI_SITE_PAGES,
  aiSiteCreditEstimate,
} from '../model/ai-site-job'

/**
 * The agency batch (AGL-2911), on the organization's Sites page: one brief,
 * with the business name, the city and the brand changed per site, started
 * across many of the org's sites at once.
 *
 * What it starts are ordinary site scaffolds. Each plans first and waits for
 * its own confirmation in the Assist panel before it builds anything, and
 * everything it then builds is a draft — so this card publishes nothing and
 * changes no live site, however many sites it is pointed at.
 *
 * The estimate beside the button is the guard rail the issue asks for: what
 * one site is estimated to cost, and what the whole run is, before a credit
 * is spent on any of it.
 */

/** Jobs the card reads to find the batches this workspace has run. */
const RECENT_JOBS_READ = 100

/** A batch over one site is a scaffold; the card is for the other case. */
const MIN_SITES = 2

const STATUS_LABEL: Record<AiJobStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  needs_input: 'Needs attention',
  needs_review: 'Confirm the plan',
  done: 'Done',
  failed: 'Failed',
  canceled: 'Canceled',
}

const STATUS_COLOR: Record<
  AiJobStatus,
  'default' | 'primary' | 'success' | 'error' | 'warning'
> = {
  queued: 'default',
  running: 'primary',
  needs_input: 'warning',
  needs_review: 'warning',
  done: 'success',
  failed: 'error',
  canceled: 'default',
}

/** A site's per-run variables, as the member typed them. */
export interface AiSiteBatchRow {
  hostId: string
  picked: boolean
  businessName: string
  city: string
  brand: string
}

type Verdict = 'checking' | 'ready' | 'hidden'

const isTerminal = (job: AiJobSummary) =>
  AI_JOB_TERMINAL_STATUSES.includes(job.status)

/** The jobs of one batch, newest batch first, as the list route serves them. */
export function aiSiteBatchJobs(
  jobs: readonly AiJobSummary[],
  batchId: string | null,
): AiJobSummary[] {
  if (!batchId) return []
  return jobs.filter((job) => job.batch === batchId)
}

/** The batch a list of jobs most recently ran, or `null` when none did. */
export function aiLatestSiteBatch(
  jobs: readonly AiJobSummary[],
): string | null {
  return jobs.find((job) => job.kind === 'site' && job.batch)?.batch ?? null
}

export function AiSiteBatchCard(
  props: ConsoleOrgSitesZoneProps,
): JSX.Element | null {
  const { orgMount, basePath } = props
  const { orgId, hosts, hostsReady } = orgMount
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  const uid = user?.uid ?? null
  const orgSlug = basePath.split('/').filter(Boolean)[0] ?? ''

  const [verdict, setVerdict] = useState<Verdict>('checking')
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [brief, setBrief] = useState('')
  const [businessType, setBusinessType] = useState('')
  const [pages, setPages] = useState<number>(AI_SITE_PAGES.min + 1)
  const [welcomeEmail, setWelcomeEmail] = useState(true)
  const [rows, setRows] = useState<AiSiteBatchRow[]>([])
  const [batchId, setBatchId] = useState<string | null>(null)
  const [jobs, setJobs] = useState<AiJobSummary[]>([])

  // One row per site the page resolved for this reader, kept as the list moves.
  useEffect(() => {
    setRows((current) => {
      const byId = new Map(current.map((row) => [row.hostId, row]))
      return hosts.map(
        (host) =>
          byId.get(host.id) ?? {
            hostId: host.id,
            picked: false,
            businessName: host.name,
            city: '',
            brand: '',
          },
      )
    })
  }, [hosts])

  const load = useCallback(async () => {
    if (!orgId) return
    const response = await authorizedFetch(
      userRef.current,
      `/api/ai/jobs?orgId=${encodeURIComponent(orgId)}&limit=${RECENT_JOBS_READ}`,
    )
    // The generative doors answer 404 behind their release flag and 403
    // without the add-on: a feature that is not released does not exist.
    if (response.status === 404 || response.status === 403)
      return 'hidden' as const
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const locked = parseLockdownRefusal(response.status, payload)
      setNotice(
        locked ? lockdownRefusalText(locked) : String(payload?.error ?? ''),
      )
      return 'ready' as const
    }
    const listed = (payload?.jobs ?? []) as AiJobSummary[]
    setJobs(listed)
    setBatchId((current) => current ?? aiLatestSiteBatch(listed))
    return 'ready' as const
  }, [orgId])

  useEffect(() => {
    if (!orgId || !uid) return
    let active = true
    setVerdict('checking')
    void (async () => {
      try {
        const answer = await load()
        if (active && answer) setVerdict(answer)
      } catch {
        if (active) setVerdict('ready')
      }
    })()
    return () => {
      active = false
    }
  }, [orgId, uid, load])

  const picked = useMemo(() => rows.filter((row) => row.picked), [rows])
  const perSite = aiSiteCreditEstimate(pages, { welcomeEmail })
  const runJobs = useMemo(() => aiSiteBatchJobs(jobs, batchId), [jobs, batchId])
  const siteName = useCallback(
    (hostId: string | null) =>
      hosts.find((host) => host.id === hostId)?.name ?? 'This site',
    [hosts],
  )
  const siteHref = useCallback(
    (hostId: string | null) => {
      const subdomain = hosts.find((host) => host.id === hostId)?.subdomain
      return subdomain ? `${orgMount.hostsPath}/${subdomain}` : null
    },
    [hosts, orgMount.hostsPath],
  )

  const update = (hostId: string, patch: Partial<AiSiteBatchRow>) =>
    setRows((current) =>
      current.map((row) =>
        row.hostId === hostId ? { ...row, ...patch } : row,
      ),
    )

  const start = useCallback(async () => {
    if (!orgId || !picked.length) return
    setBusy(true)
    setNotice(null)
    try {
      const response = await authorizedFetch(
        userRef.current,
        '/api/ai/jobs/batch',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orgId,
            brief,
            businessType,
            pages,
            welcomeEmail,
            sites: picked.map((row) => ({
              hostId: row.hostId,
              businessName: row.businessName,
              city: row.city,
              brand: row.brand,
            })),
          }),
        },
      )
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const locked = parseLockdownRefusal(response.status, payload)
        setNotice(
          locked
            ? lockdownRefusalText(locked)
            : String(payload?.error ?? 'The sites could not be started.'),
        )
        return
      }
      setBatchId(String(payload?.batchId ?? '') || null)
      setJobs((payload?.jobs ?? []) as AiJobSummary[])
      setOpen(false)
      const refused = (payload?.refused ?? []) as Array<{
        hostId: string
        error: string
      }>
      if (refused.length) {
        setNotice(
          refused
            .map((entry) => `${siteName(entry.hostId)}: ${entry.error}`)
            .join(' · '),
        )
      }
    } catch {
      setNotice('The sites could not be started.')
    } finally {
      setBusy(false)
    }
  }, [orgId, picked, brief, businessType, pages, welcomeEmail, siteName])

  if (verdict !== 'ready' || !hostsReady || hosts.length < MIN_SITES)
    return null

  return (
    <CardDisplay
      contentGutterX
      contentGutterY
      HeaderProps={{
        title: 'Generate sites with AI',
        subheader:
          'One brief across many of your sites. Each site plans first and waits for you to ' +
          'confirm it; everything it builds is a draft.',
      }}
    >
      <Stack spacing={2}>
        {notice && <Alert severity="info">{notice}</Alert>}
        {runJobs.length > 0 && (
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              {`Last run · ${runJobs.length} ${runJobs.length === 1 ? 'site' : 'sites'}`}
            </Typography>
            <Table size="small" aria-label="Sites in this run">
              <TableHead>
                <TableRow>
                  <TableCell>{'Site'}</TableCell>
                  <TableCell>{'Status'}</TableCell>
                  <TableCell>{'Drafts'}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {runJobs.map((job) => {
                  const href = siteHref(job.hostId)
                  return (
                    <TableRow key={job.id}>
                      <TableCell>
                        {href ? (
                          <AppLink href={href}>{siteName(job.hostId)}</AppLink>
                        ) : (
                          siteName(job.hostId)
                        )}
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={STATUS_LABEL[job.status]}
                          color={STATUS_COLOR[job.status]}
                        />
                      </TableCell>
                      <TableCell>
                        {isTerminal(job) || job.outputs.length
                          ? `${job.outputs.length}`
                          : '—'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Box>
        )}
        <Box>
          <Button
            variant={open ? 'text' : 'contained'}
            onClick={() => setOpen(!open)}
          >
            {open ? 'Close' : 'Generate for several sites'}
          </Button>
        </Box>
        <Collapse in={open} unmountOnExit>
          <Stack spacing={2}>
            <TextField
              label="What these sites are for"
              placeholder="A neighborhood dog groomer that takes bookings"
              multiline
              minRows={2}
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Kind of business"
                placeholder="dog groomer"
                value={businessType}
                onChange={(event) => setBusinessType(event.target.value)}
                sx={{ flex: 1 }}
              />
              <TextField
                select
                label="Pages per site"
                value={pages}
                onChange={(event) => setPages(Number(event.target.value))}
                sx={{ minWidth: 160 }}
              >
                {Array.from(
                  { length: AI_SITE_PAGES.max - AI_SITE_PAGES.min + 1 },
                  (_, index) => AI_SITE_PAGES.min + index,
                ).map((count) => (
                  <MenuItem key={count} value={count}>
                    {count}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Welcome email"
                value={welcomeEmail ? 'yes' : 'no'}
                onChange={(event) =>
                  setWelcomeEmail(event.target.value === 'yes')
                }
                sx={{ minWidth: 160 }}
              >
                <MenuItem value="yes">{'Draft one'}</MenuItem>
                <MenuItem value="no">{'No'}</MenuItem>
              </TextField>
            </Stack>
            <Table size="small" aria-label="Sites to generate for">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox" />
                  <TableCell>{'Site'}</TableCell>
                  <TableCell>{'Business name'}</TableCell>
                  <TableCell>{'City'}</TableCell>
                  <TableCell>{'Brand'}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.hostId}>
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={row.picked}
                        slotProps={{
                          input: {
                            'aria-label': `Generate for ${siteName(row.hostId)}`,
                          },
                        }}
                        onChange={(event) =>
                          update(row.hostId, { picked: event.target.checked })
                        }
                      />
                    </TableCell>
                    <TableCell>{siteName(row.hostId)}</TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        variant="standard"
                        value={row.businessName}
                        slotProps={{
                          htmlInput: {
                            'aria-label': `Business name for ${siteName(row.hostId)}`,
                          },
                        }}
                        onChange={(event) =>
                          update(row.hostId, {
                            businessName: event.target.value,
                          })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        variant="standard"
                        value={row.city}
                        slotProps={{
                          htmlInput: {
                            'aria-label': `City for ${siteName(row.hostId)}`,
                          },
                        }}
                        onChange={(event) =>
                          update(row.hostId, { city: event.target.value })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        variant="standard"
                        value={row.brand}
                        slotProps={{
                          htmlInput: {
                            'aria-label': `Brand for ${siteName(row.hostId)}`,
                          },
                        }}
                        onChange={(event) =>
                          update(row.hostId, { brand: event.target.value })
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Typography variant="body2" color="text.secondary">
              {picked.length
                ? `Estimated cost: about ${perSite.toLocaleString('en-US')} credits a site, ` +
                  `${(perSite * picked.length).toLocaleString('en-US')} for ${picked.length} ` +
                  `${picked.length === 1 ? 'site' : 'sites'}. What each site really costs is ` +
                  'what its own steps spend.'
                : `Pick up to ${AI_SITE_BATCH_MAX} sites.`}
            </Typography>
            <Box>
              <Button
                variant="contained"
                disabled={
                  busy ||
                  !brief.trim() ||
                  !businessType.trim() ||
                  picked.length === 0 ||
                  picked.length > AI_SITE_BATCH_MAX
                }
                onClick={() => void start()}
                startIcon={busy ? <CircularProgress size={16} /> : undefined}
              >
                {picked.length
                  ? `Generate for ${picked.length} ${picked.length === 1 ? 'site' : 'sites'}`
                  : 'Generate'}
              </Button>
            </Box>
            {orgSlug && (
              <Typography variant="caption" color="text.secondary">
                {
                  'Each site waits for you to confirm its plan in the assistant panel.'
                }
              </Typography>
            )}
          </Stack>
        </Collapse>
      </Stack>
    </CardDisplay>
  )
}

export default AiSiteBatchCard
