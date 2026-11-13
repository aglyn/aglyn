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
import { doc } from 'firebase/firestore'
import { useCallback } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import {
  useFirestoreDoc,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import { pluginDocsHelp } from '@aglyn/aglyn'
import { writeSiteWideChange } from '@aglyn/tenant-feature-instance/hooks/helpers/site-wide-change'
import {
  heldSaveLabel,
  isSeedChecking,
  seedCheckingText,
  useHeldSave,
  useSeedEdits,
} from '@aglyn/tenant-feature-instance/hooks/use-seed-edits'

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
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const {
    data: store,
    status: storeStatus,
    /**
     * The settings doc this form is seeded from is unconfirmed by the server
     * (AGL-1358). `current` is `draft ?? {…store}` and the save writes all
     * six keys, so `merge: true` protects only the tax and shipping maps that
     * belong to other cards — never this card's own fields. Against a cached
     * read, changing the currency rewrites `guestCheckout`, and the two
     * template ids fall back to `|| null`, which is how a storefront's
     * product and collection URLs start returning 404.
     */
    fromCache: storeFromCache,
    listen: storeListen,
  } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId, 'settings', 'store'),
    [firestore, hostId],
  )
  const { data: host } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId),
    [firestore, hostId],
  )
  /*
   * What was typed, kept as EDITS over the stored settings (AGL-4047), so
   * the server's copy arriving after a keystroke replaces the cache's under
   * every field nobody touched. Save is held until it has (`checking`).
   */
  const form = useSeedEdits<StoreSettings>({
    pdpScreenId: store?.pdpScreenId ?? '',
    collectionScreenId: store?.collectionScreenId ?? '',
    currency: store?.currency ?? 'USD',
    guestCheckout: store?.guestCheckout !== false,
    termsUrl: store?.termsUrl ?? '',
    receiptFooter: store?.receiptFooter ?? '',
  })
  const current = form.values
  const update = (patch: Partial<StoreSettings>) => form.edit(patch)
  const checking = isSeedChecking({
    fromCache: storeFromCache,
    unreadable: storeStatus === 'error',
  })

  // Host screen directory: {screenId: path} (AGL-292 template pick).
  const screenEntries = Object.entries(
    (host?.screens ?? {}) as Record<string, string>,
  ).sort(([, a], [, b]) => String(a).localeCompare(String(b)))

  const handleSave = useCallback(async () => {
    /**
     * Refuse a save whose seed the server never confirmed (AGL-1358).
     *
     * There is no create path to exempt, and that is deliberate rather than
     * an oversight: unlike a new row at a fresh uid, this writes a FIXED
     * document path, so the all-defaults `current` produced when the cache
     * has never seen this doc is not the harmless blank a fresh uid would
     * be. It would put `USD`, guest checkout on and two null template ids
     * over whatever the server really holds.
     *
     * The guard WRAPS the write — an early return is a shape you can keep
     * while losing the protection.
     */
    const written = form.edits
    const verdict = await writeGuardedBySeed(
      {
        subject: 'store settings',
        unreadable: storeStatus === 'error',
        fromCache: storeFromCache,
        listen: storeListen,
      },
      async () => {
        // The product and collection templates, the currency and the
        // checkout rules render on the live store with no publish step, so
        // the save carries the site's cache drop with it.
        await writeSiteWideChange({
          firestore,
          user,
          hostId,
          write: (batch) =>
            batch.set(
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
            ),
        })
      },
    )
    // Before `settle`, so a refusal keeps every typed value on
    // screen. A save that silently does nothing sends the user back to
    // retype a form that will be refused again just as quietly.
    if (!verdict.ok) {
      return void enqueueSnackbar(verdict.message, {
        variant: 'warning',
        persist: false,
      })
    }
    form.settle(written)
    enqueueSnackbar('Store settings saved', {
      variant: 'success',
      persist: false,
    })
  }, [
    current,
    form,
    firestore,
    hostId,
    user,
    enqueueSnackbar,
    storeStatus,
    storeFromCache,
    storeListen,
  ])
  // A press while Save is held is kept, and saves once confirmed (AGL-4047).
  const held = useHeldSave(handleSave, {
    checking,
    subject: 'store settings',
    onRefused: (message) =>
      enqueueSnackbar(message, { variant: 'warning', persist: false }),
  })

  return (
    <CardDisplay
      header={'Store settings'}
      help={pluginDocsHelp('commerce', { anchor: '#store-settings' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1.5}>
        <TextField
          label="Product page template"
          value={current.pdpScreenId ?? ''}
          onChange={(event) => update({ pdpScreenId: event.target.value })}
          size="small"
          select
          helperText={
            'Page rendered at /products/{slug} — design it in the ' +
            'Besigner with the Product detail block and {{product.*}} tokens.'
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
            'Page rendered at /collections/{slug} — drop a Product grid ' +
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
          color="primary"
          size="small"
          disabled={!form.dirty || held.saving}
          onClick={held.press}
          sx={{ alignSelf: 'flex-start' }}
        >
          {heldSaveLabel(held, 'Save store settings')}
        </Button>
        {form.dirty && checking ? (
          <Typography variant="body2" color="text.secondary" role="status">
            {seedCheckingText('store settings')}
          </Typography>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
StoreSettingsCard.displayName = 'StoreSettingsCard'

export default StoreSettingsCard
