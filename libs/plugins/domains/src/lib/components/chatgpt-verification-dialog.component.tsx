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

import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { DOMAINS_API_ROUTES } from '../constants/bundle-common'
import {
  CHATGPT_CLAIM_RECORD_NAME,
  chatgptClaimRecord,
  chatgptClaimValue,
  chatgptClaimValueError,
} from '../model/chatgpt-verification'
import type { DnsRecordView } from '../model/dns-records'
import { useDomainsFetch } from './domains-api'

/*
 * VERIFY WITH CHATGPT, from a domain's DNS section. A business owner claims
 * their business in ChatGPT by proving they control its domain with one TXT
 * record. For a name whose DNS is kept here, they paste the value ChatGPT
 * shows and the record is added (or the old one replaced). For a name on
 * another provider's nameservers the dialog says which record to add there.
 */

export interface ChatgptVerificationDialogProps {
  open: boolean
  orgId: string
  domain: string
  /** Whether the name's DNS records are kept here. */
  ours: boolean
  /** The name's ChatGPT record, when it already has one. */
  existing: DnsRecordView | null
  onClose: () => void
  /** A record was written; the list behind the dialog is stale. */
  onSaved: () => void
}

export function ChatgptVerificationDialog(props: ChatgptVerificationDialogProps) {
  const { open, orgId, domain, ours, existing, onClose, onSaved } = props
  const request = useDomainsFetch()
  const [pasted, setPasted] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState(false)

  useEffect(() => {
    if (!open) return
    setPasted('')
    setFieldError(null)
    setError(null)
    setAdded(false)
  }, [open])

  const save = async () => {
    const value = chatgptClaimValue(pasted)
    if (!value) {
      setFieldError(chatgptClaimValueError(pasted))
      return
    }
    setBusy(true)
    setError(null)
    setFieldError(null)
    try {
      await request(DOMAINS_API_ROUTES.dns, {
        body: {
          orgId,
          domain,
          action: existing ? 'update' : 'create',
          ...(existing ? { recordId: existing.id } : {}),
          record: chatgptClaimRecord(value),
        },
      })
      setAdded(true)
      onSaved()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{'Verify with ChatGPT'}</DialogTitle>
      <DialogContent>
        {added ? (
          <Alert severity="success">
            {`The record is added to ${domain}. Go back to ChatGPT and choose Verify domain. If ChatGPT doesn’t see it yet, wait a few minutes and try again.`}
          </Alert>
        ) : (
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <Typography variant="body2">
              {`ChatGPT lists businesses and lets the owner claim theirs. To claim yours, show ChatGPT that you control ${domain}.`}
            </Typography>
            <Typography variant="body2" component="ol" sx={{ pl: 2.5, m: 0 }}>
              <li>{'In ChatGPT, open Business from the sidebar and find your business.'}</li>
              <li>{'When it asks how to verify your claim, choose Website domain.'}</li>
              <li>
                {ours
                  ? 'Copy the Value ChatGPT shows and paste it below.'
                  : 'Add the record ChatGPT shows where your DNS is kept, then choose Verify domain in ChatGPT.'}
              </li>
            </Typography>
            {ours ? (
              <>
                {existing ? (
                  <Alert severity="info">
                    {`${domain} already has a ChatGPT verification record. A new value replaces it.`}
                  </Alert>
                ) : null}
                <TextField
                  label="Value from ChatGPT"
                  value={pasted}
                  onChange={(event) => {
                    setPasted(event.target.value)
                    setFieldError(null)
                  }}
                  error={Boolean(fieldError)}
                  helperText={fieldError ?? `It starts with ${CHATGPT_CLAIM_RECORD_NAME}=`}
                  disabled={busy}
                  size="small"
                  multiline
                  autoFocus
                />
                {error ? <Alert severity="error">{error}</Alert> : null}
              </>
            ) : (
              <Alert severity="info">
                {`${domain} keeps its DNS with another provider, so the record is added there, not here. It is a TXT record named ${CHATGPT_CLAIM_RECORD_NAME}, with the value ChatGPT shows.`}
              </Alert>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {added || !ours ? (
          <Button onClick={onClose}>{'Done'}</Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>
              {'Cancel'}
            </Button>
            <Button variant="contained" onClick={() => void save()} disabled={busy}>
              {existing ? 'Replace record' : 'Add record'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}
