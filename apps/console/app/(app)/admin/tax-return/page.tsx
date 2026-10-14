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
 * SALES TAX — the return for one filing period (AGL-1900 / AGL-1811).
 *
 * AGL-1811 built the mechanism and stopped there: `GET /api/admin/tax-return`
 * computed a filable return that only a curl could reach. This page is the
 * surface, and the standing rule it was raised under — *a capability
 * reachable only by curling a route is not shipped* — is why it exists.
 *
 * ## What this page must never do
 *
 * **Never let a qualified figure read as a final one.** The
 * verdict banner sits ABOVE the figures, not beside them, and a period with
 * a blocking finding renders the numbers dimmed under a "do not file" error
 * rather than as a clean total a tired preparer copies into Webfile. A
 * silently-dropped row is a filing error made under penalty of perjury; the
 * whole reason `attention` exists is that an undercount presented as a total
 * is the one failure this record cannot have.
 *
 * **Never show platform totals where the return wants one jurisdiction.** The
 * filing figures come from `byJurisdiction[configured code]`. The "Aglyn's own
 * sales by jurisdiction" table below is the audit trail for why the rest of
 * the quarter is not on the return.
 *
 * **Never leave the jurisdiction unsaid.** The same quarter filed in two
 * jurisdictions is two different returns, and this page named neither — it
 * read Texas everywhere and said so nowhere, so a self-host operator filing in
 * California or the United Kingdom was handed Texas Comptroller lines with
 * their own figures in them. The heading, the figures card and the export all
 * name the configured jurisdiction, and a jurisdiction with no exporter of its
 * own gets a breakdown that says out loud it is not a return.
 *
 * **Never let one taxpayer's table answer for another's** (AGL-1956). That
 * table used to call itself the economic-nexus early warning, and it reads
 * `platformRevenue` — Aglyn's own invoices. Nexus from sales the platform
 * facilitated for others is a different taxpayer's money and is answered by
 * the facilitated-sales tables in each source's card. Adjacent tables, never
 * one: the rule that the operator's own invoices and a facilitated sale are
 * never summed is what keeps both figures meaning something.
 *
 * **Never claim a figure it did not compute.** Taxable purchases (use tax on
 * Aglyn's own purchases) is not in `platformRevenue`; the line says NOT
 * COMPUTED rather than printing a zero that would pass for a derived one.
 *
 * **Never leave a bucket in the JSON.** The route computes a set of figures
 * for the operator's own sales and one more for every plugin that sells
 * through the platform's account (AGL-2163, AGL-3080), and a bucket that
 * exists only in a response nobody sees is the failure this page was raised
 * to fix. Each source is rendered as its own card, worded by the plugin that
 * sold it, each with its own liability sentences, and with NO grand total
 * anywhere: adding them is the mistake the split exists to prevent. A source
 * the route could not read gets a card saying so, and blocks the verdict.
 *
 * Read-only, like the route: this page files nothing and writes nothing. The
 * filing happens at the authority's own keyboard — the Comptroller's Webfile,
 * for Texas — which is why the export is a spreadsheet of working papers and
 * the credentials ride along.
 */

import type {
  TaxReturnSection,
  TaxReturnSectionCell,
  TaxReturnSectionTable,
} from '@aglyn/aglyn/plugin-manager/plugin-tax-return-sources'
import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import { CardDisplay, Container, GridItems } from '@aglyn/shared-ui-jsx'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  LinearProgress,
  MenuItem,
  Stack,
  TableBody,
  TableCell,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import StaffOnly from '../../../../components/staff-only.component'
import StaffTaxFindingsCard from '../../../../components/staff-tax-findings-card.component'
import StaffTaxablePurchasesCard from '../../../../components/staff-taxable-purchases-card.component'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import { useIsStaff } from '../../../../hooks/use-is-staff'
import { DEFAULT_FIRST_TAXABLE_PERIOD } from '../../../../utils/tax-filing-config'
import { taxRegistrationSetupHint } from '../../../../utils/tax-jurisdictions'
import {
  centsToDollars,
  defaultTaxReturnPeriod,
  taxReturnAttention,
  taxReturnCsv,
  taxReturnCsvFilename,
  taxReturnFilingLines,
  taxReturnJurisdictionRows,
  taxReturnPeriodOptions,
  taxReturnRegistration,
  type TaxReturnPayload,
} from '../../../../utils/tx-return-webfile'
import StaffTableHead from '../../../../components/staff-table-head.component'

/**
 * ONE FACILITATED-SALES SOURCE on the return (AGL-2163, AGL-3080).
 *
 * The sales the operator facilitated for others are each a plugin's to read,
 * classify and word — the route asks every declared source through
 * `plugin-tax-return-sources`, and this card draws whatever a source
 * answered: its introduction, its tables, its label/value figures and the
 * note a truncated read owes the reader. It names no plugin and holds no
 * sentence about any plugin's sales; every word about them is the source's.
 *
 * A REFUSED source draws a card too, in error. Its sales are in no figure on
 * the page and the verdict above blocks on it; a card that simply went
 * missing would look exactly like a source with nothing to report.
 */
interface TaxReturnSourceCardProps {
  section: TaxReturnSection
}

/** The first cell of a source's row: its text, its tag and its caption. */
function LeadCell({ cell }: { cell: TaxReturnSectionCell }) {
  const line = (
    <Stack
      useFlexGap
      direction="row"
      spacing={1}
      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
    >
      <Typography variant="body2">{cell.text}</Typography>
      {cell.tag ? (
        <Chip
          size="small"
          {...(cell.tag.tone === 'attention'
            ? { color: 'warning' as const }
            : { variant: 'outlined' as const })}
          label={cell.tag.label}
        />
      ) : null}
    </Stack>
  )
  if (!cell.caption) return line
  return (
    <Stack spacing={0.5}>
      {line}
      <Typography variant="caption" color="text.secondary">
        {cell.caption}
      </Typography>
    </Stack>
  )
}

function SourceTable({
  table,
  first,
}: {
  table: TaxReturnSectionTable
  first: boolean
}) {
  return (
    <>
      {table.heading ? (
        <Typography variant="subtitle2" sx={{ mt: first ? 0 : 3 }}>
          {table.heading}
        </Typography>
      ) : null}
      {table.description ? (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mt: 0.5, mb: 1.5 }}
        >
          {table.description}
        </Typography>
      ) : null}
      <ScrollTable size="small">
        <StaffTableHead>
          <TableRow>
            {table.columns.map((column, index) => (
              <TableCell
                key={`${index}:${column.label}`}
                {...(column.numeric ? { align: 'right' as const } : {})}
              >
                {column.label}
              </TableCell>
            ))}
          </TableRow>
        </StaffTableHead>
        <TableBody>
          {table.rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={Math.max(1, table.columns.length)}>
                <Typography variant="body2" color="text.secondary">
                  {table.empty}
                </Typography>
              </TableCell>
            </TableRow>
          ) : (
            table.rows.map((row) => (
              <TableRow key={row.key}>
                {row.cells.map((cell, index) => {
                  const column = table.columns[index]
                  return (
                    <TableCell
                      key={index}
                      {...(column?.numeric ? { align: 'right' as const } : {})}
                      sx={{
                        ...(column?.money ? { fontFamily: 'monospace' } : {}),
                        ...(cell.strong ? { fontWeight: 600 } : {}),
                      }}
                    >
                      {index === 0 ? <LeadCell cell={cell} /> : cell.text}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))
          )}
        </TableBody>
      </ScrollTable>
      {table.footnote ? (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mt: 1.5 }}
        >
          {table.footnote}
        </Typography>
      ) : null}
    </>
  )
}

function TaxReturnSourceCard({ section }: TaxReturnSourceCardProps) {
  if (section.outcome !== 'answered') {
    return (
      <CardDisplay
        header={`Sales from the “${section.pluginId}” plugin`}
        help={docsHelp('salesTaxReturn', { anchor: '#plugin-sales' })}
        contentGutterX
        contentGutterY
      >
        <Alert severity="error">
          {`${section.reason} None of its sales are in any figure on this ` +
            'page. Do not file from this.'}
        </Alert>
      </CardDisplay>
    )
  }
  return (
    <CardDisplay
      header={section.title}
      help={docsHelp('salesTaxReturn', { anchor: '#plugin-sales' })}
      contentGutterX
      contentGutterY
    >
      {section.intro ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {section.intro}
        </Typography>
      ) : null}
      {section.tables.map((table, index) => (
        <SourceTable
          key={`${index}:${table.heading ?? ''}`}
          table={table}
          first={index === 0}
        />
      ))}
      {section.figures.length ? (
        <Stack spacing={1} sx={{ mt: section.tables.length ? 3 : 0 }}>
          {section.figures.map((line) => (
            <Stack key={line.label} spacing={0.25}>
              <Stack
                direction="row"
                spacing={1}
                sx={{ justifyContent: 'space-between' }}
              >
                <Typography variant="body2">{line.label}</Typography>
                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                  {line.value}
                </Typography>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {line.note}
              </Typography>
            </Stack>
          ))}
        </Stack>
      ) : null}
      {section.truncated ? (
        <Typography variant="body2" color="error" sx={{ mt: 2 }}>
          {`${section.name} rows exceeded the row cap — these figures are ` +
            'a lower bound.'}
        </Typography>
      ) : null}
    </CardDisplay>
  )
}

const AdminTaxReturn: NextPageWithLayout<Record<string, never>> = () => {
  const { data: user } = useUser()
  const isStaff = useIsStaff()
  const { enqueueSnackbar } = useSnackbar()

  // The clock is read ONCE per mount rather than per render: the period list
  // and the default selection must not shift under a page left open across
  // a quarter boundary while someone is reading it.
  const [now] = useState(() => new Date())
  /**
   * The earliest filable period, from Platform settings.
   *
   * `null` means the answer has not settled yet, and NOTHING below builds a
   * menu or fetches a return until it has. The floor used to be a compiled-in
   * constant precisely because the menu had to exist before the first request
   * and the configuration arrived on the response to it; a separate,
   * identifier-free settings read breaks that circle, so an operator whose
   * obligation began before this deployment's own is offered their own
   * periods instead of having to reach them by hand.
   *
   * Degrade-safe: any failure settles on the built-in floor rather than
   * leaving the page without a menu.
   */
  const [floor, setFloor] = useState<string | null>(null)
  useEffect(() => {
    if (!isStaff || !user) return
    let active = true
    void (async () => {
      let configured: string | null = null
      try {
        const response = await authorizedFetch(user, '/api/admin/tax-filing')
        const body = await response.json().catch(() => ({}))
        const value = body?.config?.firstTaxablePeriod
        if (response.ok && typeof value === 'string') configured = value
      } catch {
        configured = null
      }
      if (active) setFloor(configured ?? DEFAULT_FIRST_TAXABLE_PERIOD)
    })()
    return () => {
      active = false
    }
  }, [isStaff, user])
  const periodOptions = useMemo(
    () => (floor ? taxReturnPeriodOptions(now, floor) : []),
    [now, floor],
  )
  const [period, setPeriod] = useState('')
  useEffect(() => {
    if (!floor) return
    // Re-selects only when the current choice is not on the menu the floor
    // produced — which is the case on first paint, and again if an operator
    // moves the floor past the period a reader had open.
    setPeriod((current) =>
      periodOptions.some((option) => option.value === current)
        ? current
        : defaultTaxReturnPeriod(now, floor),
    )
  }, [floor, now, periodOptions])

  const [payload, setPayload] = useState<TaxReturnPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  /*
   * Bumped when Item 3 is entered, so the figures card shows the entry
   * immediately rather than on the next period change. The return is the
   * document; the entry card only edits one line of it, and a line that
   * updates in one place and not the other is two answers for one figure.
   */
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!isStaff || !user || !period) return
    let active = true
    setLoading(true)
    // The previous period's figures are cleared BEFORE the new ones arrive.
    // Leaving them on screen under a newly-selected period label would put
    // Q3's totals under a Q4 heading for as long as the fetch takes, and a
    // screenshot of that is indistinguishable from a real answer.
    setPayload(null)
    setError(null)
    void (async () => {
      try {
        const response = await authorizedFetch(
          user,
          `/api/admin/tax-return?period=${encodeURIComponent(period)}`,
        )
        const body = await response.json().catch(() => ({}))
        if (!active) return
        if (!response.ok) {
          setError(body?.error ?? 'Tax return summary failed')
        } else {
          setPayload(body as TaxReturnPayload)
        }
      } catch {
        if (active) setError('Tax return summary failed')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [isStaff, user, period, reloadToken])

  const verdict = useMemo(() => taxReturnAttention(payload), [payload])
  const registration = useMemo(() => taxReturnRegistration(payload), [payload])
  // WHICH AUTHORITY THIS IS FOR. It rides on the payload, so nothing names a
  // jurisdiction until the response has said which one — a heading that
  // defaults to Texas while the request is in flight is a Texas return in the
  // only glance most readers give it.
  const filing = registration.jurisdiction
  // Named only once the response has said which jurisdiction it is. Copy that
  // reads "US-TX" for the second before a GB deployment's figures land is the
  // same wrong-jurisdiction glance the heading is guarded against.
  const filingName = payload ? filing.code : 'The filing jurisdiction'
  const filingLines = useMemo(() => taxReturnFilingLines(payload), [payload])
  const jurisdictions = useMemo(
    () => taxReturnJurisdictionRows(payload),
    [payload],
  )
  // Every facilitated-sales source the route read, answered or refused
  // (AGL-2163/3080). Nothing is rendered for them until the response has
  // said which sources there are.
  const sources = useMemo(
    () => (Array.isArray(payload?.sources) ? payload.sources : []),
    [payload],
  )

  /**
   * The rows that were REMOVED to reach the figures, in one sentence.
   *
   * Two rules take rows off this return and both are new: Aglyn's own tagged
   * purchases are not sales to a state, and an untaxed row paid before the
   * configured obligation began could not have under-collected. Either can
   * turn a finding into no finding, and a count that quietly becomes zero
   * looks exactly like a rule that broke. Null when neither removed anything,
   * so a genuinely clean period says nothing extra.
   */
  const excludedNote = useMemo(() => {
    const internal = Number(payload?.summary?.internal?.transactionCount ?? 0)
    const beforeObligation = Number(
      payload?.summary?.attention?.untaxedRowsBeforeObligation ?? 0,
    )
    const parts: string[] = []
    if (internal) {
      parts.push(
        `${internal} ${internal === 1 ? 'row is' : 'rows are'} Aglyn’s own ` +
          'purchases and are excluded from every figure below',
      )
    }
    if (beforeObligation) {
      parts.push(
        `${beforeObligation} untaxed ${
          beforeObligation === 1 ? 'row was' : 'rows were'
        } paid before the obligation began, so nothing was under-collected on ` +
          'them',
      )
    }
    if (!parts.length) return null
    return `${parts.join('; ')}. Both are listed on the findings card below.`
  }, [payload])

  const handleExport = useCallback(() => {
    const csv = taxReturnCsv(payload)
    if (!csv) return
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = taxReturnCsvFilename(
      payload?.period ?? period,
      payload?.registration?.jurisdiction,
    )
    anchor.click()
    URL.revokeObjectURL(url)
    enqueueSnackbar('Working papers exported', {
      variant: 'success',
      persist: false,
    })
  }, [payload, period, enqueueSnackbar])

  const refunds = payload?.summary?.refunds

  return (
    <DashboardLayout
      breadcrumbItems={[
        { children: 'Staff', href: buildRoute(Route.ADMIN_OVERVIEW) },
        { children: 'Sales tax', href: buildRoute(Route.ADMIN_TAX_RETURN) },
      ]}
      help={{ topic: 'salesTaxReturn', anchor: '#tax-return-page' }}
      header={{
        children: payload
          ? `${filing.label} Sales Tax Return`
          : 'Sales Tax Return',
        icon: { path: ICON_VARIANT_SYMBOL_SECURE.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <StaffOnly>
          <Stack spacing={3}>
            <CardDisplay
              header={'Filing period'}
              help={docsHelp('salesTaxReturn', {
                anchor: '#choosing-the-period',
                excerpt:
                  'Pick the quarter (or month) to file. The menu starts at the earliest filable period configured in Platform settings — September 2026 by default — because nothing earlier can be filed.',
              })}
              contentGutterX
              contentGutterY
            >
              <Stack
                useFlexGap
                direction={{ xs: 'column', sm: 'row' }}
                spacing={2}
                sx={{ alignItems: { sm: 'center' }, flexWrap: 'wrap' }}
              >
                <TextField
                  select

                  size="small"
                  label="Period"
                  value={period}
                  onChange={(event) => setPeriod(event.target.value)}
                  sx={{ minWidth: 220 }}
                >
                  {periodOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleExport}
                  disabled={!payload}
                >
                  {'Export working papers (CSV)'}
                </Button>
                {/*
                  WHICH JURISDICTION EVERY FIGURE BELOW IS FOR. Beside the
                  period, because the two together are the only thing that
                  identifies what is on this screen: the same quarter filed in
                  two jurisdictions is two different returns, and the page used
                  to name neither out loud.
                */}
                {payload ? (
                  <Chip
                    size="small"
                    color={filing.recognized ? 'default' : 'error'}
                    variant="outlined"
                    label={`Jurisdiction ${filing.code}`}
                  />
                ) : null}
                {/*
                  AGL-2021. The registration comes from server-only env via the
                  staff-gated route, so it is absent on any deployment that has
                  not configured one. Says so in words — and names the
                  variables to set — rather than rendering a label with nothing
                  after it, because a filer copying a number off this corner
                  must never be handed a blank.
                */}
                <Stack sx={{ ml: { sm: 'auto' } }}>
                  {!payload ? null : registration.configured ? (
                    <>
                      <Typography variant="caption" color="text.secondary">
                        {`${filing.registrationIdLabel} ${registration.registrationId}`}
                      </Typography>
                      {registration.filingId ? (
                        <Typography variant="caption" color="text.secondary">
                          {`${filing.filingIdLabel} ${registration.filingId}`}
                        </Typography>
                      ) : null}
                    </>
                  ) : (
                    <Typography variant="caption" color="warning.main">
                      {taxRegistrationSetupHint(filing)}
                    </Typography>
                  )}
                </Stack>
              </Stack>
              {loading ? <LinearProgress sx={{ mt: 2 }} /> : null}
            </CardDisplay>

            {error ? <Alert severity="error">{error}</Alert> : null}

            {/*
              THE VERDICT, above the figures. Its prominence is the feature:
              the counts it renders are the difference between a return and
              an understated return, and a number in a corner is a number
              nobody reads before pressing Submit at the Comptroller.
            */}
            {payload ? (
              verdict.clean ? (
                <Alert severity="success">
                  <AlertTitle>{'Every row read cleanly'}</AlertTitle>
                  {`All ${payload.summary?.transactionCount ?? 0} invoices in ` +
                    'this period were fully readable — no row was dropped, ' +
                    'and no figure below is a lower bound.'}
                  {/*
                    …AND WHAT WAS TAKEN OUT TO GET HERE. A clean verdict
                    reached by removing rows is not the same as a clean
                    verdict over all of them, and an operator who watched a
                    count fall to zero is owed the reason rather than left to
                    wonder whether the rule broke. The rows themselves are on
                    the findings card below.
                  */}
                  {excludedNote ? (
                    <Typography variant="body2" sx={{ mt: 1 }}>
                      {excludedNote}
                    </Typography>
                  ) : null}
                </Alert>
              ) : (
                <Alert severity={verdict.blocking ? 'error' : 'warning'}>
                  <AlertTitle>
                    {verdict.blocking
                      ? `Do not file — ${verdict.total} ${
                          verdict.total === 1 ? 'row needs' : 'rows need'
                        } attention`
                      : `${verdict.total} ${
                          verdict.total === 1 ? 'row needs' : 'rows need'
                        } attention before filing`}
                  </AlertTitle>
                  <Stack spacing={1.5} sx={{ mt: 1 }}>
                    {verdict.items.map((item) => (
                      <Stack key={item.id} spacing={0.5}>
                        <Stack
                          useFlexGap
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                        >
                          <Chip
                            size="small"
                            color={
                              item.severity === 'blocking' ? 'error' : 'warning'
                            }
                            label={
                              item.severity === 'blocking'
                                ? 'Blocking'
                                : 'Review'
                            }
                          />
                          <Typography variant="subtitle2">
                            {`${item.count} · ${item.label}`}
                          </Typography>
                        </Stack>
                        <Typography variant="body2">{item.detail}</Typography>
                      </Stack>
                    ))}
                  </Stack>
                  {excludedNote ? (
                    <Typography variant="body2" sx={{ mt: 1.5 }}>
                      {excludedNote}
                    </Typography>
                  ) : null}
                </Alert>
              )
            ) : null}

            {/*
              WHICH ROWS. The banner above states the counts; this states the
              invoices behind them. A finding that names a count and cannot
              name a row is a finding nobody can begin on — and the one this
              page raised most often says that if the row is a sale here, tax
              was under-collected and the platform pays it from the receipt.
            */}
            <StaffTaxFindingsCard payload={payload} loading={loading} />

            <CardDisplay
              header={payload ? filing.figuresHeader : 'Return figures'}
              help={docsHelp('salesTaxReturn', {
                anchor: '#the-figures',
                excerpt:
                  'The filing figures, in dollars, for the configured jurisdiction only. Everything sold elsewhere is on the jurisdiction table instead.',
              })}
              contentGutterX
              contentGutterY
            >
              {/*
                THE DOCUMENT SAYS WHAT IT IS. Texas has an exporter that knows
                Form 01-114's own lines; every other jurisdiction gets what was
                collected there and nothing about the form, because nothing
                here knows the form. A breakdown read as a return is the
                failure this banner exists to prevent, and it is stated on the
                screen as well as in the export because only one of those gets
                looked at twice.
              */}
              {payload && filing.form !== 'tx-webfile' ? (
                <Alert severity="info" sx={{ mb: 2 }}>
                  <AlertTitle>
                    {`A breakdown for manual filing — not a ${filing.code} return`}
                  </AlertTitle>
                  {'These are the figures a return is assembled from: what ' +
                    'was collected in this jurisdiction, and on what base. ' +
                    'No form for this jurisdiction is known here, so nothing ' +
                    'below is a form line — transcribe them onto the return ' +
                    'the authority asks for.'}
                </Alert>
              ) : null}
              {/*
                Dimmed, not hidden, while a blocking finding stands: the
                preparer still needs to see the figures to investigate the
                findings — they just must not read as ready to file.
              */}
              <Box
                sx={{
                  opacity: payload && verdict.blocking ? 0.45 : 1,
                  transition: 'opacity 120ms',
                }}
              >
                <ScrollTable size="small">
                  <StaffTableHead>
                    <TableRow>
                      <TableCell>{'Item'}</TableCell>
                      <TableCell>{'Line'}</TableCell>
                      <TableCell align="right">{'Amount'}</TableCell>
                    </TableRow>
                  </StaffTableHead>
                  <TableBody>
                    {filingLines.map((line) => (
                      <TableRow key={line.label}>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          {line.item}
                        </TableCell>
                        <TableCell>
                          <Stack
                            useFlexGap
                            direction="row"
                            spacing={1}
                            sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                          >
                            <Typography variant="body2">{line.label}</Typography>
                            {/*
                              PROVENANCE TRAVELS WITH THE FIGURE. Every other
                              line here is summed from platformRevenue; this
                              one was typed. Same column, same font, same
                              authority — so without the mark it is a figure
                              somebody will later defend as computed.
                            */}
                            {line.entered ? (
                              <Chip
                                size="small"
                                color="primary"
                                variant="outlined"
                                label="Entered, not computed"
                              />
                            ) : null}
                          </Stack>
                          <Typography variant="caption" color="text.secondary">
                            {line.note}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography
                            variant="h6"
                            sx={{ fontFamily: 'monospace' }}
                            color={
                              line.dollars === null
                                ? 'text.secondary'
                                : 'text.primary'
                            }
                          >
                            {payload
                              ? (line.dollars ?? 'not computed')
                              : loading
                                ? '…'
                                : '—'}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </ScrollTable>
              </Box>
              {payload && verdict.blocking ? (
                <Typography variant="body2" color="error" sx={{ mt: 2 }}>
                  {'These figures are incomplete — see the findings above. ' +
                    (filing.form === 'tx-webfile'
                      ? 'Do not type them into Webfile.'
                      : 'Do not file from them.')}
                </Typography>
              ) : null}
            </CardDisplay>

            {/*
              ITEM 3, which no query here can answer. Only where the form is
              known: `taxReturnBreakdownLines` deliberately omits taxable
              purchases for every other jurisdiction, because it is a Form
              01-114 line rather than a universal concept, and offering a box
              to fill a line that is not on the document would invent the form
              this report declines to guess at.
            */}
            {payload && filing.form === 'tx-webfile' ? (
              <StaffTaxablePurchasesCard
                period={payload.period ?? period}
                onSaved={() => setReloadToken((token) => token + 1)}
              />
            ) : null}

            <GridItems
              spacing={3}
              items={[
                {
                  size: { xs: 12, md: 6 },
                  children: (
                    <CardDisplay
                      header={'Refunds recorded in the period'}
                      help={docsHelp('salesTaxReturn', {
                        anchor: '#refunds',
                        excerpt:
                          'Refunds are stated, never netted out of the figures — a row carries only its latest refund stamp, so applying them is the preparer’s call.',
                      })}
                      contentGutterX
                      contentGutterY
                    >
                      <Stack spacing={1}>
                        <Typography variant="body2" color="text.secondary">
                          {'Stated, not netted. A row keeps only its latest ' +
                            'refund stamp, so two refunds in different ' +
                            'quarters cannot be split apart from the row — ' +
                            'applying these to the return is a judgment, ' +
                            'not a computation.'}
                        </Typography>
                        {[
                          {
                            label: 'Rows refunded',
                            value: String(refunds?.rowsRefundedInPeriod ?? 0),
                          },
                          {
                            label: 'Refunded gross',
                            value: `$${centsToDollars(
                              refunds?.refundedGrossCents,
                            )}`,
                          },
                          {
                            label: 'Estimated refunded tax',
                            value: `$${centsToDollars(
                              refunds?.estimatedRefundedTaxCents,
                            )}`,
                          },
                        ].map((entry) => (
                          <Stack
                            key={entry.label}
                            direction="row"
                            sx={{ justifyContent: 'space-between' }}
                          >
                            <Typography variant="body2">
                              {entry.label}
                            </Typography>
                            <Typography
                              variant="body2"
                              sx={{ fontFamily: 'monospace' }}
                            >
                              {payload ? entry.value : '—'}
                            </Typography>
                          </Stack>
                        ))}
                      </Stack>
                    </CardDisplay>
                  ),
                },
                {
                  size: { xs: 12, md: 6 },
                  children: (
                    <CardDisplay
                      header={'Period bounds'}
                      help={docsHelp('salesTaxReturn', {
                        anchor: '#period-bounds',
                      })}
                      contentGutterX
                      contentGutterY
                    >
                      <Stack spacing={1}>
                        <Typography variant="body2" color="text.secondary">
                          {'The exact window swept, echoed so a filed return ' +
                            'can be reproduced from the same bounds later.'}
                        </Typography>
                        {[
                          {
                            label: 'From (UTC)',
                            value: payload?.summary?.periodStart,
                          },
                          {
                            label: 'To (UTC, exclusive)',
                            value: payload?.summary?.periodEnd,
                          },
                          {
                            label: 'Invoices swept',
                            value:
                              payload &&
                              String(payload.summary?.transactionCount ?? 0),
                          },
                        ].map((entry) => (
                          <Stack
                            key={entry.label}
                            direction="row"
                            spacing={1}
                            sx={{ justifyContent: 'space-between' }}
                          >
                            <Typography variant="body2">
                              {entry.label}
                            </Typography>
                            <Typography
                              variant="caption"
                              sx={{ fontFamily: 'monospace' }}
                              color="text.secondary"
                            >
                              {entry.value ?? '—'}
                            </Typography>
                          </Stack>
                        ))}
                      </Stack>
                    </CardDisplay>
                  ),
                },
              ]}
            />

            {/*
              THE SALES THE OPERATOR FACILITATED FOR OTHERS (AGL-2163/3080).
              One card per source, each read and worded by the plugin that
              sold it and each with its own liability sentences — and NO grand
              total anywhere: adding them is the mistake the split exists to
              prevent. A source that could not be read gets a card saying so,
              beside the blocking finding above.
            */}
            {sources.map((section) => (
              <TaxReturnSourceCard
                key={`${section.pluginId}:${section.id}`}
                section={section}
              />
            ))}

            {/*
              THE LABEL WAS WRITING A CHEQUE THE SOURCE COULD NOT CASH
              (AGL-1956). This card reads `payload.summary`, which is
              `platformRevenue` — AGLYN'S OWN SaaS invoices. It nonetheless
              called itself "the early-warning list for economic nexus in
              another state", which is a question about FACILITATED sales and
              is answered by the by-state tables in the source cards above. A
              staff reader checking nexus would have read Aglyn's subscription
              revenue and believed it was merchant sales.

              Relabelled rather than resourced: the two collections describe two
              different taxpayers' money and must never be summed, so the fix is
              two adjacent honest tables, not one merged one.
            */}
            <CardDisplay
              header={'Aglyn’s own sales by jurisdiction'}
              help={docsHelp('salesTaxReturn', {
                anchor: '#aglyns-own-sales-by-jurisdiction',
                excerpt:
                  'Every buyer state for Aglyn’s OWN subscription and add-on revenue in the period. The configured jurisdiction is the return; the rest is the audit trail for why that revenue is not on it. NOT the nexus list — see “Facilitated sales by buyer state”.',
              })}
              contentGutterX
              contentGutterY
            >
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 1.5 }}
              >
                {'Aglyn’s own subscription and add-on revenue, by the ' +
                  `customer’s state. ${filingName} is the return; the other ` +
                  'rows are the record of why the rest of the period is not ' +
                  'on it. ' +
                  'For nexus from MERCHANTS’ sales, read “Facilitated sales ' +
                  'by buyer state” above — a different taxpayer’s money, and ' +
                  'never summed with this.'}
              </Typography>
              <ScrollTable size="small">
                <StaffTableHead>
                  <TableRow>
                    <TableCell>{'Jurisdiction'}</TableCell>
                    <TableCell align="right">{'Invoices'}</TableCell>
                    <TableCell align="right">{'Total sales'}</TableCell>
                    <TableCell align="right">{'Taxable sales'}</TableCell>
                    <TableCell align="right">{'Tax collected'}</TableCell>
                    {/*
                      WHAT WAS REMOVED (AGL-1582). Aglyn's own purchases are
                      not sales to a state, so they are out of every column to
                      the left — and a return that drops rows without saying
                      which cannot be checked by the person signing it. Stated
                      here so the two can be added back.
                    */}
                    <TableCell align="right">{'Excluded (internal)'}</TableCell>
                  </TableRow>
                </StaffTableHead>
                <TableBody>
                  {jurisdictions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <Typography variant="body2" color="text.secondary">
                          {payload
                            ? 'No invoices in this period.'
                            : loading
                              ? 'Loading…'
                              : '—'}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    jurisdictions.map((row) => (
                      <TableRow key={row.jurisdiction}>
                        <TableCell>
                          <Stack
                            direction="row"
                            spacing={1}
                            sx={{ alignItems: 'center' }}
                          >
                            <Typography
                              variant="body2"
                              sx={{
                                fontFamily: 'monospace',
                                fontWeight: row.isFilingJurisdiction ? 600 : 400,
                              }}
                            >
                              {row.jurisdiction}
                            </Typography>
                            {row.isFilingJurisdiction ? (
                              <Chip
                                size="small"
                                color="primary"
                                label="On the return"
                              />
                            ) : null}
                            {row.jurisdiction === 'unknown' ? (
                              <Chip
                                size="small"
                                color="warning"
                                label="No address"
                              />
                            ) : null}
                            {/*
                              A jurisdiction whose ONLY rows were Aglyn's own
                              purchases is in no filed figure at all. Without
                              this the period reads as having no invoices while
                              rows sit behind it, excluded.
                            */}
                            {row.internalOnly ? (
                              <Chip
                                size="small"
                                variant="outlined"
                                label="Nothing filed — all internal"
                              />
                            ) : null}
                          </Stack>
                          {/*
                            THE WORKING PAPERS (AGL-2329).

                            `taxabilityReason`, `taxRateId`, `percentage`,
                            `rateState` and `jurisdiction` are written on
                            every tax line — three of them annotated "for the
                            working papers" at the writer — and nothing read
                            any of them. A jurisdiction row that states a
                            total and cannot say WHY is the figure without
                            the paper behind it: $0 of tax reads identically
                            whether we are unregistered, the product is
                            exempt, or the rate is genuinely zero, and an
                            examiner asks which one first.

                            Rendered under the jurisdiction rather than in a
                            column of its own because there are several per
                            row and they belong to it, not beside it.
                          */}
                          {row.taxabilityReasons.length ? (
                            <Stack
                              useFlexGap
                              direction="row"
                              spacing={0.5}
                              sx={{ flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}
                            >
                              {row.taxabilityReasons.map((paper) => (
                                <Chip
                                  key={paper.key}
                                  size="small"
                                  variant="outlined"
                                  label={`${paper.label}: $${paper.taxCollectedDollars} on $${paper.taxableSalesDollars}`}
                                />
                              ))}
                            </Stack>
                          ) : null}
                          {row.rates.length ? (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ display: 'block', mt: 0.5 }}
                            >
                              {`Rates: ${row.rates
                                .map(
                                  (rate) =>
                                    `${rate.label} — $${rate.taxCollectedDollars}`,
                                )
                                .join(' · ')}`}
                            </Typography>
                          ) : null}
                        </TableCell>
                        <TableCell align="right">
                          {row.transactionCount}
                        </TableCell>
                        <TableCell
                          align="right"
                          sx={{ fontFamily: 'monospace' }}
                        >
                          {`$${row.totalSalesDollars}`}
                        </TableCell>
                        <TableCell
                          align="right"
                          sx={{ fontFamily: 'monospace' }}
                        >
                          {`$${row.taxableSalesDollars}`}
                        </TableCell>
                        <TableCell
                          align="right"
                          sx={{ fontFamily: 'monospace' }}
                        >
                          {`$${row.taxCollectedDollars}`}
                        </TableCell>
                        <TableCell
                          align="right"
                          sx={{ fontFamily: 'monospace' }}
                        >
                          {row.internalTransactionCount ? (
                            <Stack spacing={0.25}>
                              <Typography
                                variant="body2"
                                sx={{ fontFamily: 'monospace' }}
                                color="text.secondary"
                              >
                                {`$${row.internalTotalSalesDollars}`}
                              </Typography>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                {`${row.internalTransactionCount} ${
                                  row.internalTransactionCount === 1
                                    ? 'invoice'
                                    : 'invoices'
                                }, $${row.internalTaxCollectedDollars} tax`}
                              </Typography>
                            </Stack>
                          ) : (
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              sx={{ fontFamily: 'monospace' }}
                            >
                              {'—'}
                            </Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </ScrollTable>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mt: 1.5 }}
              >
                {'“Excluded (internal)” is Aglyn’s own purchases (AGL-1582) — ' +
                  'marked at checkout, kept out of every other column here and ' +
                  'out of the filing figures above, because a purchase the ' +
                  'platform made from itself is not a sale to a state. It is ' +
                  'stated rather than subtracted quietly so the figures can be ' +
                  'checked. The mark is written when the purchase is made and ' +
                  'cannot be added afterwards.'}
              </Typography>
            </CardDisplay>
          </Stack>
        </StaffOnly>
      </Container>
    </DashboardLayout>
  )
}
AdminTaxReturn.displayName = 'Page:AdminTaxReturn'

export default AdminTaxReturn
