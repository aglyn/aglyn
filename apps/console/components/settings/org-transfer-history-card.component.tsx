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

/**
 * Every import the workspace ran (AGL-3535): row imports, workspace
 * packages and each site's package imports, newest first — what, who,
 * when, how it went, its result file, and Undo for as long as it is open.
 * Read through `/api/transfer/jobs`, because a job's state beyond its
 * document (whether undo is open, whether its file was cleared) and a
 * site's package imports are the server's to read.
 */

import { PackageImportUndo, countOf } from '@aglyn/aglyn-transfer-ui'
import { useTransferLauncher } from '@aglyn/aglyn/app-utils/transfer-launcher-context'
import type { TransferJobSummary, TransferSitePackageImportSummary } from '@aglyn/aglyn/data-transfer'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Alert, Button, Chip, LinearProgress, Stack, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { docsHelp } from '../../constants/docs-links'
import { TABLE_PAGE_SIZE_DEFAULT } from '../../constants/shared'
import useCurrentOrg from '../../hooks/use-current-org'
import { createSitePackageHttpClient } from '../../utils/site-package-http-client'
import { createTransferHubClient } from '../../utils/transfer-hub-client'
import { errorText, HubDialog, saveBlob } from '../transfer-hub/hub-dialog.component'
import { JOB_STATUS_WORDS } from '../transfer-hub/hub-words'
import OrgPackageUndo from '../transfer-hub/org-package-undo.component'

type Row =
  | { kind: 'job'; at: number; job: TransferJobSummary }
  | { kind: 'site'; at: number; entry: TransferSitePackageImportSummary }

type Undoing = { kind: 'job'; job: TransferJobSummary } | { kind: 'site'; entry: TransferSitePackageImportSummary } | null

const when = (ms: number) => new Date(ms).toLocaleString()

function counts(job: TransferJobSummary): string {
  const results = job.results
  if (!results || !results.total) return countOf(job.rowCount, job.kind === 'package' ? 'item' : 'row')
  const parts = [
    results.created ? `${results.created.toLocaleString()} created` : '',
    results.updated ? `${results.updated.toLocaleString()} updated` : '',
    results.unchanged ? `${results.unchanged.toLocaleString()} unchanged` : '',
    results.skipped ? `${results.skipped.toLocaleString()} skipped` : '',
    results.failed ? `${results.failed.toLocaleString()} failed` : '',
  ].filter(Boolean)
  return parts.join(', ') || countOf(results.total, 'row')
}

export function OrgTransferHistoryCard(props: { refreshKey?: number }) {
  const { data: user } = useUser()
  const { orgId } = useCurrentOrg()
  const launcher = useTransferLauncher()
  const [rows, setRows] = useState<Row[]>([])
  const [next, setNext] = useState<number | null>(null)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  // The `after` each page was read from: page 0 from the newest, page n from page n − 1's last job.
  const [cursors, setCursors] = useState<Array<number | null>>([null])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [undoing, setUndoing] = useState<Undoing>(null)
  const [reloads, setReloads] = useState(0)

  const fetcher = useCallback((input: string, init?: RequestInit) => authorizedFetch(user, input, init), [user])
  const client = useMemo(() => (orgId ? createTransferHubClient({ orgId, fetch: fetcher }) : null), [orgId, fetcher])

  const load = useCallback(
    async (at: number, after: number | null, size: number) => {
      if (!client) return
      setLoading(true)
      setError(null)
      try {
        const answer = await client.jobs({ after, limit: size })
        const jobs: Row[] = answer.jobs.map((job) => ({ kind: 'job', at: job.createdAt, job }))
        // Each site's package imports ride on the first page, beside the newest jobs.
        const sites: Row[] = (answer.sitePackageImports ?? []).map((entry) => ({ kind: 'site', at: entry.startedAt, entry }))
        setRows([...jobs, ...sites].sort((a, b) => b.at - a.at))
        setNext(answer.next)
        setPage(at)
      } catch (caught) {
        setError(errorText(caught))
      } finally {
        setLoading(false)
      }
    },
    [client],
  )

  useEffect(() => {
    setCursors([null])
    void load(0, null, pageSize)
  }, [load, pageSize, props.refreshKey, reloads])

  const download = async (job: TransferJobSummary) => {
    if (!client) return
    try {
      const file = await client.resultFile(job.id)
      saveBlob(file.body, file.fileName)
    } catch (caught) {
      setError(errorText(caught))
    }
  }

  const closeUndo = () => {
    setUndoing(null)
    setReloads((count) => count + 1)
  }

  return (
    <CardDisplay
      header={'History'}
      help={docsHelp('transferHub', {
        anchor: '#history',
        excerpt: 'Every import this workspace ran, with its result file and undo for seven days.',
      })}
      HeaderProps={{
        action: (
          <Button size="small" disabled={loading} onClick={() => setReloads((count) => count + 1)}>
            {'Refresh'}
          </Button>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      {loading && <LinearProgress sx={{ mb: 1 }} />}
      {error && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}
      {!rows.length && !loading ? (
        <Typography variant="body2" color="text.secondary">
          {'Nothing has been imported into this workspace yet.'}
        </Typography>
      ) : (
        <ScrollTable size="small">
          <TableHead>
            <TableRow>
              <TableCell>{'What'}</TableCell>
              <TableCell>{'Status'}</TableCell>
              <TableCell>{'Result'}</TableCell>
              <TableCell>{'Who'}</TableCell>
              <TableCell>{'When'}</TableCell>
              <TableCell align="right">{'Actions'}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) =>
              row.kind === 'job' ? (
                <TableRow key={`job:${row.job.id}`}>
                  <TableCell>
                    <Typography variant="body2">{row.job.label}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.job.fileName ?? ''}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" color={JOB_STATUS_WORDS[row.job.status].color} label={JOB_STATUS_WORDS[row.job.status].label} />
                    {row.job.error && (
                      <Typography variant="caption" color="error" component="div">
                        {row.job.error}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{counts(row.job)}</TableCell>
                  <TableCell>{row.job.createdByEmail ?? 'A former member'}</TableCell>
                  <TableCell>{when(row.job.createdAt)}</TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                      {row.job.resultFile && (
                        <Button size="small" onClick={() => download(row.job)}>
                          {'Results'}
                        </Button>
                      )}
                      {row.job.kind === 'records' && launcher && row.job.status !== 'undone' && (
                        <Button
                          size="small"
                          onClick={() =>
                            launcher.openImport({
                              resource: row.job.resource,
                              scope: row.job.hostId ? 'host' : 'org',
                              hostId: row.job.hostId,
                              jobId: row.job.id,
                              onFinished: () => setReloads((count) => count + 1),
                            })
                          }
                        >
                          {row.job.undo.available ? 'Open or undo' : 'Open'}
                        </Button>
                      )}
                      {row.job.kind === 'package' && row.job.undo.available && (
                        <Button size="small" color="warning" onClick={() => setUndoing({ kind: 'job', job: row.job })}>
                          {'Undo'}
                        </Button>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow key={`site:${row.entry.hostId}:${row.entry.importId}`}>
                  <TableCell>
                    <Typography variant="body2">{`Site package · ${row.entry.hostName ?? row.entry.hostId}`}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.entry.source ?? ''}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={JOB_STATUS_WORDS[row.entry.status === 'applying' ? 'applying' : row.entry.status].color}
                      label={JOB_STATUS_WORDS[row.entry.status === 'applying' ? 'applying' : row.entry.status].label}
                    />
                    {row.entry.error && (
                      <Typography variant="caption" color="error" component="div">
                        {row.entry.error}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {Object.entries(row.entry.counts)
                      .filter(([, count]) => count > 0)
                      .map(([decision, count]) => `${count.toLocaleString()} ${decision}`)
                      .join(', ') || countOf(row.entry.items, 'item')}
                  </TableCell>
                  <TableCell>{row.entry.actorEmail ?? 'A former member'}</TableCell>
                  <TableCell>{when(row.entry.startedAt)}</TableCell>
                  <TableCell align="right">
                    {row.entry.undo.available && (
                      <Button size="small" color="warning" onClick={() => setUndoing({ kind: 'site', entry: row.entry })}>
                        {'Undo'}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ),
            )}
          </TableBody>
        </ScrollTable>
      )}
      <ListPagination
        page={page}
        pageSize={pageSize}
        rowCount={rows.filter((row) => row.kind === 'job').length}
        hasMore={next !== null}
        disabled={loading}
        onPageSizeChange={setPageSize}
        onPageChange={(to) => {
          if (to === page) return
          const after = to > page ? next : (cursors[to] ?? null)
          setCursors((current) => {
            const kept = current.slice(0, to + 1)
            kept[to] = after
            return kept
          })
          void load(to, after, pageSize)
        }}
      />
      {undoing?.kind === 'job' && client && (
        <HubDialog title="Undo the import" id="org-package-undo-title" onClose={closeUndo}>
          <OrgPackageUndo client={client} jobId={undoing.job.id} />
        </HubDialog>
      )}
      {undoing?.kind === 'site' && (
        <HubDialog title="Undo the site package import" id="site-package-undo-title" onClose={closeUndo}>
          <PackageImportUndo
            client={createSitePackageHttpClient({ hostId: undoing.entry.hostId, fetch: fetcher })}
            importId={undoing.entry.importId}
          />
        </HubDialog>
      )}
    </CardDisplay>
  )
}

export default OrgTransferHistoryCard
