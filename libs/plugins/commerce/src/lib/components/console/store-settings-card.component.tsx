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
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { doc, setDoc } from 'firebase/firestore'
import { useCallback, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { useFirestoreDoc } from '@aglyn/tenant-feature-instance'

export interface StoreSettingsCardProps {
  hostId: string
}

interface StoreSettings {
  /** Screen rendered for /products/{slug} with product tokens (AGL-292). */
  pdpScreenId?: string
  /** Screen rendered for /collections/{slug} (AGL-298). */
  collectionScreenId?: string
  currency?: string
  guestCheckout?: boolean
  termsUrl?: string
  receiptFooter?: string
}

/**
 * Store settings (AGL-295) on `hosts/{hostId}/settings/store`: the PDP
 * template screen (drives /products/{slug}), currency display, checkout
 * preferences, and receipt branding. Tax and shipping have their own
 * cards; store password/maintenance live in Site Protection.
 */
export function StoreSettingsCard(props: StoreSettingsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { data: store } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId, 'settings', 'store'),
    [firestore, hostId],
  )
  const { data: host } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId),
    [firestore, hostId],
  )
  const [draft, setDraft] = useState<StoreSettings | null>(null)
  const current: StoreSettings = draft ?? {
    pdpScreenId: store?.pdpScreenId ?? '',
    collectionScreenId: store?.collectionScreenId ?? '',
    currency: store?.currency ?? 'USD',
    guestCheckout: store?.guestCheckout !== false,
    termsUrl: store?.termsUrl ?? '',
    receiptFooter: store?.receiptFooter ?? '',
  }
  const update = (patch: Partial<StoreSettings>) =>
    setDraft({ ...current, ...patch })

  // Host screen directory: {screenId: path} (AGL-292 template pick).
  const screenEntries = Object.entries(
    (host?.screens ?? {}) as Record<string, string>,
  ).sort(([, a], [, b]) => String(a).localeCompare(String(b)))

  const handleSave = useCallback(async () => {
    await setDoc(
      doc(firestore, 'hosts', hostId, 'settings', 'store'),
      {
        pdpScreenId: current.pdpScreenId || null,
        collectionScreenId: current.collectionScreenId || null,
        currency: current.currency ?? 'USD',
        guestCheckout: current.guestCheckout !== false,
        termsUrl: current.termsUrl || null,
        receiptFooter: current.receiptFooter || null,
      },
      { merge: true },
    )
    setDraft(null)
    enqueueSnackbar('Store settings saved', {
      variant: 'success',
      persist: false,
    })
  }, [current, firestore, hostId, enqueueSnackbar])

  return (
    <CardDisplay header={'Store settings'} contentGutterX contentGutterY>
      <Stack spacing={1.5}>
        <TextField
          label="Product page template"
          value={current.pdpScreenId ?? ''}
          onChange={(event) => update({ pdpScreenId: event.target.value })}
          size="small"
          select
          helperText={
            'Screen rendered at /products/{slug} — design it in the ' +
            'besigner with the Product detail block and {{product.*}} tokens.'
          }
        >
          <MenuItem value="">{'None (product URLs 404)'}</MenuItem>
          {screenEntries.map(([screenId, path]) => (
            <MenuItem key={screenId} value={screenId}>
              {`/${path === '/' ? '' : path}`}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Collection page template"
          value={current.collectionScreenId ?? ''}
          onChange={(event) =>
            update({ collectionScreenId: event.target.value })
          }
          size="small"
          select
          helperText={
            'Screen rendered at /collections/{slug} — drop a Product grid ' +
            'with source "A collection" and {{collection.*}} tokens.'
          }
        >
          <MenuItem value="">{'None (collection URLs 404)'}</MenuItem>
          {screenEntries.map(([screenId, path]) => (
            <MenuItem key={screenId} value={screenId}>
              {`/${path === '/' ? '' : path}`}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Currency"
          value={current.currency ?? 'USD'}
          onChange={(event) => update({ currency: event.target.value })}
          size="small"
          select
          sx={{ maxWidth: 200 }}
          helperText="Charges settle in USD; more currencies are coming"
        >
          <MenuItem value="USD">{'USD ($)'}</MenuItem>
        </TextField>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={current.guestCheckout !== false}
              onChange={(event) =>
                update({ guestCheckout: event.target.checked })
              }
            />
          }
          label="Allow guest checkout (no account required)"
        />
        <TextField
          label="Terms URL"
          value={current.termsUrl ?? ''}
          onChange={(event) => update({ termsUrl: event.target.value })}
          size="small"
          placeholder="/terms"
          helperText="Linked from checkout when set"
        />
        <TextField
          label="Receipt footer"
          value={current.receiptFooter ?? ''}
          onChange={(event) => update({ receiptFooter: event.target.value })}
          size="small"
          multiline
          minRows={2}
          placeholder="Thanks for supporting our shop!"
        />
        <Typography variant="caption" color="text.secondary">
          {'Password protection and maintenance mode live under Site ' +
            'Protection.'}
        </Typography>
        <Button
          variant="contained"
          color="secondary"
          size="small"
          disabled={!draft}
          onClick={handleSave}
          sx={{ alignSelf: 'flex-start' }}
        >
          {'Save store settings'}
        </Button>
      </Stack>
    </CardDisplay>
  )
}
StoreSettingsCard.displayName = 'StoreSettingsCard'

export default StoreSettingsCard
