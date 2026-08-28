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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import {
  Alert,
  AlertTitle,
  Chip,
  Link,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import { TABLE_PAGE_SIZE_DEFAULT } from '../constants/shared'
import {
  taxReturnFindingGroups,
  type TaxReturnPayload,
} from '../utils/tx-return-webfile'

/**
 * WHICH ROWS — the half of every finding that never reached the screen.
 *
 * The verdict banner above said *"1 row needs attention — Rows billed without
 * automatic tax"* and there was no way, anywhere in the product, to learn
 * which row. That finding's own text says what is at stake: if the row is a
 * sale in the filing jurisdiction, tax was under-collected and is still owed,
 * and the platform pays it out of the receipt. An operator cannot begin on
 * that without an invoice id.
 *
 * The counts reached the screen because `taxReturnSummary` computes them; the
 * identities did not because the route projected rows the page never read and
 * the table below it aggregates by jurisdiction. Both halves now come from one
 * predicate (`taxReturnRowFindings`), so a count and its list cannot disagree.
 *
 * ## Why a card, and not rows inside the banner
 *
 * The banner is the verdict and its prominence is its whole function — the
 * page's own rule is that a qualified figure must never read as a final one,
 * and it earns that by being short enough to read before somebody presses
 * Submit at the authority. Up to `ROW_CAP` rows inside it would destroy
 * exactly that property.
 *
 * A single table with the finding chosen by chip, rather than a table per
 * finding, because a row commonly raises two — no address AND no stated base —
 * and repeating it under each would make one problem look like several. The
 * chips carry the counts, so the banner's list and this card's selector show
 * the same numbers from the same source.
 *
 * ## What it shows, and what it deliberately does not
 *
 * Enough to act on a row and no more: the invoice id, the jurisdiction it was
 * BUCKETED under (the fact that put it on or off the return), the money, the
 * paid date, and a link into Stripe. These rows carry customer identifiers and
 * amounts on a `super`-gated staff page, and a filing surface that grows into
 * a customer export is a different and worse thing.
 */
export default function StaffTaxFindingsCard({
  payload,
  loading,
}: {
  payload: TaxReturnPayload | null
  loading: boolean
}) {
  const groups = useMemo(() => taxReturnFindingGroups(payload), [payload])
  const [selected, setSelected] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)

  /*
   * The selection follows the DATA, not the click history. A finding chosen
   * for one period commonly does not exist in the next, and a card left
   * pointing at a group that is gone renders an empty table under a heading
   * for a finding this period never raised — indistinguishable from a finding
   * whose rows failed to load.
   */
  const active = groups.find((group) => group.id === selected) ?? groups[0] ?? null
  useEffect(() => {
    setPage(0)
  }, [active?.id, payload])

  if (!payload) {
    return null
  }
  if (!groups.length) {
    return null
  }

  const rows = active?.rows ?? []
  const visible = rows.slice(page * pageSize, page * pageSize + pageSize)

  return (
    <CardDisplay
      header={'Findings — the rows behind each count'}
      help={docsHelp('salesTaxReturn', {
        anchor: '#rows-that-need-attention',
        excerpt:
          'Every finding above, resolved to the invoices it is about — the ' +
          'invoice id, where the customer was, the money and a link into ' +
          'Stripe.',
      })}
      subheader={
        'A count with no rows behind it cannot be acted on. Pick a finding to ' +
        'see the invoices it is about.'
      }
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
          {groups.map((group) => (
            <Chip
              key={group.id}
              size="small"
              clickable
              onClick={() => setSelected(group.id)}
              variant={active?.id === group.id ? 'filled' : 'outlined'}
              color={
                group.severity === 'blocking'
                  ? 'error'
                  : group.severity === 'review'
                    ? 'warning'
                    : 'default'
              }
              label={`${group.count} · ${group.label}`}
            />
          ))}
        </Stack>

        {active ? (
          <>
            <Typography variant="body2" color="text.secondary">
              {active.detail}
            </Typography>
            {/*
              A COUNT WITH NO ROWS IS NOT A CLEAN FINDING. It is a response
              that could not name them — the state a client chunk cached from
              before the per-row findings lands in. Rendering an empty table
              there would report "no rows" for a finding whose count says
              otherwise, on a page about money owed to a state.
            */}
            {!active.namesRows ? (
              <Alert severity="warning">
                <AlertTitle>{'This response cannot name these rows'}</AlertTitle>
                {`The period reports ${active.count} of these and carries no ` +
                  'per-row findings, which is what a response from before ' +
                  'they existed looks like. Reload the page; if it persists, ' +
                  'export the working papers and read the rows there.'}
              </Alert>
            ) : (
              <>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{'Invoice'}</TableCell>
                      <TableCell>{'Bucketed as'}</TableCell>
                      <TableCell align="right">{'Gross'}</TableCell>
                      <TableCell align="right">{'Tax'}</TableCell>
                      <TableCell>{'Paid'}</TableCell>
                      <TableCell>{'Also'}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {visible.map((row) => (
                      <TableRow key={row.invoiceId}>
                        <TableCell>
                          {/*
                            Into Stripe, where the invoice can be read and
                            fixed. `noopener` because the dashboard is another
                            origin and the console's tab must not be reachable
                            from it.
                          */}
                          {row.stripeUrl ? (
                            <Link
                              href={row.stripeUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              variant="body2"
                              sx={{ fontFamily: 'monospace' }}
                            >
                              {row.invoiceId}
                            </Link>
                          ) : (
                            <Typography
                              variant="body2"
                              sx={{ fontFamily: 'monospace' }}
                            >
                              {row.invoiceId}
                            </Typography>
                          )}
                          {row.orgId ? (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ display: 'block' }}
                            >
                              {row.orgId}
                            </Typography>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Typography
                            variant="body2"
                            sx={{ fontFamily: 'monospace' }}
                            color={
                              row.jurisdiction === 'unknown'
                                ? 'warning.main'
                                : 'text.primary'
                            }
                          >
                            {row.jurisdiction === 'unknown'
                              ? 'No address'
                              : row.jurisdiction}
                          </Typography>
                        </TableCell>
                        <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                          {`$${row.grossDollars}`}
                        </TableCell>
                        <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                          {`$${row.taxDollars}`}
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" color="text.secondary">
                            {row.paidAt ? row.paidAt.slice(0, 10) : 'Not stated'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          {/*
                            The row's OTHER findings. A row that raises two is
                            one problem, and seeing both at once is what stops
                            it being fixed twice or half.
                          */}
                          <Stack
                            direction="row"
                            spacing={0.5}
                            sx={{ flexWrap: 'wrap', gap: 0.5 }}
                          >
                            {row.findings
                              .filter((finding) => finding !== active.id)
                              .map((finding) => (
                                <Chip
                                  key={finding}
                                  size="small"
                                  variant="outlined"
                                  label={finding}
                                />
                              ))}
                          </Stack>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <ListPagination
                  page={page}
                  pageSize={pageSize}
                  rowCount={visible.length}
                  count={rows.length}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                  disabled={loading}
                />
              </>
            )}
          </>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
StaffTaxFindingsCard.displayName = 'StaffTaxFindingsCard'
