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
import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import type { ConsoleHostSeoZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
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
import { AI_JOB_TERMINAL_STATUSES, type AiJobSummary } from '../model/ai-jobs.types'
import {
  AI_SEO_FINDING_LABELS,
  aiSeoApplyCounts,
  aiSeoAuditView,
  type AiSeoPageFix,
  type AiSeoSiteFormField,
} from '../model/ai-seo'
import { readEventFrames } from './assist-jobs-drawer.component'

/**
 * The site SEO audit (AGL-2910), on the site's SEO section through the
 * `hostSeo` zone. A person runs it; an `seo` job checks every published page
 * the sitemap lists, proposes a fix per finding, and drafts the structured
 * data and the agent guidance `/llms.txt` leads with.
 *
 * Nothing it shows is saved. "Put in the form" stages the site-wide proposal
 * in the SEO form below as unsaved edits, and the form's Update is the write.
 * "Apply all" does that too, and asks the apply door to open a new
 * unpublished version for each page's content fixes and to stage each page's
 * listing for its SEO card — the live site serves none of it until a person
 * saves or publishes.
 */

/** How many recent jobs the card reads to find this site's last audit. */
const RECENT_JOBS_READ = 20

const KEYWORDS_MAX_CHARS = 3_000

type Verdict = 'checking' | 'ready' | 'hidden'

interface ApplyResult {
  versions: Array<{ screenId: string; versionId: string; name: string; fixes: number }>
  staged: string[]
  skipped: Array<{ screenId: string; reason: string }>
}

const isTerminal = (job: AiJobSummary) => AI_JOB_TERMINAL_STATUSES.includes(job.status)

/** What each site SEO form field is called where the proposal lists it. */
export const AI_SEO_SITE_FIELD_LABELS: Record<AiSeoSiteFormField, string> = {
  'seo.entity.type': 'Published by',
  'seo.entity.name': 'Name',
  'seo.entity.description': 'Description',
  'seo.entity.email': 'Contact email',
  'seo.entity.telephone': 'Contact phone',
  'seo.entity.contactType': 'Contact is for',
  'seo.agent.whenToUse': 'When to use this site',
  'seo.agent.howToUse': 'How an agent should call you',
}

const ENTITY_TYPE_WORDS: Record<string, string> = { '1': 'An organization', '2': 'A person' }

/** One page's proposed fix, in a sentence a table cell can hold. */
function fixSummary(fix: AiSeoPageFix | undefined): string {
  if (!fix) return ''
  const parts: string[] = []
  if (fix.values.title) parts.push(`Title: ${fix.values.title}`)
  if (fix.values.description) parts.push(`Description: ${fix.values.description}`)
  const alts = fix.content.filter((entry) => entry.kind === 'image-alt').length
  if (alts) parts.push(`${alts} image ${alts === 1 ? 'description' : 'descriptions'}`)
  if (fix.content.some((entry) => entry.kind !== 'image-alt')) parts.push('One main heading')
  parts.push(...fix.guidance)
  return parts.join(' · ')
}

export function AiSeoAuditCard(props: ConsoleHostSeoZoneProps) {
  const { hostId, orgId, orgSlug, host, proposeDraft } = props
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  const uid = user?.uid ?? null

  const [verdict, setVerdict] = useState<Verdict>('checking')
  const [notice, setNotice] = useState<string | null>(null)
  const [keywords, setKeywords] = useState('')
  const [busy, setBusy] = useState(false)
  const [job, setJob] = useState<AiJobSummary | null>(null)
  const [siteStaged, setSiteStaged] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState<ApplyResult | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const watchRef = useRef<AbortController | null>(null)

  useEffect(() => () => watchRef.current?.abort(), [])

  useEffect(() => {
    if (!orgId || !hostId || !uid) return
    let active = true
    setVerdict('checking')
    void (async () => {
      try {
        const response = await authorizedFetch(
          userRef.current,
          `/api/ai/jobs?orgId=${encodeURIComponent(orgId)}&limit=${RECENT_JOBS_READ}`,
        )
        if (!active) return
        if (response.status === 404 || response.status === 403) {
          setVerdict('hidden')
          return
        }
        const payload = await response.json().catch(() => null)
        if (!active) return
        if (!response.ok) {
          const locked = parseLockdownRefusal(response.status, payload)
          setNotice(
            locked
              ? lockdownRefusalText(locked)
              : String(payload?.error ?? 'The last SEO audit could not be loaded.'),
          )
        } else {
          // An audit is the SEO job whose outputs carry a report; the summary
          // does not carry a job's inputs.
          const latest = ((payload?.jobs ?? []) as AiJobSummary[]).find(
            (entry) => entry.kind === 'seo' && entry.hostId === hostId && aiSeoAuditView(entry.outputs) !== null,
          )
          if (latest) setJob(latest)
        }
        setVerdict('ready')
      } catch {
        if (!active) return
        setNotice('The last SEO audit could not be loaded.')
        setVerdict('ready')
      }
    })()
    return () => {
      active = false
    }
  }, [orgId, hostId, uid])

  /** Follows a job through the events route until it settles. */
  const watch = useCallback(async (jobId: string, org: string) => {
    watchRef.current?.abort()
    const controller = new AbortController()
    watchRef.current = controller
    let again = true
    while (again && !controller.signal.aborted) {
      again = false
      try {
        const response = await authorizedFetch(
          userRef.current,
          `/api/ai/jobs/${encodeURIComponent(jobId)}/events?orgId=${encodeURIComponent(org)}`,
          { signal: controller.signal },
        )
        if (!response.ok || !response.body) return
        await readEventFrames(response.body, (event) => {
          if (event['type'] === 'state') setJob(event['job'] as AiJobSummary)
          else if (event['type'] === 'reconnect') again = true
        })
      } catch {
        return
      }
    }
  }, [])

  // A job the card did not start, still moving, is followed too.
  const followId = job && !isTerminal(job) && !busy ? job.id : null
  useEffect(() => {
    if (followId && orgId) void watch(followId, orgId)
  }, [followId, orgId, watch])

  const run = useCallback(async () => {
    if (!orgId) return
    setBusy(true)
    setNotice(null)
    setApplied(null)
    setSiteStaged(null)
    setPage(0)
    try {
      const response = await authorizedFetch(userRef.current, '/api/ai/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          hostId,
          kind: 'seo',
          brief: 'Audit the SEO of this site',
          inputs: { target: 'site', keywords: keywords.trim() },
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const locked = parseLockdownRefusal(response.status, payload)
        setNotice(
          locked
            ? lockdownRefusalText(locked)
            : String(payload?.error ?? 'The SEO audit could not be started — try again.'),
        )
        return
      }
      const next = payload?.job as AiJobSummary | undefined
      if (!next) return
      setJob(next)
      if (!isTerminal(next)) await watch(next.id, orgId)
    } catch {
      setNotice('The SEO audit could not be started — try again.')
    } finally {
      setBusy(false)
    }
  }, [orgId, hostId, keywords, watch])

  const view = useMemo(() => (job ? aiSeoAuditView(job.outputs) : null), [job])
  const siteValues = view?.site?.values ?? {}
  const siteFields = Object.keys(siteValues) as AiSeoSiteFormField[]

  const stageSite = useCallback(() => {
    if (!job || !siteFields.length) return
    proposeDraft(siteValues as Record<string, string>, `${job.id}:site`)
    setSiteStaged(job.id)
  }, [job, siteFields.length, siteValues, proposeDraft])

  const applyAll = useCallback(async () => {
    if (!job || !orgId) return
    setApplying(true)
    setNotice(null)
    stageSite()
    try {
      const response = await authorizedFetch(userRef.current, '/api/ai/seo/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, hostId, jobId: job.id }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const locked = parseLockdownRefusal(response.status, payload)
        setNotice(
          locked ? lockdownRefusalText(locked) : String(payload?.error ?? 'The fixes could not be applied — try again.'),
        )
        return
      }
      if (payload?.job) setJob(payload.job as AiJobSummary)
      setApplied({
        versions: payload?.versions ?? [],
        staged: payload?.staged ?? [],
        skipped: payload?.skipped ?? [],
      })
    } catch {
      setNotice('The fixes could not be applied — try again.')
    } finally {
      setApplying(false)
    }
  }, [job, orgId, hostId, stageSite])

  if (verdict !== 'ready') return null

  const running = Boolean(job && !isTerminal(job))
  const report = view?.report ?? null
  const findings = report ? report.pages.reduce((sum, entry) => sum + entry.findings.length, report.site.length) : 0
  const owedBatches = report ? Math.ceil(report.queue.length / Math.max(1, report.batchSize)) : 0
  const counts = view ? aiSeoApplyCounts(view) : { pagesWithContent: 0, pagesWithValues: 0 }
  const somethingToApply = counts.pagesWithContent + counts.pagesWithValues + siteFields.length > 0
  const pageRows = report ? report.pages.slice(page * pageSize, (page + 1) * pageSize) : []
  const names = new Map((report?.pages ?? []).map((entry) => [entry.screenId, entry]))
  const pageLink = (screenId: string, versionId: string | null, surface: 'view' | 'besigner') =>
    host && versionId
      ? `/${orgSlug}/hosts/${host}/screens/${screenId}/versions/${versionId}/${surface}`
      : null

  return (
      <CardDisplay
        contentGutterX
        contentGutterY
        header="SEO audit"
        help={pluginDocsHelp('aiSeo', {
          anchor: '#audit-the-whole-site',
          excerpt:
            'Check every published page and get a proposed fix for each finding. Nothing changes on your live site until you save or publish.',
        })}
      >
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {'Checks every published page for what search results and AI agents need, and proposes a fix for each finding. Nothing changes on your live site until you save or publish it.'}
          </Typography>
          <TextField
            multiline
            minRows={2}
            fullWidth
            label="Target keywords by page (optional)"
            placeholder={'/pricing: pricing, plans\n/lamps: brass desk lamps'}
            helperText="One line per page. A keyword is used only where the page is about it."
            value={keywords}
            onChange={(event) => setKeywords(event.target.value.slice(0, KEYWORDS_MAX_CHARS))}
            disabled={busy || running}
          />
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Button variant="contained" disabled={busy || running || !orgId} onClick={() => void run()}>
              {report ? 'Run the audit again' : 'Run audit'}
            </Button>
            {running ? <CircularProgress size={18} aria-label="Auditing the site" /> : null}
            {running && report ? (
              <Typography variant="caption" color="text.secondary">
                {`Proposing fixes: ${view?.batches ?? 0} of ${owedBatches} batches`}
              </Typography>
            ) : null}
          </Stack>
          {notice ? <Alert severity="warning">{notice}</Alert> : null}
          {job?.error ? <Alert severity={job.status === 'failed' ? 'error' : 'warning'}>{job.error}</Alert> : null}

          {report && job ? (
            <Stack spacing={2} aria-label="SEO audit results">
              <Typography variant="subtitle1">
                {`Score ${report.score} of 100 · ${report.pages.length} ${report.pages.length === 1 ? 'page' : 'pages'} · ${findings} ${findings === 1 ? 'finding' : 'findings'}`}
              </Typography>
              {job.creditsSpent > 0 ? (
                <Typography variant="caption" color="text.secondary">
                  {`This audit used ${job.creditsSpent} ${job.creditsSpent === 1 ? 'credit' : 'credits'}.`}
                </Typography>
              ) : null}
              {report.skipped > 0 ? (
                <Alert severity="info">
                  {`${report.skipped} more published ${report.skipped === 1 ? 'page was' : 'pages were'} not audited this time.`}
                </Alert>
              ) : null}
              {[...report.site.map((entry) => entry.message), ...report.notes].map((line) => (
                <Typography key={line} variant="body2">
                  {line}
                </Typography>
              ))}

              {view?.site ? (
                <Stack spacing={1} aria-label="Structured data and agent guidance">
                  <Typography variant="subtitle2">{'Structured data and AI agent guidance'}</Typography>
                  {siteFields.length ? (
                    siteFields.map((field) => (
                      <Stack key={field} spacing={0.25}>
                        <Typography variant="caption" color="text.secondary">
                          {AI_SEO_SITE_FIELD_LABELS[field]}
                        </Typography>
                        <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                          {field === 'seo.entity.type' ? (ENTITY_TYPE_WORDS[siteValues[field] ?? ''] ?? siteValues[field]) : siteValues[field]}
                        </Typography>
                      </Stack>
                    ))
                  ) : (
                    <Typography variant="body2">{'Nothing to add: the site’s structured data and guidance are already filled in.'}</Typography>
                  )}
                  {view.site.notes.map((note) => (
                    <Typography key={note} variant="caption" color="text.secondary">
                      {note}
                    </Typography>
                  ))}
                  <Button size="small" sx={{ alignSelf: 'flex-start' }} onClick={() => setPreviewOpen((open) => !open)}>
                    {previewOpen ? 'Hide the /llms.txt preview' : 'Preview /llms.txt'}
                  </Button>
                  <Collapse in={previewOpen} unmountOnExit>
                    <Box
                      component="pre"
                      sx={{ m: 0, p: 1.5, bgcolor: 'action.hover', borderRadius: 1, whiteSpace: 'pre-wrap', fontSize: 12 }}
                    >
                      {view.site.llmsPreview}
                    </Box>
                  </Collapse>
                  <Button
                    size="small"
                    variant="outlined"
                    sx={{ alignSelf: 'flex-start' }}
                    disabled={!siteFields.length || siteStaged === job.id}
                    onClick={stageSite}
                  >
                    {'Put in the form'}
                  </Button>
                  {siteStaged === job.id ? (
                    <Alert severity="success">{'In the SEO form below as unsaved changes. Review them, then press Update.'}</Alert>
                  ) : null}
                </Stack>
              ) : null}

              {report.pages.length ? (
                <Box sx={{ overflowX: 'auto' }}>
                  <Table size="small" aria-label="Audited pages">
                    <TableHead>
                      <TableRow>
                        <TableCell>{'Page'}</TableCell>
                        <TableCell align="right">{'Score'}</TableCell>
                        <TableCell>{'Found'}</TableCell>
                        <TableCell>{'Proposed'}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {pageRows.map((row) => (
                        <TableRow key={row.screenId}>
                          <TableCell>
                            <Typography variant="body2">{row.name}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {row.path}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">{row.score}</TableCell>
                          <TableCell>
                            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                              {row.findings.length ? (
                                row.findings.map((entry) => (
                                  <Chip
                                    key={`${entry.code}:${entry.keyword ?? ''}`}
                                    size="small"
                                    variant="outlined"
                                    color={entry.severity === 'high' ? 'error' : entry.severity === 'medium' ? 'warning' : 'default'}
                                    label={entry.keyword ? `${AI_SEO_FINDING_LABELS[entry.code]}: ${entry.keyword}` : AI_SEO_FINDING_LABELS[entry.code]}
                                    title={entry.message}
                                  />
                                ))
                              ) : (
                                <Typography variant="caption" color="text.secondary">
                                  {'Nothing found'}
                                </Typography>
                              )}
                            </Stack>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                              {fixSummary(view?.fixes[row.screenId]) ||
                                (row.findings.length && running ? 'Being proposed…' : '')}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <ListPagination
                    page={page}
                    pageSize={pageSize}
                    rowCount={pageRows.length}
                    count={report.pages.length}
                    onPageChange={setPage}
                    onPageSizeChange={(size) => {
                      setPageSize(size)
                      setPage(0)
                    }}
                  />
                </Box>
              ) : (
                <Typography variant="body2">{'This site has no published public pages to audit.'}</Typography>
              )}

              <Stack spacing={1}>
                <Typography variant="body2" color="text.secondary">
                  {'Apply all opens a new draft version of each page with content fixes, puts proposed titles and descriptions in each page’s SEO card, and puts the structured data and guidance in the form below. You review and save or publish each of them.'}
                </Typography>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Button
                    variant="contained"
                    disabled={applying || running || job.status !== 'done' || !view?.complete || !somethingToApply}
                    onClick={() => void applyAll()}
                  >
                    {'Apply all as drafts'}
                  </Button>
                  {applying ? <CircularProgress size={18} aria-label="Applying the fixes" /> : null}
                </Stack>
              </Stack>

              {applied ? (
                <Stack spacing={1} aria-label="Applied fixes">
                  {applied.versions.map((entry) => {
                    const href = pageLink(entry.screenId, entry.versionId, 'besigner')
                    return (
                      <Typography key={entry.screenId} variant="body2">
                        {href ? (
                          <AppLink componentVariant="naked" href={href}>
                            {`Open the draft of ${entry.name}`}
                          </AppLink>
                        ) : (
                          `A draft of ${entry.name} is ready`
                        )}
                      </Typography>
                    )
                  })}
                  {applied.staged.map((screenId) => {
                    const audited = names.get(screenId)
                    const href = pageLink(screenId, audited?.versionId ?? null, 'view')
                    return (
                      <Typography key={`staged:${screenId}`} variant="body2">
                        {href ? (
                          <AppLink componentVariant="naked" href={href}>
                            {`Review the listing for ${audited?.name ?? screenId}`}
                          </AppLink>
                        ) : (
                          `A listing for ${audited?.name ?? screenId} waits in its SEO card`
                        )}
                      </Typography>
                    )
                  })}
                  {applied.skipped.map((entry) => (
                    <Typography key={`skipped:${entry.screenId}`} variant="caption" color="text.secondary">
                      {`${names.get(entry.screenId)?.name ?? entry.screenId}: ${entry.reason}`}
                    </Typography>
                  ))}
                </Stack>
              ) : null}
            </Stack>
          ) : null}
        </Stack>
      </CardDisplay>
  )
}
AiSeoAuditCard.displayName = 'AiSeoAuditCard'

export default AiSeoAuditCard
