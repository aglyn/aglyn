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

import {
  checkVisitorUploadSelection,
  describeVisitorUploadTypes,
  formatVisitorUploadBytes,
  VISITOR_UPLOAD_ACCEPT,
  VISITOR_UPLOAD_HONEYPOT_FIELD,
  VISITOR_UPLOAD_MAX_BYTES,
  VISITOR_UPLOAD_MAX_FILES,
  type VisitorUploadFileView,
} from '@aglyn/aglyn/app-utils/visitor-upload'
import { sendVisitorUpload } from '@aglyn/aglyn/app-utils/visitor-upload-client'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useCallback, useRef, useState, type ChangeEvent } from 'react'
import type { QuotePageView } from '../model'

/** The page's own fetch: the site's API, with the site's preview rules. */
type SiteFetch = (input: string, init?: RequestInit) => Promise<Response>

export interface QuoteProofPanelProps {
  view: QuotePageView
  hostId: string
  quoteId: string
  token: string
  siteFetch: SiteFetch
  /** The quote as the server answered after a response, or after it changed. */
  onView: (view: QuotePageView) => void
  /** Reload the quote: it changed since the page loaded. */
  onReload: () => void
  /** The link was replaced. */
  onReplaced: () => void
}

function dateLabel(atMs: number): string {
  return new Date(atMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const newKey = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`

/**
 * The quote's proofs on the customer's page (AGL-4096): each image shown,
 * every other file a download, and while the quote is open for an answer,
 * "Approve this proof" (under a typed name) and "Request changes" (a comment
 * and any artwork). The latest answer is the one that counts, so a customer
 * who asked for changes can still approve, and the panel says what they last
 * said. A paid quote shows its proofs and nothing to press.
 */
export function QuoteProofPanel(props: QuoteProofPanelProps) {
  const { view, hostId, quoteId, token, siteFetch, onView, onReload, onReplaced } = props
  const [mode, setMode] = useState<'idle' | 'approve' | 'changes'>('idle')
  const [name, setName] = useState('')
  const [comment, setComment] = useState('')
  const [files, setFiles] = useState<VisitorUploadFileView[]>([])
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  // Whatever a bot types into the hidden field, sent as typed.
  const [honeypot, setHoneypot] = useState('')
  const picker = useRef<HTMLInputElement>(null)
  const attempt = useRef('')

  const link = `hostId=${encodeURIComponent(hostId)}&q=${encodeURIComponent(quoteId)}&t=${encodeURIComponent(token)}`
  const proofHref = (id: string) => `/api/commerce/quote-proof?${link}&file=${encodeURIComponent(id)}`
  const business = view.storeName || 'the business'

  const post = useCallback(
    async (path: string, body: Record<string, unknown>, headers: Record<string, string> = {}) => {
      const response = await siteFetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ hostId, q: quoteId, t: token, ...body }),
      })
      return { response, payload: (await response.json().catch(() => ({}))) as Record<string, any> }
    },
    [siteFetch, hostId, quoteId, token],
  )

  const attach = useCallback(
    async (picked: File[]) => {
      setError('')
      const problem = checkVisitorUploadSelection(picked, files.length)
      if (problem) return void setError(problem)
      setUploading({ done: 0, total: picked.length })
      try {
        for (const [index, file] of picked.entries()) {
          const sent = await sendVisitorUpload({
            file,
            requestTicket: async (request) => {
              const { response, payload } = await post('/api/commerce/quote-upload', {
                action: 'ticket',
                file: request,
                [VISITOR_UPLOAD_HONEYPOT_FIELD]: honeypot,
              })
              return response.ok && payload['ticket']
                ? (payload as { ticket: string; upload: { url: string; fields: Record<string, string> } })
                : { error: String(payload['error'] ?? 'The file could not be sent. Try again.') }
            },
            finalize: async (ticket) => {
              const { response, payload } = await post('/api/commerce/quote-upload', { action: 'finalize', ticket })
              return response.ok && payload['file']
                ? { file: payload['file'] as VisitorUploadFileView }
                : { error: String(payload['error'] ?? 'The file could not be sent. Try again.') }
            },
          })
          if ('error' in sent) {
            setError(sent.error)
            break
          }
          setFiles((prev) => [...prev, sent.file])
          setUploading({ done: index + 1, total: picked.length })
        }
      } finally {
        setUploading(null)
      }
    },
    [files.length, post, honeypot],
  )

  const respond = useCallback(async () => {
    if (sending) return
    setError('')
    if (mode === 'approve' && name.trim().length < 2) return void setError('Type your name to approve the proof.')
    if (mode === 'changes' && !comment.trim()) return void setError('Tell us what to change.')
    setSending(true)
    // One key per answer: a retry of the same press is answered from the first.
    if (!attempt.current) attempt.current = newKey()
    try {
      const { response, payload } = await post(
        '/api/commerce/quote-respond',
        {
          v: view.version,
          action: mode === 'approve' ? 'approve' : 'changes',
          ...(mode === 'approve' ? { name: name.trim() } : { comment: comment.trim(), fileIds: files.map((file) => file.id) }),
          [VISITOR_UPLOAD_HONEYPOT_FIELD]: honeypot,
        },
        { 'Idempotency-Key': attempt.current },
      )
      attempt.current = ''
      if (response.ok && payload['view']) {
        setMode('idle')
        setName('')
        setComment('')
        setFiles([])
        onView(payload['view'] as QuotePageView)
        return
      }
      if (payload['replaced']) return onReplaced()
      if (payload['reason'] === 'updated' || payload['reason'] === 'paid') onReload()
      setError(String(payload['error'] ?? 'Your answer could not be sent. Try again.'))
    } catch {
      setError('Your answer could not be sent. Check your connection and try again.')
    } finally {
      setSending(false)
    }
  }, [sending, mode, name, comment, files, view.version, honeypot, post, onView, onReload, onReplaced])

  if (!view.proofs.length) return null
  const response = view.response

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Stack spacing={0.5}>
          <Typography variant="h6" component="h2">
            {view.proofs.length === 1 ? 'Your proof' : 'Your proofs'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {view.status === 'unpaid'
              ? `Revision ${view.revision}. Look it over, then approve it or tell ${business} what to change.`
              : `Revision ${view.revision}.`}
          </Typography>
        </Stack>

        <Stack spacing={1.5}>
          {view.proofs.map((proof) =>
            proof.inline ? (
              <Stack key={proof.id} spacing={0.5}>
                <Box
                  component="img"
                  src={proofHref(proof.id)}
                  alt={proof.name}
                  loading="lazy"
                  sx={{ display: 'block', maxWidth: 1, height: 'auto', borderRadius: 1, border: 1, borderColor: 'divider' }}
                />
                <Typography variant="caption" color="text.secondary">
                  {proof.name}
                </Typography>
              </Stack>
            ) : (
              <Box key={proof.id}>
                <Button variant="outlined" size="small" href={proofHref(proof.id)} download={proof.name}>
                  {`Download ${proof.name} (${formatVisitorUploadBytes(proof.size)})`}
                </Button>
              </Box>
            ),
          )}
        </Stack>

        {response ? (
          response.action === 'approve' ? (
            <Alert severity="success">
              {`You approved this proof on ${dateLabel(response.atMs)}${response.name ? ` as ${response.name}` : ''}.`}
            </Alert>
          ) : (
            <Alert severity="info">
              {`You asked for changes on ${dateLabel(response.atMs)}. ${business.charAt(0).toUpperCase()}${business.slice(1)} will send you a new proof.`}
            </Alert>
          )
        ) : null}

        {view.respondable ? (
          <Stack spacing={2}>
            {/* Honeypot: people never see or fill this. */}
            <Box
              component="input"
              type="text"
              name={VISITOR_UPLOAD_HONEYPOT_FIELD}
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              value={honeypot}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setHoneypot(event.target.value)}
              sx={{ position: 'absolute', left: '-100vw', width: 0, height: 0, opacity: 0 }}
            />
            {mode === 'idle' ? (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                {response?.action !== 'approve' ? (
                  <Button variant="contained" onClick={() => setMode('approve')}>
                    {'Approve this proof'}
                  </Button>
                ) : null}
                <Button variant={response?.action === 'approve' ? 'outlined' : 'text'} onClick={() => setMode('changes')}>
                  {'Request changes'}
                </Button>
              </Stack>
            ) : mode === 'approve' ? (
              <Stack spacing={1.5}>
                <Typography variant="body2">
                  {`Type your name to approve revision ${view.revision}. ${business.charAt(0).toUpperCase()}${business.slice(1)} keeps your name and the time as the record of your approval.`}
                </Typography>
                <TextField
                  label="Your name"
                  value={name}
                  autoComplete="name"
                  onChange={(event) => setName(event.target.value)}
                  slotProps={{ htmlInput: { maxLength: 120 } }}
                />
                <Stack direction="row" spacing={1}>
                  <Button variant="contained" disabled={sending} onClick={() => void respond()}>
                    {sending ? 'Approving…' : 'Approve'}
                  </Button>
                  <Button disabled={sending} onClick={() => setMode('idle')}>
                    {'Cancel'}
                  </Button>
                </Stack>
              </Stack>
            ) : (
              <Stack spacing={1.5}>
                <TextField
                  label="What should change?"
                  value={comment}
                  multiline
                  minRows={3}
                  required
                  onChange={(event) => setComment(event.target.value)}
                  slotProps={{ htmlInput: { maxLength: 5000 } }}
                />
                <input
                  ref={picker}
                  type="file"
                  multiple
                  hidden
                  accept={VISITOR_UPLOAD_ACCEPT}
                  data-testid="quote-artwork-picker"
                  onChange={(event) => {
                    const picked = Array.from(event.target.files ?? [])
                    event.target.value = ''
                    if (picked.length) void attach(picked)
                  }}
                />
                {files.length ? (
                  <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                    {files.map((file) => (
                      <Chip
                        key={file.id}
                        label={`${file.name} · ${formatVisitorUploadBytes(file.size)}`}
                        onDelete={sending ? undefined : () => setFiles((prev) => prev.filter((entry) => entry.id !== file.id))}
                      />
                    ))}
                  </Stack>
                ) : null}
                <Box>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={sending || Boolean(uploading) || files.length >= VISITOR_UPLOAD_MAX_FILES}
                    onClick={() => picker.current?.click()}
                  >
                    {uploading ? `Sending ${uploading.done + 1} of ${uploading.total}…` : 'Attach artwork'}
                  </Button>
                  <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
                    {`Optional. ${describeVisitorUploadTypes()}, up to ${VISITOR_UPLOAD_MAX_FILES} files of ${formatVisitorUploadBytes(VISITOR_UPLOAD_MAX_BYTES)} each.`}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1}>
                  <Button variant="contained" disabled={sending || Boolean(uploading)} onClick={() => void respond()}>
                    {sending ? 'Sending…' : 'Send changes'}
                  </Button>
                  <Button disabled={sending} onClick={() => setMode('idle')}>
                    {'Cancel'}
                  </Button>
                </Stack>
              </Stack>
            )}
            {error ? <Alert severity="error">{error}</Alert> : null}
          </Stack>
        ) : null}
      </Stack>
    </Paper>
  )
}

export default QuoteProofPanel
