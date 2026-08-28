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
import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import { CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Chip,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import StaffOnly from '../../../../components/staff-only.component'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import useIsStaff from '../../../../hooks/use-is-staff'
import type { AssistMiningReport } from '../../../../utils/assist-signal-mining'
import { costSplitRows } from '../../../../utils/assist-signal-mining'

/**
 * The Assist docs-gap and cost board (AGL-1860, AGL-2252) — the read side of
 * the data loop, and until now the half that did not exist.
 *
 * AGL-1972 split every assist turn into prose that expires and a signal that
 * does not, on the reasoning that "the corpus the loop needs outlives the
 * words that produced it". That is only true once something reads the corpus.
 * This is that something.
 *
 * Three panels, in the order the questions actually get asked:
 *
 *  1. **Docs gaps** — cited pages ranked by thumbs-down, then volume. A page
 *     high on this list is being found and is not answering, which is a docs
 *     issue with its evidence attached. The `orgs` column is the sanity
 *     check: a gap one workspace has is a workspace, not a gap.
 *  2. **Ungrounded questions** — turns where retrieval matched nothing at
 *     all, grouped by the screen the person was on. These cite no page, so
 *     they can never appear in the ranking above; a missing page is invisible
 *     to anything keyed on paths, and this panel is the only place it shows.
 *  3. **Cost** — per org, dearest first, plus the fleet totals and the
 *     cache-read rate. The rate is not decoration: the cached system prefix
 *     measures 1,030–1,190 tokens against Sonnet 5's 1,024-token minimum, so
 *     whether it caches is an empirical question the chat route could only
 *     pose, and this is the evidence.
 *
 * Read through `/api/admin/assist-signals` rather than Firestore directly.
 * `assistSignals` is absent from the rules file on purpose — default-deny for
 * every client — which is exactly what lets it hold cross-tenant analytics.
 */

const money = (value: number) =>
  `$${(Number(value) || 0).toFixed(Math.abs(Number(value) || 0) < 1 ? 4 : 2)}`

const percent = (value: number | null) =>
  value == null ? '—' : `${Math.round(value * 100)}%`

/**
 * One cost breakdown — tier or model, dearest first (AGL-2340).
 *
 * The `share` column is why this is a table rather than a row of chips. The
 * decision it feeds is always comparative — "is free eating the margin" is a
 * question about proportion, not about a dollar figure — and a reader asked
 * to divide two numbers in their head does not do it.
 *
 * `turns` is kept beside the money on purpose: a tier that is a third of the
 * traffic and two thirds of the bill is the finding, and neither column says
 * that alone.
 *
 * ## Full width, and stacked rather than side by side
 *
 * Both breakdowns split the SAME total, so the reader's act is scanning one
 * against the other: does the tier carrying the turns also carry the money,
 * and would a cheaper model on the common path move it. Two tables squeezed
 * into thirds of a row put each Cost column at a different horizontal
 * position, so that comparison becomes two separate readings held in the
 * head. Stacked full-width, the Cost and Share columns of both land on the
 * same axis and the comparison is a glance down the page.
 *
 * ## Why the caption is not a row of the table
 *
 * It used to be a `colSpan={4}` cell in `TableHead`, which gave it header
 * styling and made the header two rows deep — so this table's head sat at a
 * different weight and height from the four sibling tables on the same page,
 * which is most of what made the card read as a foreign fragment.
 *
 * ## No footer, and why
 *
 * A breakdown has one row per tier and one per model — single digits, and
 * bounded by the vocabulary rather than by a collection that grows. There is
 * no page two to go to, and a pager over four rows is furniture that teaches
 * a reader to look for pages that never exist.
 */
function CostSplitTable({
  caption,
  label,
  rows,
  totalUsd,
}: {
  caption: string
  label: string
  rows: { key: string; messages: number; estCostUsd: number }[]
  totalUsd: number
}) {
  return (
    <Stack spacing={1} sx={{ width: '100%' }}>
      <Typography variant="subtitle2">{caption}</Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{label}</TableCell>
            <TableCell align="right">Turns</TableCell>
            <TableCell align="right">Cost</TableCell>
            <TableCell align="right">Share</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {!rows.length ? (
            <TableRow>
              <TableCell colSpan={4}>
                <Typography variant="body2" color="text.secondary">
                  No turns in this sample.
                </Typography>
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell>{row.key}</TableCell>
                <TableCell align="right">
                  {row.messages.toLocaleString()}
                </TableCell>
                <TableCell align="right">{money(row.estCostUsd)}</TableCell>
                <TableCell align="right">
                  {percent(totalUsd > 0 ? row.estCostUsd / totalUsd : null)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Stack>
  )
}

/**
 * The count line under a RANKED table — how much of the ranking is on screen.
 *
 * These three tables are not paged, and the reason is the same for all of
 * them: each is a ranking whose value is its top. Page two of "where are the
 * docs thin" is, by construction, the pages least worth rewriting, and a
 * pager over a ranking invites a reader to walk it as if position carried no
 * meaning. What a pager WOULD have given honestly is the count — how much of
 * this am I looking at, and is there more — so that is what this says, and it
 * says it whether or not the ranking was cut.
 *
 * Rendered even when nothing was cut. A disclosure that appears only on
 * truncation is one a reader has never seen before the day it matters, and
 * cannot tell from a card that simply has no footer.
 */
function RankingFootnote({
  shown,
  total,
  noun,
}: {
  shown: number
  total: number
  /** Both forms: a fleet of one is the common case on a young install. */
  noun: { one: string; many: string }
}) {
  if (!total) return null
  const counted = `${total.toLocaleString()} ${total === 1 ? noun.one : noun.many}`
  return (
    <Typography variant="caption" color="text.secondary">
      {shown >= total
        ? `Showing all ${counted}.`
        : `Showing the top ${shown.toLocaleString()} of ${counted}. This is a ranking, not a page — what is past the cut is what it ranked lowest.`}
    </Typography>
  )
}

const AdminAssistSignals: NextPageWithLayout<Record<string, never>> = () => {
  const { data: user } = useUser()
  const isStaff = useIsStaff()
  const [report, setReport] = useState<AssistMiningReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let active = true
    void (async () => {
      // Gated on `isStaff === true`, never on its loading `null`. A request
      // fired from the loading default is the shape that answers a question
      // nobody asked — here it would simply 403, but the habit is the point.
      if (isStaff !== true || !user) return
      setLoading(true)
      setError(null)
      try {
        const idToken = await (
          user as { getIdToken?: () => Promise<string> }
        )?.getIdToken?.()
        const response = await fetch('/api/admin/assist-signals', {
          headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
        })
        const body = await response.json().catch(() => null)
        if (!active) return
        if (!response.ok) {
          setError(body?.error ?? 'Assist signal lookup failed')
        } else {
          setReport(body as AssistMiningReport)
        }
      } catch {
        if (active) setError('Assist signal lookup failed')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [isStaff, user])

  const totals = report?.totals
  // The route serves the prose beside the report (AGL-2314) — it is not part
  // of the pure miner's output, because the miner never touches Firestore.
  const prose = ((report as any)?.prose ?? []) as Array<Record<string, unknown>>

  return (
    <DashboardLayout
      breadcrumbItems={[
        { children: 'Staff', href: buildRoute(Route.ADMIN_OVERVIEW) },
        {
          children: 'Assist signal',
          href: buildRoute(Route.ADMIN_ASSIST_SIGNALS),
        },
      ]}
      help="assistSignals"
      header={{
        // The configured brand, not ours (AGL-2153/2260): a white-label
        // deployment and a self-host operator both read this header.
        children: `${PLATFORM_BRAND_NAME} Assist Signal`,
        icon: { path: ICON_VARIANT_SYMBOL_SECURE.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <StaffOnly>
          <Stack spacing={3}>
            {loading && <LinearProgress />}
            {error && <Alert severity="error">{error}</Alert>}
            {report?.truncated && (
              // Never a silent partial. A ranking cut short looks exactly
              // like a complete one, and this one decides where docs effort
              // goes.
              <Alert severity="warning">
                {`Ranked the first ${report.scanned.toLocaleString()} signals only — there are more. Every number below describes that sample, not the fleet.`}
              </Alert>
            )}

            <CardDisplay
              header={'Fleet'}
              help={docsHelp('assistSignals', { anchor: '#fleet' })}
              contentGutterX
              contentGutterY
            >
              {!totals ? (
                <Typography variant="body2" color="text.secondary">
                  {loading ? 'Reading signals…' : 'No assist turns recorded yet.'}
                </Typography>
              ) : (
                // Neither `gap` nor `flexWrap` is a Stack prop under MUI 9
                // — both go through `sx` or it is a typecheck error.
                // AGL-1891 is the same drift, in the Assist panel itself.
                <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
                  <Chip label={`${totals.messages.toLocaleString()} turns`} />
                  <Chip label={`${money(totals.estCostUsd)} estimated`} />
                  {/*
                   * The headline number for whether Assist is affordable to
                   * leave on (AGL-2486): the share of turns answered from the
                   * docs index or the answer cache, with no model call and no
                   * provider spend. Placed beside the money rather than with
                   * the token chips because it is the thing that MOVES the
                   * money — every point of it is a turn that cost nothing.
                   *
                   * Success above half, because that is the point at which
                   * the cheap path is carrying the feature rather than
                   * trimming it.
                   */}
                  <Chip
                    // `?? 0` on the count, and it is not defensive noise: this
                    // whole object is JSON off `/api/admin/assist-signals`,
                    // and a chip that throws on a missing number takes the
                    // ENTIRE staff page down with it rather than rendering a
                    // dash. The rate beside it is legitimately nullable —
                    // `percent` renders that — so the two are handled
                    // differently on purpose.
                    label={`answered free ${percent(totals.deflectionRate)} (${(
                      totals.deflected ?? 0
                    ).toLocaleString()})`}
                    color={
                      totals.deflectionRate != null && totals.deflectionRate > 0.5
                        ? 'success'
                        : 'default'
                    }
                  />
                  <Chip
                    label={`${totals.inputTokens.toLocaleString()} in / ${totals.outputTokens.toLocaleString()} out`}
                  />
                  <Chip
                    label={`cache reads ${percent(totals.cacheReadRate)}`}
                    color={
                      totals.cacheReadRate != null && totals.cacheReadRate > 0.5
                        ? 'success'
                        : 'default'
                    }
                  />
                  {/*
                   * Cache WRITES, beside the reads (AGL-2340). The pair only
                   * means anything together: a write is billed at a premium
                   * over a fresh input token and pays for itself only if
                   * enough reads follow it. A board that showed the cheap
                   * half alone made a prefix that is re-written every turn —
                   * the expensive failure mode — look like a caching win.
                   */}
                  <Chip
                    label={`cache writes ${totals.cacheWriteTokens.toLocaleString()}`}
                  />
                  <Chip
                    label={`👍 ${totals.feedback.up} · 👎 ${totals.feedback.down} · unrated ${totals.feedback.none}`}
                  />
                  {Object.entries(totals.stopReasons).map(([reason, count]) => (
                    <Chip
                      key={reason}
                      size="small"
                      // A refusal and a truncation both read as a short
                      // answer in the data and need opposite fixes: a rising
                      // refusal rate is a prompt problem, a rising max_tokens
                      // rate is a ceiling problem.
                      color={
                        reason === 'refusal' || reason === 'max_tokens'
                          ? 'warning'
                          : 'default'
                      }
                      label={`${reason}: ${count}`}
                    />
                  ))}
                </Stack>
              )}
            </CardDisplay>

            <CardDisplay
              header={'Where the money goes'}
              help={docsHelp('assistSignals', { anchor: '#where-the-money-goes' })}
              contentGutterX
              contentGutterY
            >
              <Typography variant="body2" color="text.secondary" gutterBottom>
                The same spend split two ways. By tier answers whether the free
                cap or the paid price is the lever; by model answers whether a
                cheaper model on the common path would do — the one lever that
                never reaches the customer.
              </Typography>
              {!totals ? (
                <Typography variant="body2" color="text.secondary">
                  {loading ? 'Reading signals…' : 'No assist turns recorded yet.'}
                </Typography>
              ) : totals.estCostUsd === 0 ? (
                /*
                 * ZERO SPEND IS A FINDING, NOT AN EMPTY TABLE.
                 *
                 * Rendered as a sentence rather than two grids of `$0.0000`
                 * and em dashes. A share column is a proportion of the total,
                 * and there is no proportion of nothing — so the grid could
                 * only ever print a dash in every cell, which reads as a card
                 * that failed rather than as a bill that is genuinely zero.
                 *
                 * The two zeros mean OPPOSITE things and are separated here.
                 * Every turn deflected is the deflection path working: those
                 * turns were answered from the docs index or the answer cache
                 * with no provider call, so nothing was spent because nothing
                 * was bought. A turn that reached a model and still priced at
                 * zero is the other case — the model is missing from
                 * `ASSIST_MODEL_RATES_USD` and its spend is landing nowhere,
                 * which is a hole in the meter and must not be reported as
                 * thrift.
                 */
                <Typography variant="body2" color="text.secondary">
                  {totals.deflected >= totals.messages
                    ? `Nothing spent on these ${totals.messages.toLocaleString()} turns — every one was answered from the docs index or the answer cache, with no model call. There is no split to show until a turn reaches a provider.`
                    : `${(totals.messages - totals.deflected).toLocaleString()} of ${totals.messages.toLocaleString()} turns reached a model and every one priced at $0. That is a gap in the rate table, not a saving — the serving model has no entry in the cost model, so its spend is landing nowhere.`}
                </Typography>
              ) : (
                <Stack spacing={3}>
                  <CostSplitTable
                    caption="By tier"
                    label="Tier"
                    rows={costSplitRows(totals.byTier)}
                    totalUsd={totals.estCostUsd}
                  />
                  <CostSplitTable
                    caption="By model"
                    label="Model"
                    rows={costSplitRows(totals.byModel)}
                    totalUsd={totals.estCostUsd}
                  />
                </Stack>
              )}
            </CardDisplay>

            <CardDisplay
              header={'Docs gaps'}
              help={docsHelp('assistSignals', { anchor: '#docs-gaps' })}
              contentGutterX
              contentGutterY
            >
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Cited pages ranked by thumbs-down, then by how often a question
                landed there. A page near the top is being found and is not
                answering — that is a docs issue with its evidence attached.
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Docs page</TableCell>
                    <TableCell align="right">Questions</TableCell>
                    <TableCell align="right">👍</TableCell>
                    <TableCell align="right">👎</TableCell>
                    <TableCell align="right">Down rate</TableCell>
                    <TableCell align="right">Orgs</TableCell>
                    <TableCell align="right">Cost</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {!report?.docsGaps?.length ? (
                    <TableRow>
                      <TableCell colSpan={7}>
                        <Typography variant="body2" color="text.secondary">
                          Nothing cited yet.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    report.docsGaps.map((row) => (
                      <TableRow key={row.path}>
                        <TableCell sx={{ fontFamily: 'monospace' }}>
                          {row.path}
                        </TableCell>
                        <TableCell align="right">{row.questions}</TableCell>
                        <TableCell align="right">{row.up}</TableCell>
                        <TableCell align="right">{row.down}</TableCell>
                        <TableCell align="right">
                          {percent(row.downRate)}
                        </TableCell>
                        <TableCell align="right">{row.orgs}</TableCell>
                        <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                          {money(row.estCostUsd)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              <RankingFootnote
                shown={report?.docsGaps?.length ?? 0}
                total={report?.ranked?.docsGaps ?? 0}
                noun={{ one: 'cited page', many: 'cited pages' }}
              />
            </CardDisplay>

            <CardDisplay
              header={'Questions the docs could not answer'}
              help={docsHelp('assistSignals', { anchor: '#questions-the-docs-could-not-answer' })}
              contentGutterX
              contentGutterY
            >
              <Typography variant="body2" color="text.secondary" gutterBottom>
                {report
                  ? `${report.ungrounded.questions.toLocaleString()} turns matched no documentation at all, ${report.ungrounded.down} of them rated down. These cite no page, so they cannot appear in the ranking above — a missing page is invisible to anything keyed on paths.`
                  : 'Turns where retrieval matched no documentation at all.'}
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Asked from</TableCell>
                    <TableCell align="right">Questions</TableCell>
                    <TableCell align="right">👎</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {!report?.ungrounded?.routes?.length ? (
                    <TableRow>
                      <TableCell colSpan={3}>
                        <Typography variant="body2" color="text.secondary">
                          Every question so far matched something.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    report.ungrounded.routes.map((row) => (
                      <TableRow key={row.route}>
                        <TableCell sx={{ fontFamily: 'monospace' }}>
                          {row.route}
                        </TableCell>
                        <TableCell align="right">{row.questions}</TableCell>
                        <TableCell align="right">{row.down}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              <RankingFootnote
                shown={report?.ungrounded?.routes?.length ?? 0}
                total={report?.ranked?.ungroundedRoutes ?? 0}
                noun={{ one: 'screen', many: 'screens' }}
              />
            </CardDisplay>

            {/*
              * THE WORDS THEMSELVES (AGL-2314).
              *
              * `assistExchanges` held the question a customer typed and the
              * answer we gave, for 180 days, and `assist-usage.ts` called it
              * "the data loop's corpus". Nothing read it — so we retained
              * customers' words, and committed publicly in the privacy policy
              * to retaining them, for zero product value. The two panels above
              * can say a page fails and cannot say what people were trying to
              * do; only this can.
              *
              * Behind a disclosure, and only for turns that FAILED — the shape
              * AGL-2294 used for churn free text. The route fetches nothing
              * else, so the panel being closed is not the privacy control; the
              * shortlist is.
              */}
            <CardDisplay
              header={'What people actually asked'}
              help={docsHelp('assistSignals', { anchor: '#what-people-actually-asked' })}
              contentGutterX
              contentGutterY
            >
              <Typography variant="body2" color="text.secondary" gutterBottom>
                {'The verbatim question behind each failing turn — rated down, ' +
                  'or grounded in nothing. Kept for 180 days and then deleted, ' +
                  'so an older failure shows its counts with the words gone. ' +
                  'Who asked is deliberately not shown: the question is what ' +
                  'this is for.'}
              </Typography>
              {!prose.length ? (
                <Typography variant="body2" color="text.secondary">
                  {loading
                    ? 'Reading exchanges…'
                    : 'No failing turns in this sample — nothing to read.'}
                </Typography>
              ) : (
                <Accordion>
                  <AccordionSummary expandIcon={<span aria-hidden>{'▾'}</span>}>
                    <Typography variant="body2">
                      {`Show ${prose.length} question${prose.length === 1 ? '' : 's'}`}
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Stack spacing={2}>
                      {prose.map((row: any) => (
                        <Stack key={`${row.orgId}:${row.exchangeId}`} spacing={0.5}>
                          <Stack
                            direction="row"
                            sx={{ flexWrap: 'wrap', gap: 1, alignItems: 'center' }}
                          >
                            <Chip
                              size="small"
                              color={row.feedback === 'down' ? 'error' : 'default'}
                              label={
                                row.feedback === 'down'
                                  ? 'rated down'
                                  : 'no documentation matched'
                              }
                            />
                            <Typography variant="caption" color="text.secondary">
                              <Box
                                component="span"
                                sx={{ fontFamily: 'monospace' }}
                              >
                                {row.route}
                              </Box>
                              {` · ${row.orgLabel ?? row.orgId}`}
                            </Typography>
                          </Stack>
                          {row.expired ? (
                            // Said out loud. A shortlist quietly shorter than
                            // the failure count it came from would read as
                            // "these are all the failures".
                            <Typography variant="body2" color="text.secondary">
                              {'The words are past their 180-day retention and ' +
                                'have been deleted. The counts above still ' +
                                'include this turn.'}
                            </Typography>
                          ) : (
                            <>
                              <Typography variant="body2">
                                {row.question || '(no question recorded)'}
                              </Typography>
                              {row.answer ? (
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                >
                                  {`We said: ${row.answer}${row.answerTruncated ? '…' : ''}`}
                                </Typography>
                              ) : null}
                            </>
                          )}
                        </Stack>
                      ))}
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              )}
            </CardDisplay>

            <CardDisplay
              header={'What Assist costs, by workspace'}
              help={docsHelp('assistSignals', { anchor: '#what-assist-costs-by-workspace' })}
              contentGutterX
              contentGutterY
            >
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Our estimated cost at the serving model&apos;s list rates —
                telemetry for tuning price against margin, not a bill.
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Workspace</TableCell>
                    <TableCell align="right">Turns</TableCell>
                    <TableCell align="right">In</TableCell>
                    <TableCell align="right">Out</TableCell>
                    <TableCell align="right">Cache reads</TableCell>
                    <TableCell align="right">👎</TableCell>
                    <TableCell align="right">Cost</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {!report?.orgs?.length ? (
                    <TableRow>
                      <TableCell colSpan={7}>
                        <Typography variant="body2" color="text.secondary">
                          No workspace has used Assist yet.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    report.orgs.map((row) => (
                      <TableRow key={row.orgId}>
                        {/*
                          The workspace's NAME. The route resolves it and
                          falls back to the id, so a deleted workspace still
                          renders a lead a staff member can search for rather
                          than an empty cell. Not monospaced: monospace is how
                          this page marks a value you copy, and a customer's
                          name is one you read.
                        */}
                        <TableCell>{row.orgLabel ?? row.orgId}</TableCell>
                        <TableCell align="right">{row.messages}</TableCell>
                        <TableCell align="right">
                          {row.inputTokens.toLocaleString()}
                        </TableCell>
                        <TableCell align="right">
                          {row.outputTokens.toLocaleString()}
                        </TableCell>
                        <TableCell align="right">
                          {row.cacheReadTokens.toLocaleString()}
                        </TableCell>
                        <TableCell align="right">{row.down}</TableCell>
                        <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                          {money(row.estCostUsd)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              <RankingFootnote
                shown={report?.orgs?.length ?? 0}
                total={report?.ranked?.orgs ?? 0}
                noun={{ one: 'workspace', many: 'workspaces' }}
              />
            </CardDisplay>
          </Stack>
        </StaffOnly>
      </Container>
    </DashboardLayout>
  )
}
AdminAssistSignals.displayName = 'Page:AdminAssistSignals'

export default AdminAssistSignals
