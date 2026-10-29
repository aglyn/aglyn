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

import * as CommerceModel from '../../model'
import { commerceSitePermissionRefusal } from '../../model/plugin-permissions'
import {
  checkVisitorUploadSelection,
  formatVisitorUploadBytes,
  visitorUploadIsInline,
  VISITOR_UPLOAD_ACCEPT,
  VISITOR_UPLOAD_MAX_BYTES,
} from '@aglyn/aglyn/app-utils/visitor-upload'
import { sendVisitorUpload } from '@aglyn/aglyn/app-utils/visitor-upload-client'
import { BlockedControl } from '@aglyn/shared-ui-jsx/components/blocked-control.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

const REFUSAL = commerceSitePermissionRefusal('commerce.quotes')

type User = Parameters<typeof authorizedFetch>[0]

/** A file the console lists: a proof, or one the customer sent. Never its storage path. */
interface ListedFile {
  id: string
  name: string
  contentType: string
  size: number
}

/** An earlier revision as the route lists it. */
type RevisionView = Omit<CommerceModel.QuoteRevisionSnapshot, 'proofs' | 'responses'> & {
  proofs: ListedFile[]
  responses: Array<Omit<CommerceModel.QuoteCustomerResponse, 'files'> & { files?: ListedFile[] }>
}

export interface QuoteProofsSectionProps {
  hostId: string
  quoteId: string
  quote: CommerceModel.HostOrder
  /** Holds "Create and edit quotes" (`commerce.quotes`). */
  canEdit: boolean
  /** A change here moved the quote's edit stamp; the editor saves against the new one. */
  onEdited: (updatedAtMs: number) => void
}

async function postQuote(user: User, body: Record<string, unknown>): Promise<{ ok: boolean; payload: Record<string, any> }> {
  const response = await authorizedFetch(user, '/api/commerce/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { ok: response.ok, payload: await response.json().catch(() => ({})) }
}

/** One of the quote's files as a blob, fetched with the member's token; null when refused. */
async function fetchQuoteFile(
  user: User,
  body: { hostId: string; quoteId: string; fileId: string; revision?: number },
): Promise<Blob | null> {
  try {
    const response = await authorizedFetch(user, '/api/commerce/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'file', ...body }),
    })
    return response.ok ? await response.blob() : null
  } catch {
    return null
  }
}

function dateTime(atMs: number | undefined): string {
  return atMs ? new Date(atMs).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''
}

/** A picture of an image proof, loaded with the member's token. */
function ProofThumbnail(props: { user: User; hostId: string; quoteId: string; file: ListedFile; revision?: number }) {
  const { user, hostId, quoteId, file, revision } = props
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    let url = ''
    void fetchQuoteFile(user, { hostId, quoteId, fileId: file.id, ...(revision ? { revision } : {}) }).then((blob) => {
      if (!live || !blob) return
      url = URL.createObjectURL(blob)
      setSrc(url)
    })
    return () => {
      live = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [user, hostId, quoteId, file.id, revision])
  return (
    <Box
      sx={(theme) => ({
        width: theme.spacing(16),
        height: theme.spacing(12),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'action.hover',
        borderRadius: 1,
        overflow: 'hidden',
      })}
    >
      {src ? (
        <Box component="img" src={src} alt={file.name} sx={{ maxWidth: 1, maxHeight: 1, objectFit: 'contain' }} />
      ) : (
        <CircularProgress size={20} aria-label={`Loading ${file.name}`} />
      )}
    </Box>
  )
}

/** A file: a picture for an image, a chip naming it for anything else; both download it. */
function QuoteFileTile(props: {
  user: User
  hostId: string
  quoteId: string
  file: ListedFile
  revision?: number
  onDownload: (file: ListedFile, revision?: number) => void
  onRemove?: () => void
  removeBlocked?: boolean
}) {
  const { file, revision, onDownload, onRemove, removeBlocked } = props
  const image = visitorUploadIsInline(file.contentType)
  return (
    <Paper variant="outlined" sx={{ p: 1 }}>
      <Stack spacing={1} sx={(theme) => ({ width: image ? theme.spacing(16) : 'auto', maxWidth: theme.spacing(32) })}>
        {image ? <ProofThumbnail {...props} /> : null}
        <Chip
          size="small"
          variant="outlined"
          label={`${file.name} · ${formatVisitorUploadBytes(file.size)}`}
          onClick={() => onDownload(file, revision)}
          title={`Download ${file.name}`}
        />
        {onRemove ? (
          <BlockedControl blocked={Boolean(removeBlocked)} reason={REFUSAL}>
            <Button size="small" color="inherit" onClick={onRemove} aria-label={`Remove ${file.name}`}>
              {'Remove'}
            </Button>
          </BlockedControl>
        ) : null}
      </Stack>
    </Paper>
  )
}

/** What the customer said, with any files they sent. */
function QuoteResponseNote(props: {
  response: Omit<CommerceModel.QuoteCustomerResponse, 'files'> & { files?: ListedFile[] }
  tile: (file: ListedFile) => ReactNode
}) {
  const { response, tile } = props
  if (response.action === 'approve') {
    return (
      <Alert severity="success">
        <Stack spacing={0.5}>
          <Typography variant="body2">{`Approved by ${response.name || 'the customer'} on ${dateTime(response.atMs)}.`}</Typography>
          <Typography variant="caption" color="text.secondary">
            {[response.ip ? `From ${response.ip}` : '', response.userAgent ?? ''].filter(Boolean).join(' · ')}
          </Typography>
        </Stack>
      </Alert>
    )
  }
  return (
    <Alert severity="warning">
      <Stack spacing={1}>
        <Typography variant="body2">{`Changes requested on ${dateTime(response.atMs)}:`}</Typography>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
          {response.comment}
        </Typography>
        {response.files?.length ? (
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            {response.files.map((file) => tile(file))}
          </Stack>
        ) : null}
      </Stack>
    </Alert>
  )
}

/**
 * A quote's proofs and revisions (AGL-4096), in its editor: the current
 * revision's proofs (a picture for an image, a chip for a PDF or a design
 * file), Add proof, what the customer last said with any files they sent,
 * "Start revision N+1", and every earlier revision as it was kept.
 */
export function QuoteProofsSection(props: QuoteProofsSectionProps) {
  const { hostId, quoteId, quote, canEdit, onEdited } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const section = quote.quote
  const revision = Math.max(1, Number(section?.revision ?? 1) || 1)
  const proofs = CommerceModel.currentQuoteProofs(section)
  const latest = CommerceModel.latestQuoteResponse(section)
  const unpaid = CommerceModel.isUnpaidQuote(quote)
  const addRefusal = CommerceModel.quoteProofChangeRefusal(quote, 'add')
  const removable = CommerceModel.quoteProofChangeRefusal(quote, 'remove') === null
  const [sending, setSending] = useState<{ done: number; total: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmingRevision, setConfirmingRevision] = useState(false)
  const [history, setHistory] = useState<RevisionView[] | null>(null)
  const [historyError, setHistoryError] = useState('')
  const picker = useRef<HTMLInputElement>(null)

  const loadHistory = useCallback(async () => {
    setHistoryError('')
    const answer = await postQuote(user, { action: 'revisions', hostId, quoteId }).catch(() => null)
    if (!answer?.ok) {
      setHistoryError(String(answer?.payload?.error ?? 'Earlier revisions could not be loaded.'))
      return
    }
    setHistory(Array.isArray(answer.payload['revisions']) ? (answer.payload['revisions'] as RevisionView[]) : [])
  }, [user, hostId, quoteId])

  // Earlier revisions are read when there are some, and again after one is added.
  useEffect(() => {
    if (revision > 1) void loadHistory()
  }, [revision, loadHistory])

  const download = useCallback(
    async (file: ListedFile, fromRevision?: number) => {
      const blob = await fetchQuoteFile(user, { hostId, quoteId, fileId: file.id, ...(fromRevision ? { revision: fromRevision } : {}) })
      if (!blob) return void enqueueSnackbar('The file could not be downloaded', { variant: 'error', allowDuplicate: true })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = file.name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    },
    [user, hostId, quoteId, enqueueSnackbar],
  )

  const addProofs = useCallback(
    async (files: File[]) => {
      const problem = checkVisitorUploadSelection(files, proofs.length, CommerceModel.QUOTE_MAX_PROOFS)
      if (problem) return void enqueueSnackbar(problem, { variant: 'error', allowDuplicate: true })
      setSending({ done: 0, total: files.length })
      try {
        for (const [index, file] of files.entries()) {
          let stamp = 0
          const sent = await sendVisitorUpload({
            file,
            requestTicket: async (request) => {
              const answer = await postQuote(user, { action: 'proof-ticket', hostId, quoteId, file: request })
              return answer.ok
                ? (answer.payload as { ticket: string; upload: { url: string; fields: Record<string, string> } })
                : { error: String(answer.payload['error'] ?? 'The proof could not be sent') }
            },
            finalize: async (ticket) => {
              const answer = await postQuote(user, { action: 'proof-finalize', hostId, quoteId, ticket })
              if (!answer.ok) return { error: String(answer.payload['error'] ?? 'The proof could not be kept') }
              stamp = Number(answer.payload['updatedAtMs']) || 0
              return { file: answer.payload['proof'] }
            },
          })
          if ('error' in sent) {
            enqueueSnackbar(sent.error, { variant: 'error', allowDuplicate: true })
            break
          }
          if (stamp) onEdited(stamp)
          setSending({ done: index + 1, total: files.length })
        }
      } finally {
        setSending(null)
      }
    },
    [user, hostId, quoteId, proofs.length, onEdited, enqueueSnackbar],
  )

  const removeProof = useCallback(
    async (proofId: string) => {
      setBusy(true)
      try {
        const answer = await postQuote(user, { action: 'proof-remove', hostId, quoteId, proofId })
        if (!answer.ok) {
          return void enqueueSnackbar(String(answer.payload['error'] ?? 'The proof could not be removed'), {
            variant: 'error',
            allowDuplicate: true,
          })
        }
        onEdited(Number(answer.payload['updatedAtMs']) || 0)
      } finally {
        setBusy(false)
      }
    },
    [user, hostId, quoteId, onEdited, enqueueSnackbar],
  )

  const startRevision = useCallback(async () => {
    setBusy(true)
    try {
      const answer = await postQuote(user, { action: 'start-revision', hostId, quoteId })
      if (!answer.ok) {
        return void enqueueSnackbar(String(answer.payload['error'] ?? 'The revision could not be started'), {
          variant: 'error',
          allowDuplicate: true,
        })
      }
      onEdited(Number(answer.payload['updatedAtMs']) || 0)
      enqueueSnackbar(`Revision ${Number(answer.payload['revision']) || revision + 1} started`, { variant: 'success', persist: false })
      setConfirmingRevision(false)
    } finally {
      setBusy(false)
    }
  }, [user, hostId, quoteId, revision, onEdited, enqueueSnackbar])

  const tile = (file: ListedFile, fromRevision?: number, onRemove?: () => void) => (
    <QuoteFileTile
      key={`${fromRevision ?? 'current'}-${file.id}`}
      user={user}
      hostId={hostId}
      quoteId={quoteId}
      file={file}
      revision={fromRevision}
      onDownload={(picked, at) => void download(picked, at)}
      onRemove={onRemove}
      removeBlocked={!canEdit}
    />
  )

  const earlier = (history ?? []).filter((entry) => Number(entry.revision) < revision).reverse()

  return (
    <Stack spacing={1.5}>
      <Stack spacing={0.5}>
        <Typography variant="subtitle2">{`Proofs · Revision ${revision}`}</Typography>
        <Typography variant="body2" color="text.secondary">
          {section?.requireProofApproval
            ? 'The customer sees these on the quote page and approves them before they can pay.'
            : 'The customer sees these on the quote page, and can approve them or ask for changes. Paying doesn’t wait on it.'}
        </Typography>
      </Stack>

      {latest ? <QuoteResponseNote response={latest} tile={(file) => tile(file)} /> : null}

      {proofs.length ? (
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          {proofs.map((proof) =>
            tile(proof, undefined, removable ? () => void removeProof(proof.id) : undefined),
          )}
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {'No proofs on this revision yet. Add an image, a PDF or a design file for the customer to approve.'}
        </Typography>
      )}

      {unpaid ? (
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            accept={VISITOR_UPLOAD_ACCEPT}
            data-testid="quote-proof-picker"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              event.target.value = ''
              if (files.length) void addProofs(files)
            }}
          />
          <BlockedControl
            blocked={!canEdit || Boolean(addRefusal)}
            reason={!canEdit ? REFUSAL : addRefusal ? CommerceModel.quoteProofRefusalMessage(addRefusal) : ''}
          >
            <Button variant="outlined" size="small" disabled={busy || Boolean(sending)} onClick={() => picker.current?.click()}>
              {sending ? `Sending ${sending.done + 1} of ${sending.total}…` : 'Add proof'}
            </Button>
          </BlockedControl>
          <BlockedControl blocked={!canEdit} reason={REFUSAL}>
            <Button size="small" disabled={busy || Boolean(sending)} onClick={() => setConfirmingRevision(true)}>
              {`Start revision ${revision + 1}`}
            </Button>
          </BlockedControl>
          <Typography variant="caption" color="text.secondary">
            {`Up to ${CommerceModel.QUOTE_MAX_PROOFS} files, ${formatVisitorUploadBytes(VISITOR_UPLOAD_MAX_BYTES)} each.`}
          </Typography>
        </Stack>
      ) : null}

      {revision > 1 ? (
        <Stack spacing={1.5}>
          <Divider />
          <Typography variant="subtitle2">{'Earlier revisions'}</Typography>
          {historyError ? <Alert severity="error">{historyError}</Alert> : null}
          {history === null && !historyError ? <CircularProgress size={20} aria-label="Loading earlier revisions" /> : null}
          {earlier.map((entry) => (
            <Paper key={entry.revision} variant="outlined" sx={{ p: 2 }}>
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
                  <Typography variant="body2" sx={{ fontWeight: 'fontWeightMedium' }}>{`Revision ${entry.revision}`}</Typography>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={CommerceModel.QUOTE_STAGE_LABELS[entry.stage] ?? entry.stage}
                    color={CommerceModel.QUOTE_STATUS_COLOR[entry.stage] ?? 'default'}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {`Replaced ${dateTime(entry.closedAtMs)}`}
                  </Typography>
                </Stack>
                {entry.proofs.length ? (
                  <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                    {entry.proofs.map((proof) => tile(proof, entry.revision))}
                  </Stack>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {'No proofs.'}
                  </Typography>
                )}
                {entry.responses.map((response, index) => (
                  <QuoteResponseNote key={index} response={response} tile={(file) => tile(file, entry.revision)} />
                ))}
              </Stack>
            </Paper>
          ))}
        </Stack>
      ) : null}

      <Dialog open={confirmingRevision} onClose={() => setConfirmingRevision(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{`Start revision ${revision + 1}?`}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {`Revision ${revision} is kept as it is now, with its proofs and the customer’s answers. ` +
              `Revision ${revision + 1} starts with no proofs, ready for new ones and any changes to the quote.`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmingRevision(false)} disabled={busy}>
            {'Cancel'}
          </Button>
          <Button variant="contained" disabled={busy} onClick={() => void startRevision()}>
            {`Start revision ${revision + 1}`}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
QuoteProofsSection.displayName = 'QuoteProofsSection'

export default QuoteProofsSection
