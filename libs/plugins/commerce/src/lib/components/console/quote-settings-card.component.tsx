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
import { pluginDocsHelp } from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useFirestore, useFirestoreDoc, writeGuardedBySeed } from '@aglyn/tenant-feature-instance'
import {
  Box,
  Button,
  Divider,
  FormControlLabel,
  FormHelperText,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { doc, setDoc } from 'firebase/firestore'
import { useCallback, useState } from 'react'

export interface QuoteSettingsCardProps {
  hostId: string
}

/** The card's settings as the form holds them. */
interface QuoteSettingsDraft {
  requireProofApproval: boolean
  requireProofSignIn: boolean
  /** As typed; blanks are dropped when saved. */
  approvalStatements: string[]
}

/**
 * The store's quote defaults, on `hosts/{hostId}/settings/store` under
 * `quotes`: whether a new quote starts out asking the customer to approve the
 * proof before they can pay (AGL-4093), whether it starts out asking a
 * customer with a site account to sign in to see the proof (AGL-4206), and
 * what every customer ticks before Approve works (AGL-4206). Each quote keeps
 * its own switches; the statements are the store's, read when the customer
 * opens the quote.
 */
export function QuoteSettingsCard(props: QuoteSettingsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const {
    data: store,
    status,
    // The switches are seeded from this document; a seed the server never
    // confirmed must not be written back over the saved settings (AGL-1358).
    fromCache,
    listen,
  } = useFirestoreDoc<any>(() => doc(firestore, 'hosts', hostId, 'settings', 'store'), [firestore, hostId])
  const saved: QuoteSettingsDraft = {
    requireProofApproval: CommerceModel.quoteRequiresProofApprovalByDefault(store?.quotes),
    requireProofSignIn: CommerceModel.quoteRequiresProofSignInByDefault(store?.quotes),
    approvalStatements: CommerceModel.quoteApprovalStatements(store?.quotes),
  }
  const [draft, setDraft] = useState<QuoteSettingsDraft | null>(null)
  const form = draft ?? saved
  const [busy, setBusy] = useState(false)
  const loading = status === 'loading'
  const edit = (patch: Partial<QuoteSettingsDraft>) => setDraft({ ...form, ...patch })
  const statements = form.approvalStatements
  const cleaned = CommerceModel.cleanQuoteApprovalStatements(statements)

  const save = useCallback(async () => {
    const current: CommerceModel.QuoteStoreSettings = {
      requireProofApproval: form.requireProofApproval,
      requireProofSignIn: form.requireProofSignIn,
      approvalStatements: CommerceModel.cleanQuoteApprovalStatements(form.approvalStatements),
    }
    setBusy(true)
    try {
      const verdict = await writeGuardedBySeed(
        { subject: 'quote settings', unreadable: status === 'error', fromCache, listen },
        async () => {
          await setDoc(doc(firestore, 'hosts', hostId, 'settings', 'store'), { quotes: current }, { merge: true })
        },
      )
      if (!verdict.ok) {
        return void enqueueSnackbar(verdict.message, { variant: 'warning', persist: false })
      }
      setDraft(null)
      enqueueSnackbar('Quote settings saved', { variant: 'success', persist: false })
    } finally {
      setBusy(false)
    }
  }, [form, firestore, hostId, status, fromCache, listen, enqueueSnackbar])

  return (
    <CardDisplay
      header={'Quotes'}
      help={pluginDocsHelp('quotes', {
        anchor: '#quote-defaults',
        title: 'Quotes',
        excerpt: 'What every new quote starts with, and what customers confirm before they approve a proof.',
      })}
      HeaderProps={{
        action: (
          <Button
            size="small"
            variant="contained"
            disabled={busy || draft === null || loading || cleaned.length === 0}
            onClick={() => void save()}
          >
            {'Save'}
          </Button>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Stack spacing={0.5}>
          <FormControlLabel
            control={
              <Switch
                checked={form.requireProofApproval}
                disabled={busy || loading}
                onChange={(event) => edit({ requireProofApproval: event.target.checked })}
              />
            }
            label="Customers approve the proof before they can pay"
          />
          <FormControlLabel
            control={
              <Switch
                checked={form.requireProofSignIn}
                disabled={busy || loading}
                onChange={(event) => edit({ requireProofSignIn: event.target.checked })}
              />
            }
            label="Customers sign in to see and approve proofs"
          />
          <FormHelperText>
            {'New quotes start with these settings, and you can change them on each quote. Signing in applies to a ' +
              'customer with an account on your site; a customer without one, like a phone or walk-in customer, keeps ' +
              'using the private link.'}
          </FormHelperText>
        </Stack>

        <Divider />

        <Stack spacing={1.5}>
          <Stack spacing={0.5}>
            <Typography variant="subtitle2">{'Before a customer approves a proof'}</Typography>
            <Typography variant="body2" color="text.secondary">
              {'They tick each of these, then type their name. The quote keeps what they confirmed, with their name and the time.'}
            </Typography>
          </Stack>
          {statements.map((statement, index) => (
            <Stack key={index} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
              <TextField
                fullWidth
                size="small"
                multiline
                label={`Statement ${index + 1}`}
                value={statement}
                disabled={busy || loading}
                onChange={(event) =>
                  edit({ approvalStatements: statements.map((entry, at) => (at === index ? event.target.value : entry)) })
                }
                slotProps={{ htmlInput: { maxLength: CommerceModel.QUOTE_MAX_APPROVAL_STATEMENT } }}
              />
              <Tooltip title={statements.length <= 1 ? 'Customers confirm at least one statement' : ''}>
                <span>
                  <Button
                    size="small"
                    aria-label={`Remove statement ${index + 1}`}
                    disabled={busy || loading || statements.length <= 1}
                    onClick={() => edit({ approvalStatements: statements.filter((_entry, at) => at !== index) })}
                    sx={{ mt: 0.5 }}
                  >
                    {'Remove'}
                  </Button>
                </span>
              </Tooltip>
            </Stack>
          ))}
          {cleaned.length === 0 ? (
            <FormHelperText error>{'Write at least one statement for customers to confirm.'}</FormHelperText>
          ) : null}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button
              size="small"
              variant="outlined"
              disabled={busy || loading || statements.length >= CommerceModel.QUOTE_MAX_APPROVAL_STATEMENTS}
              onClick={() => edit({ approvalStatements: [...statements, ''] })}
            >
              {'Add a statement'}
            </Button>
            <Button
              size="small"
              disabled={busy || loading}
              onClick={() => edit({ approvalStatements: [...CommerceModel.QUOTE_DEFAULT_APPROVAL_STATEMENTS] })}
            >
              {'Use the suggested statements'}
            </Button>
          </Box>
        </Stack>
      </Stack>
    </CardDisplay>
  )
}
QuoteSettingsCard.displayName = 'QuoteSettingsCard'

export default QuoteSettingsCard
