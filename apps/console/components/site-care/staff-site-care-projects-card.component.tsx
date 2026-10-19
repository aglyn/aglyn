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

import {
  OWNER_APPROVAL_CHANNEL_LABELS,
  OWNER_APPROVAL_CHANNELS,
  type OwnerApprovalChannel,
} from '@aglyn/aglyn/app-utils/owner-approval-record'
import { formatSiteCareDate, formatSiteCareUsd } from '@aglyn/aglyn/app-utils/site-care'
import {
  readSiteCareProjectScope,
  SITE_CARE_PROJECT_FLOOR_USD,
  SITE_CARE_PROJECT_KIND_LABELS,
  SITE_CARE_PROJECT_KINDS,
  SITE_CARE_PROJECT_STATUS_LABELS,
  siteCareProjectAcceptanceIsCurrent,
  siteCareProjectInvoiceLine,
  siteCareProjectNextInvoice,
  siteCareProjectQuote,
  siteCareProjectQuoteIsEditable,
  siteCareProjectSplitSentence,
  type SiteCareProject,
  type SiteCareProjectInvoice,
  type SiteCareProjectKind,
} from '@aglyn/aglyn/app-utils/site-care-project'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Divider,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { QRCodeSVG } from 'qrcode.react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { docsHelp } from '../../constants/docs-links'
import { useSiteCareCall } from './site-care-api'
import SiteCareHistoryList, { type SiteCareHistoryEntry } from './site-care-history-list.component'

interface ProjectView {
  projectId: string
  project: SiteCareProject
  history: SiteCareHistoryEntry[]
}

interface ProjectsAnswer {
  projects: ProjectView[]
  canInvoice: boolean
}

type Post = (body: Record<string, unknown>, success: string) => Promise<boolean>

/** `YYYY-MM-DDTHH:mm` in the viewer's zone, for a datetime-local input. */
function localInputValue(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

const STATUS_COLORS: Record<string, 'default' | 'info' | 'success' | 'warning'> = {
  quoted: 'default',
  accepted: 'info',
  invoiced: 'warning',
  'deposit-paid': 'info',
  launched: 'warning',
  paid: 'success',
  refunded: 'default',
}

// ── The quote form ──────────────────────────────────────────────────────────

interface QuoteFields {
  title: string
  scope: string
  kind: SiteCareProjectKind
  estimatedHours: string
  priceUsd: string
}

const EMPTY_QUOTE: QuoteFields = { title: '', scope: '', kind: 'landingPage', estimatedHours: '', priceUsd: '' }

function fieldsOf(project: SiteCareProject): QuoteFields {
  return {
    title: project.title,
    scope: project.scope.join('\n'),
    kind: project.quote.kind,
    estimatedHours: String(project.quote.estimatedHours),
    priceUsd: project.quote.priceUsd > project.quote.computedUsd ? String(project.quote.priceUsd) : '',
  }
}

/**
 * Hours, a kind (which carries its published starting price) and an
 * optional higher price, with the quote worked out live and the owner's
 * view beside it. A price under the computed one is refused, never used.
 */
function QuoteForm({
  initial,
  busy,
  correcting,
  onSave,
  onCancel,
}: {
  initial: QuoteFields
  busy: boolean
  correcting: boolean
  onSave: (fields: QuoteFields, reason: string) => void
  onCancel: () => void
}) {
  const [fields, setFields] = useState<QuoteFields>(initial)
  const [reason, setReason] = useState('')
  const set = (key: keyof QuoteFields) => (event: { target: { value: string } }) =>
    setFields((state) => ({ ...state, [key]: event.target.value }))
  const computed = siteCareProjectQuote({ kind: fields.kind, estimatedHours: fields.estimatedHours })
  const quote = siteCareProjectQuote({
    kind: fields.kind,
    estimatedHours: fields.estimatedHours,
    priceUsd: fields.priceUsd,
  })
  const scope = readSiteCareProjectScope(fields.scope)
  const ready = quote.ok && scope.ok && fields.title.trim() && (!correcting || reason.trim())
  return (
    <Stack spacing={1.5}>
      <TextField label="Project" size="small" required value={fields.title} onChange={set('title')} />
      <TextField
        label="What the price covers, one deliverable per line"
        size="small"
        required
        multiline
        minRows={3}
        value={fields.scope}
        onChange={set('scope')}
      />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField select label="Kind" size="small" value={fields.kind} onChange={set('kind')} sx={{ minWidth: 240 }}>
          {SITE_CARE_PROJECT_KINDS.map((kind) => (
            <MenuItem key={kind} value={kind}>
              {SITE_CARE_PROJECT_FLOOR_USD[kind]
                ? `${SITE_CARE_PROJECT_KIND_LABELS[kind]} · from ${formatSiteCareUsd(SITE_CARE_PROJECT_FLOOR_USD[kind] * 100)}`
                : SITE_CARE_PROJECT_KIND_LABELS[kind]}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Estimated hours"
          type="number"
          size="small"
          required
          value={fields.estimatedHours}
          onChange={set('estimatedHours')}
          slotProps={{ htmlInput: { min: 0.25, step: 0.25 } }}
        />
        <TextField
          label="Price (round up only)"
          type="number"
          size="small"
          value={fields.priceUsd}
          onChange={set('priceUsd')}
          placeholder={computed.ok ? String(computed.quote.computedUsd) : ''}
          helperText={quote.ok === false && fields.estimatedHours ? quote.error : ' '}
          error={quote.ok === false && Boolean(fields.priceUsd)}
          slotProps={{ htmlInput: { min: computed.ok ? computed.quote.computedUsd : 1, step: 1 } }}
        />
      </Stack>
      {computed.ok ? (
        <Typography variant="body2" color="text.secondary">
          {`${computed.quote.billedHours} h × ${formatSiteCareUsd(computed.quote.rateUsd * 100)} = ${formatSiteCareUsd(
            computed.quote.billedHours * computed.quote.rateUsd * 100,
          )}${
            computed.quote.floorUsd
              ? `; the starting price is ${formatSiteCareUsd(computed.quote.floorUsd * 100)}`
              : ''
          }, so the quote is at least ${formatSiteCareUsd(computed.quote.computedUsd * 100)}.`}
        </Typography>
      ) : null}
      {quote.ok && scope.ok ? (
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Typography variant="overline" color="text.secondary">
            {'What the owner sees'}
          </Typography>
          <Typography variant="subtitle2">{fields.title.trim() || 'Project'}</Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {scope.scope.map((line) => (
              <Typography key={line} component="li" variant="body2">
                {line}
              </Typography>
            ))}
          </Box>
          <Typography variant="body2" sx={{ mt: 1 }}>
            {siteCareProjectSplitSentence(quote.quote)}
          </Typography>
        </Paper>
      ) : null}
      {correcting ? (
        <TextField label="Why the quote is changing" size="small" required value={reason} onChange={(e) => setReason(e.target.value)} />
      ) : null}
      <Stack direction="row" spacing={1}>
        <Button variant="contained" size="small" disabled={busy || !ready} onClick={() => onSave(fields, reason)}>
          {correcting ? 'Save the new quote' : 'Save quote'}
        </Button>
        <Button size="small" onClick={onCancel}>
          {'Cancel'}
        </Button>
      </Stack>
    </Stack>
  )
}

// ── One project ─────────────────────────────────────────────────────────────

function InvoiceRow({
  view,
  invoice,
  busy,
  post,
}: {
  view: ProjectView
  invoice: SiteCareProjectInvoice
  busy: boolean
  post: Post
}) {
  const [reverse, setReverse] = useState<'void' | 'credit' | 'refund' | null>(null)
  const [reason, setReason] = useState('')
  const [showQr, setShowQr] = useState(invoice.status === 'open')
  const base = { projectId: view.projectId, seq: invoice.seq }
  return (
    <Stack spacing={1} sx={{ pl: 1, borderLeft: 2, borderColor: 'divider' }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
        <Stack sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2">{siteCareProjectInvoiceLine(invoice)}</Typography>
          <Typography variant="caption" color="text.secondary">
            {[
              invoice.number ? `Invoice ${invoice.number}` : null,
              invoice.totalCents ? `${formatSiteCareUsd(invoice.totalCents)} with tax` : null,
              invoice.error,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Typography>
        </Stack>
        <Stack useFlexGap direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          {invoice.status === 'failed' || invoice.status === 'creating' ? (
            <Button size="small" variant="contained" disabled={busy} onClick={() => void post({ action: 'retryInvoice', ...base }, 'Invoice sent')}>
              {'Retry invoice'}
            </Button>
          ) : null}
          {invoice.status === 'open' && invoice.hostedInvoiceUrl ? (
            <>
              <Button size="small" onClick={() => setShowQr((value) => !value)}>
                {showQr ? 'Hide QR' : 'Show QR'}
              </Button>
              <Button size="small" component="a" href={invoice.hostedInvoiceUrl} target="_blank" rel="noopener noreferrer">
                {'Open pay page'}
              </Button>
              <Button size="small" disabled={busy} onClick={() => void post({ action: 'resendInvoice', ...base }, 'Pay link emailed again')}>
                {'Email the link again'}
              </Button>
              <Button size="small" color="warning" disabled={busy} onClick={() => setReverse('void')}>
                {'Void'}
              </Button>
              <Button size="small" color="warning" disabled={busy} onClick={() => setReverse('credit')}>
                {'Credit note'}
              </Button>
            </>
          ) : null}
          {invoice.status === 'paid' ? (
            <Button size="small" color="warning" disabled={busy} onClick={() => setReverse('refund')}>
              {'Refund'}
            </Button>
          ) : null}
        </Stack>
      </Stack>
      {showQr && invoice.status === 'open' && invoice.hostedInvoiceUrl ? (
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <Box sx={{ p: 1, bgcolor: 'common.white', borderRadius: 1, lineHeight: 0 }}>
            <QRCodeSVG value={invoice.hostedInvoiceUrl} size={160} level="M" marginSize={2} title="Invoice pay link QR code" role="img" />
          </Box>
          <Typography variant="body2" color="text.secondary">
            {'The owner scans this with their phone camera to pay now. The same link is in their email.'}
          </Typography>
        </Stack>
      ) : null}
      {reverse ? (
        <Stack spacing={1}>
          <Alert severity="warning">
            {reverse === 'void'
              ? 'Voiding cancels the invoice: the owner owes nothing on it. They are emailed.'
              : reverse === 'credit'
                ? 'A credit note clears what is owed on the invoice, with its tax. The owner is emailed.'
                : 'The refund returns the whole payment, with its tax, to the card it was paid with. The owner is emailed.'}
          </Alert>
          <TextField label="Why" size="small" required value={reason} onChange={(e) => setReason(e.target.value)} />
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="contained"
              color="warning"
              disabled={busy || !reason.trim()}
              onClick={async () => {
                const ok = await post(
                  { action: 'reverse', reversal: reverse, reason, ...base },
                  reverse === 'void' ? 'Invoice voided' : reverse === 'credit' ? 'Invoice credited' : 'Payment refunded',
                )
                if (ok) {
                  setReverse(null)
                  setReason('')
                }
              }}
            >
              {reverse === 'void' ? 'Void the invoice' : reverse === 'credit' ? 'Issue the credit note' : 'Refund the payment'}
            </Button>
            <Button size="small" onClick={() => setReverse(null)}>
              {'Cancel'}
            </Button>
          </Stack>
        </Stack>
      ) : null}
    </Stack>
  )
}

function AcceptanceForm({
  view,
  busy,
  post,
  onDone,
}: {
  view: ProjectView
  busy: boolean
  post: Post
  onDone: () => void
}) {
  const { project } = view
  const correcting = siteCareProjectAcceptanceIsCurrent(project)
  const [channel, setChannel] = useState<OwnerApprovalChannel>(project.acceptance?.channel ?? 'in-person')
  const [approvedAt, setApprovedAt] = useState(() =>
    localInputValue(correcting && project.acceptance ? project.acceptance.approvedAtMs : Date.now()),
  )
  const [note, setNote] = useState(correcting ? (project.acceptance?.note ?? '') : '')
  const [reason, setReason] = useState('')
  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        {`Record how and when the owner said yes to ${siteCareProjectSplitSentence(project.quote)} Saving it emails them a confirmation of the scope and price, which is the written record.`}
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField
          select
          label="How they said yes"
          size="small"
          value={channel}
          onChange={(event) => setChannel(event.target.value as OwnerApprovalChannel)}
          sx={{ minWidth: 180 }}
        >
          {OWNER_APPROVAL_CHANNELS.map((value) => (
            <MenuItem key={value} value={value}>
              {OWNER_APPROVAL_CHANNEL_LABELS[value]}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="When"
          type="datetime-local"
          size="small"
          value={approvedAt}
          onChange={(event) => setApprovedAt(event.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
      </Stack>
      <TextField label="What they said (optional)" size="small" value={note} onChange={(e) => setNote(e.target.value)} />
      {correcting ? (
        <TextField label="Why it is being corrected" size="small" required value={reason} onChange={(e) => setReason(e.target.value)} />
      ) : null}
      <Stack direction="row" spacing={1}>
        <Button
          variant="contained"
          size="small"
          disabled={busy || (correcting && !reason.trim())}
          onClick={async () => {
            const ok = await post(
              {
                action: 'accept',
                projectId: view.projectId,
                acceptance: { channel, approvedAtMs: new Date(approvedAt).getTime(), note, reason },
              },
              'Acceptance recorded; the owner has been emailed a confirmation',
            )
            if (ok) onDone()
          }}
        >
          {correcting ? 'Save correction and re-send' : 'Save the owner’s yes'}
        </Button>
        <Button size="small" onClick={onDone}>
          {'Cancel'}
        </Button>
      </Stack>
    </Stack>
  )
}

function ProjectRow({
  view,
  busy,
  canInvoice,
  post,
}: {
  view: ProjectView
  busy: boolean
  canInvoice: boolean
  post: Post
}) {
  const { project } = view
  const [form, setForm] = useState<'accept' | 'edit' | null>(null)
  const [history, setHistory] = useState(false)
  const next = siteCareProjectNextInvoice(project)
  const editable = siteCareProjectQuoteIsEditable(project)
  const current = siteCareProjectAcceptanceIsCurrent(project)
  const firstPaid = project.invoices.some(
    (row) => row.status === 'paid' && (row.kind === 'deposit' || row.kind === 'full'),
  )
  const canLaunch = !project.launchedAtMs && firstPaid
  const hasOpen = project.invoices.some((row) => row.status === 'open')
  return (
    <Stack spacing={1.25}>
      <Divider />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-start' } }}>
        <Stack sx={{ flex: 1, minWidth: 0 }} spacing={0.5}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="subtitle2">{project.title}</Typography>
            <Chip size="small" color={STATUS_COLORS[project.status] ?? 'default'} label={SITE_CARE_PROJECT_STATUS_LABELS[project.status]} />
          </Stack>
          <Typography variant="body2">{siteCareProjectSplitSentence(project.quote)}</Typography>
          <Typography variant="caption" color="text.secondary">
            {`${SITE_CARE_PROJECT_KIND_LABELS[project.quote.kind]} · estimated ${project.quote.estimatedHours} h, billed as ${project.quote.billedHours} h · quote version ${project.quoteVersion}`}
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {project.scope.map((line) => (
              <Typography key={line} component="li" variant="body2">
                {line}
              </Typography>
            ))}
          </Box>
          <Typography variant="caption" color={current ? 'text.secondary' : 'warning.main'}>
            {project.acceptance
              ? current
                ? `Owner said yes ${OWNER_APPROVAL_CHANNEL_LABELS[project.acceptance.channel].toLowerCase()} on ${formatSiteCareDate(project.acceptance.approvedAtMs)}`
                : 'The quote changed after the owner’s yes: record their yes to this quote.'
              : 'No yes recorded yet: nothing can be invoiced.'}
          </Typography>
        </Stack>
        <Stack useFlexGap direction="row" spacing={1} sx={{ flexWrap: 'wrap', justifyContent: { sm: 'flex-end' } }}>
          <Button size="small" variant={current ? 'text' : 'contained'} disabled={busy} onClick={() => setForm(form === 'accept' ? null : 'accept')}>
            {current ? 'Correct the yes' : 'Record the owner’s yes'}
          </Button>
          {editable ? (
            <Button size="small" disabled={busy} onClick={() => setForm(form === 'edit' ? null : 'edit')}>
              {'Edit quote'}
            </Button>
          ) : null}
          {next.ok && next.kind !== 'final' ? (
            <Button
              size="small"
              variant="contained"
              disabled={busy || !canInvoice}
              onClick={() =>
                void post(
                  { action: 'sendInvoice', projectId: view.projectId },
                  'Invoice sent; the owner has been emailed the pay link',
                )
              }
            >
              {next.kind === 'deposit' ? `Send deposit invoice (${formatSiteCareUsd(next.amountCents)})` : `Send invoice (${formatSiteCareUsd(next.amountCents)})`}
            </Button>
          ) : null}
          {canLaunch ? (
            <Button
              size="small"
              variant="contained"
              disabled={busy || !canInvoice}
              onClick={() =>
                void post(
                  { action: 'launch', projectId: view.projectId },
                  project.quote.split === 'half' ? 'Marked launched; the balance invoice is sent' : 'Marked launched',
                )
              }
            >
              {project.quote.split === 'half' ? 'Mark launched and invoice the balance' : 'Mark launched'}
            </Button>
          ) : null}
          {hasOpen ? (
            <Button size="small" disabled={busy} onClick={() => void post({ action: 'checkPayments', projectId: view.projectId }, 'Payments checked')}>
              {'Check payments'}
            </Button>
          ) : null}
          <Button size="small" onClick={() => setHistory((value) => !value)}>
            {history ? 'Hide history' : 'History'}
          </Button>
        </Stack>
      </Stack>
      {form === 'accept' ? <AcceptanceForm view={view} busy={busy} post={post} onDone={() => setForm(null)} /> : null}
      {form === 'edit' ? (
        <QuoteForm
          initial={fieldsOf(project)}
          busy={busy}
          correcting
          onCancel={() => setForm(null)}
          onSave={async (fields, reason) => {
            const ok = await post(
              { action: 'edit', projectId: view.projectId, ...fields, reason },
              'Quote changed; record the owner’s yes to the new quote',
            )
            if (ok) setForm(null)
          }}
        />
      ) : null}
      {project.invoices.length ? (
        <Stack spacing={1}>
          {[...project.invoices]
            .sort((a, b) => a.seq - b.seq)
            .map((invoice) => (
              <InvoiceRow key={invoice.seq} view={view} invoice={invoice} busy={busy} post={post} />
            ))}
        </Stack>
      ) : null}
      <Collapse in={history} unmountOnExit>
        <Box sx={{ pl: 2, pt: 1 }}>
          <SiteCareHistoryList rows={view.history} staff />
        </Box>
      </Collapse>
    </Stack>
  )
}

// ── The card ────────────────────────────────────────────────────────────────

export interface StaffSiteCareProjectsCardProps {
  orgId: string
}

/**
 * "Charge for work" on the staff organization page (AGL-3970): a flat
 * quote for a project — a landing page, a redesign, brand work — billed on
 * a one-off Stripe invoice the owner pays from their phone, with its pay
 * link emailed and shown here as a QR to pay on the spot. Nothing is
 * invoiced before the owner's yes is recorded; above the split line the
 * project is billed half now and half at launch, from the same record.
 * Every quote, yes, invoice, payment, email and correction is a row of the
 * project's append-only history.
 */
export function StaffSiteCareProjectsCard({ orgId }: StaffSiteCareProjectsCardProps) {
  const call = useSiteCareCall()
  const { enqueueSnackbar } = useSnackbar()
  const [data, setData] = useState<ProjectsAnswer | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const callRef = useRef(call)
  callRef.current = call
  const path = useMemo(() => `/api/admin/site-care/projects?orgId=${encodeURIComponent(orgId)}`, [orgId])

  const load = useCallback(async () => {
    const answer = await callRef.current<ProjectsAnswer>(path)
    if (answer.ok) {
      setData(answer.body)
      setFailed(null)
    } else if (answer.status) {
      setFailed(answer.body.error ?? 'Projects could not be read')
    }
  }, [path])

  useEffect(() => {
    void load()
  }, [load])

  const post = useCallback<Post>(
    async (body, success) => {
      setBusy(true)
      try {
        const answer = await callRef.current<{ sent?: boolean; reason?: string; invoice?: SiteCareProjectInvoice }>(
          '/api/admin/site-care/projects',
          { method: 'POST', body: { orgId, ...body } },
        )
        if (!answer.ok) {
          if (answer.status) enqueueSnackbar(answer.body.error ?? 'Request failed', { variant: 'warning', persist: false })
          await load()
          return false
        }
        if (answer.body.sent === false) {
          enqueueSnackbar(`Not sent: ${answer.body.reason ?? 'unknown'}`, { variant: 'warning', persist: false })
        } else if (answer.body.invoice?.status === 'failed') {
          enqueueSnackbar(`The invoice could not be made: ${answer.body.invoice.error ?? 'unknown'}`, {
            variant: 'warning',
            persist: false,
          })
        } else {
          enqueueSnackbar(success, { variant: 'success', persist: false })
        }
        await load()
        return true
      } finally {
        setBusy(false)
      }
    },
    [orgId, enqueueSnackbar, load],
  )

  return (
    <Box id="site-care-projects">
      <CardDisplay
        header="Charge for work"
        help={docsHelp('supportTriage', { anchor: '#site-care-projects' })}
        subheader="Flat-quoted projects: a new page, a redesign, brand work. Billed on a one-off invoice the owner pays from their phone."
        HeaderProps={{
          action: (
            <Button size="small" variant="contained" disabled={busy} onClick={() => setCreating((value) => !value)}>
              {'Charge for work'}
            </Button>
          ),
        }}
        contentGutterX
        contentGutterY
      >
        <Stack spacing={2}>
          {failed ? <Alert severity="warning">{failed}</Alert> : null}
          {data && !data.canInvoice ? (
            <Alert severity="info">
              {'This workspace has no Stripe customer yet, so nothing can be invoiced. A quote can still be made and accepted.'}
            </Alert>
          ) : null}
          {creating ? (
            <QuoteForm
              initial={EMPTY_QUOTE}
              busy={busy}
              correcting={false}
              onCancel={() => setCreating(false)}
              onSave={async (fields) => {
                const ok = await post({ action: 'create', ...fields }, 'Quote saved; record the owner’s yes to invoice it')
                if (ok) setCreating(false)
              }}
            />
          ) : null}
          {data && data.projects.length === 0 && !creating ? (
            <Typography variant="body2" color="text.secondary">
              {'No projects yet.'}
            </Typography>
          ) : null}
          {(data?.projects ?? []).map((view) => (
            <ProjectRow key={view.projectId} view={view} busy={busy} canInvoice={data?.canInvoice ?? false} post={post} />
          ))}
        </Stack>
      </CardDisplay>
    </Box>
  )
}

StaffSiteCareProjectsCard.displayName = 'StaffSiteCareProjectsCard'

export default StaffSiteCareProjectsCard
