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

import { buildRoute, lockdownRefusalText, parseLockdownRefusal, Route } from '@aglyn/aglyn'
import {
  SEO_FINDING_LABELS,
  seoAuditFindingCount,
  type SeoAuditReport,
  type SeoFinding,
} from '@aglyn/aglyn/app-utils/seo-audit'
import { SEO_KEYWORD_LINES_MAX_CHARS } from '@aglyn/aglyn/app-utils/seo-keywords'
import type { ConsoleSeoCheck } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useRef, useState } from 'react'
import { docsHelp } from '../constants/docs-links'

type SignedInUser = Parameters<typeof authorizedFetch>[0]

/**
 * Run the site's SEO check (`/api/hosts/seo-check`): the report, or the
 * sentence to show instead.
 */
export async function runSeoCheck(
  user: SignedInUser,
  hostId: string,
  keywords = '',
): Promise<{ report: SeoAuditReport } | { error: string }> {
  const failed = 'The SEO check could not run — try again.'
  try {
    const params = new URLSearchParams({ hostId })
    if (keywords.trim()) params.set('keywords', keywords.slice(0, SEO_KEYWORD_LINES_MAX_CHARS))
    const response = await authorizedFetch(user, `/api/hosts/seo-check?${params.toString()}`)
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const locked = parseLockdownRefusal(response.status, payload)
      return { error: locked ? lockdownRefusalText(locked) : String(payload?.error ?? failed) }
    }
    return payload?.report ? { report: payload.report as SeoAuditReport } : { error: failed }
  } catch {
    return { error: failed }
  }
}

/** What a finding is called, with the keyword it names. */
export function seoFindingLabel(finding: SeoFinding): string {
  const label = SEO_FINDING_LABELS[finding.code] ?? finding.code
  return finding.keyword ? `${label}: ${finding.keyword}` : label
}

/** One page's findings as chips, each with its sentence on hover. */
export function SeoFindingChips({ findings }: { findings: readonly SeoFinding[] }) {
  if (!findings.length) {
    return (
      <Typography variant="caption" color="text.secondary">
        {'Nothing found'}
      </Typography>
    )
  }
  return (
    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
      {findings.map((entry) => (
        <Chip
          key={`${entry.code}:${entry.keyword ?? ''}`}
          size="small"
          variant="outlined"
          color={entry.severity === 'high' ? 'error' : entry.severity === 'medium' ? 'warning' : 'default'}
          label={seoFindingLabel(entry)}
          title={entry.message}
        />
      ))}
    </Stack>
  )
}

export interface SeoCheckCardProps {
  hostId: string
  orgSlug: string
  /** The site's subdomain, which is what a console URL names a site by. */
  host: string | null
  /** The check as it last ran, handed to the `hostSeo` zone below the card. */
  check: ConsoleSeoCheck | null
  onChecked: (check: ConsoleSeoCheck) => void
}

/**
 * The site's SEO check, at the top of the SEO section: every published page
 * held to what a search result and a crawler need, and the site held to what
 * a search engine and an agent read about it (`app-utils/seo-audit`).
 *
 * Platform UI, for every site owner — no plan, add-on or plugin draws it.
 * It is the one place the findings are listed: the `hostSeo` zone under it
 * receives the report as `check`, and a widget there adds what it has for
 * the findings (a proposed fix) beside this list rather than drawing a second
 * one.
 *
 * It runs when asked, not on every visit: a check reads each checked page's
 * published version, which is worth spending when somebody wants the answer.
 */
export function SeoCheckCard(props: SeoCheckCardProps) {
  const { hostId, orgSlug, host, check, onChecked } = props
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  const [keywords, setKeywords] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)

  const run = useCallback(async () => {
    if (!userRef.current) return
    setBusy(true)
    setNotice(null)
    const result = await runSeoCheck(userRef.current, hostId, keywords)
    setBusy(false)
    if ('error' in result) {
      setNotice(result.error)
      return
    }
    setPage(0)
    onChecked({ report: result.report, keywords: keywords.trim() })
  }, [hostId, keywords, onChecked])

  const report = check?.report ?? null
  const findings = report ? seoAuditFindingCount(report) : 0
  const rows = report ? report.pages.slice(page * pageSize, (page + 1) * pageSize) : []
  const detailsHref = (screenId: string, versionId: string | null) =>
    host && versionId
      ? buildRoute(Route.SCREEN_DETAILS, { orgSlug, host, screenId, versionId })
      : null

  return (
    <CardDisplay
      contentGutterX
      contentGutterY
      header="SEO check"
      help={docsHelp('seo', {
        anchor: '#seo-check',
        excerpt:
          'Checks every published page for what search results and AI agents need, and lists what to fix. Free on every plan; it changes nothing on your site.',
      })}
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'Checks every published page for what search results and AI agents need: titles, descriptions, headings, image descriptions, links and your target keywords. It changes nothing on your site.'}
        </Typography>
        <TextField
          multiline
          minRows={2}
          fullWidth
          label="Target keywords by page (optional)"
          placeholder={'/pricing: pricing, plans\n/lamps: brass desk lamps'}
          helperText="One line per page. The check says where each page already uses its keywords."
          value={keywords}
          onChange={(event) => setKeywords(event.target.value.slice(0, SEO_KEYWORD_LINES_MAX_CHARS))}
          disabled={busy}
        />
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Button variant="contained" disabled={busy || !user} onClick={() => void run()}>
            {report ? 'Check again' : 'Run the check'}
          </Button>
          {busy ? <CircularProgress size={18} aria-label="Checking the site" /> : null}
        </Stack>
        {notice ? <Alert severity="warning">{notice}</Alert> : null}

        {report ? (
          <Stack spacing={2} aria-label="SEO check results">
            <Typography variant="subtitle1">
              {`Score ${report.score} of 100 · ${report.pages.length} ${report.pages.length === 1 ? 'page' : 'pages'} · ${findings} ${findings === 1 ? 'finding' : 'findings'}`}
            </Typography>
            {report.skipped > 0 ? (
              <Alert severity="info">
                {`${report.skipped} more published ${report.skipped === 1 ? 'page was' : 'pages were'} not checked this time.`}
              </Alert>
            ) : null}
            {report.site.length ? (
              <Stack spacing={1} aria-label="About the site">
                {report.site.map((entry) => (
                  <Alert key={entry.code} severity={entry.severity === 'high' ? 'error' : 'info'}>
                    <strong>{seoFindingLabel(entry)}</strong>
                    {` — ${entry.message}`}
                  </Alert>
                ))}
              </Stack>
            ) : null}
            {report.notes.map((line) => (
              <Typography key={line} variant="body2" color="text.secondary">
                {line}
              </Typography>
            ))}

            {report.pages.length ? (
              <Box>
                <ScrollTable size="small" aria-label="Checked pages">
                  <TableHead>
                    <TableRow>
                      <TableCell>{'Page'}</TableCell>
                      <TableCell align="right">{'Score'}</TableCell>
                      <TableCell>{'Found'}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => {
                      const href = detailsHref(row.screenId, row.versionId)
                      return (
                        <TableRow key={row.screenId}>
                          <TableCell>
                            <Typography variant="body2">
                              {href ? (
                                <AppLink componentVariant="naked" href={href}>
                                  {row.name}
                                </AppLink>
                              ) : (
                                row.name
                              )}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {row.path}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">{row.score}</TableCell>
                          <TableCell>
                            <SeoFindingChips findings={row.findings} />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </ScrollTable>
                <ListPagination
                  page={page}
                  pageSize={pageSize}
                  rowCount={rows.length}
                  count={report.pages.length}
                  onPageChange={setPage}
                  onPageSizeChange={(size) => {
                    setPageSize(size)
                    setPage(0)
                  }}
                />
              </Box>
            ) : (
              <Typography variant="body2">{'This site has no published public pages to check.'}</Typography>
            )}
          </Stack>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
SeoCheckCard.displayName = 'SeoCheckCard'

export default SeoCheckCard
