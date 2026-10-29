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
import { Button, FormControlLabel, FormHelperText, Stack, Switch } from '@mui/material'
import { doc, setDoc } from 'firebase/firestore'
import { useCallback, useState } from 'react'

export interface QuoteSettingsCardProps {
  hostId: string
}

/**
 * The store's quote defaults (AGL-4093), on `hosts/{hostId}/settings/store`
 * under `quotes`: whether a new quote starts out asking the customer to
 * approve the proof before they can pay. Each quote keeps its own setting.
 */
export function QuoteSettingsCard(props: QuoteSettingsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const {
    data: store,
    status,
    // The switch is seeded from this document; a seed the server never
    // confirmed must not be written back over the saved setting (AGL-1358).
    fromCache,
  } = useFirestoreDoc<any>(() => doc(firestore, 'hosts', hostId, 'settings', 'store'), [firestore, hostId])
  const saved = CommerceModel.quoteRequiresProofApprovalByDefault(store?.quotes)
  const [draft, setDraft] = useState<boolean | null>(null)
  const current = draft ?? saved
  const [busy, setBusy] = useState(false)

  const save = useCallback(async () => {
    setBusy(true)
    try {
      const verdict = await writeGuardedBySeed(
        { subject: 'quote settings', unreadable: status === 'error', fromCache },
        async () => {
          await setDoc(
            doc(firestore, 'hosts', hostId, 'settings', 'store'),
            { quotes: { requireProofApproval: current } },
            { merge: true },
          )
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
  }, [current, firestore, hostId, status, fromCache, enqueueSnackbar])

  return (
    <CardDisplay
      header={'Quotes'}
      help={pluginDocsHelp('quotes', {
        anchor: '#quote-defaults',
        title: 'Quotes',
        excerpt: 'What every new quote starts with. Each quote can change it.',
      })}
      HeaderProps={{
        action: (
          <Button size="small" variant="contained" disabled={busy || draft === null || status === 'loading'} onClick={() => void save()}>
            {'Save'}
          </Button>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={0.5}>
        <FormControlLabel
          control={
            <Switch
              checked={current}
              disabled={busy || status === 'loading'}
              onChange={(event) => setDraft(event.target.checked)}
            />
          }
          label="Customers approve the proof before they can pay"
        />
        <FormHelperText>{'New quotes start with this setting. You can change it on each quote.'}</FormHelperText>
      </Stack>
    </CardDisplay>
  )
}
QuoteSettingsCard.displayName = 'QuoteSettingsCard'

export default QuoteSettingsCard
