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

import * as Aglyn from '@aglyn/aglyn'
import * as CommerceModel from '../../model'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  collection,
  deleteDoc,
  doc,
  limit,
  query,
  setDoc,
} from 'firebase/firestore'
import { useCallback, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import {
  useFirestoreCollection,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import { EntitlementGatedCard } from './entitlement-gate.component'

export interface SuppliersCardProps {
  hostId: string
}

/**
 * Dropship suppliers (AGL-289): paid orders whose product points at a
 * supplier notify it by email and/or HMAC-signed webhook, and the
 * supplier posts tracking back through a token link — no Aglyn account
 * needed. Assign suppliers per product in the product editor.
 *
 * Gated on `dropshipRouting` since AGL-2080. `server/billing-webhook.ts:2474`
 * enforces it, so an unentitled org could create suppliers, assign them to
 * products, and watch every paid order silently fail to route — a supplier
 * that looks configured and never hears about an order.
 */
export function SuppliersCard(props: SuppliersCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const {
    data: supplierDocs,
    status: suppliersStatus,
    /**
     * The list this dialog is seeded from is unconfirmed by the server
     * (AGL-1358). Editing a supplier copies the whole stored row into
     * `draft` and writes all of it back, so a cached seed can restore a
     * ROTATED `webhookSecret` — the supplier keeps signing with a key we
     * meant to retire, and nothing anywhere reports it.
     */
    fromCache: suppliersFromCache,
  } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'suppliers'), limit(50)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const [draft, setDraft] = useState<
    (CommerceModel.HostSupplier & { id: string | null }) | null
  >(null)

  const handleSave = useCallback(async () => {
    if (!draft?.name.trim()) return
    const { id, ...data } = draft
    /**
     * Refuse an EDIT whose seed the server never confirmed (AGL-1358).
     *
     * This write has no options argument at all, so it is a full document
     * replace of a payload copied wholesale off the listener — `merge`
     * would not have helped anyway, since every field is present. The one
     * that matters is `webhookSecret`: rotate it somewhere else, come back
     * to a console still serving the old row out of `persistentLocalCache`,
     * rename the supplier, and the retired secret is stored again.
     *
     * Only the edit path is guarded. A NEW supplier is built from blanks at
     * a fresh uid and can overwrite nothing, so refusing it would be a false
     * positive on a path that is never unsafe — and this guard stands in
     * front of the ordinary save.
     *
     * The guard WRAPS the write: an early return is a shape you can keep
     * while losing the protection.
     */
    const verdict = await writeGuardedBySeed(
      {
        subject: 'supplier',
        unreadable: Boolean(id) && suppliersStatus === 'error',
        fromCache: Boolean(id) && suppliersFromCache,
      },
      async () => {
        await setDoc(
          doc(
            firestore,
            'hosts',
            hostId,
            'suppliers',
            id ?? Aglyn.createResourceUid(),
          ),
          {
            ...data,
            name: draft.name.trim().slice(0, 80),
          },
        )
      },
    )
    // A refusal keeps the dialog open with what was typed. A save that
    // silently does nothing sends the user back to retype a form that will
    // be refused again just as quietly.
    if (!verdict.ok) {
      return void enqueueSnackbar(verdict.message, {
        variant: 'warning',
        persist: false,
      })
    }
    setDraft(null)
    enqueueSnackbar('Supplier saved', { variant: 'success', persist: false })
  }, [
    draft,
    firestore,
    hostId,
    enqueueSnackbar,
    suppliersFromCache,
    suppliersStatus,
  ])

  const handleDelete = useCallback(
    (supplier: any) => async () => {
      const confirmed = await confirm({
        title: 'Remove this supplier?',
        description:
          `Products assigned to "${supplier.name}" stop routing; orders ` +
          'already sent are unaffected.',
        confirmationText: 'Remove',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      await deleteDoc(doc(firestore, 'hosts', hostId, 'suppliers', supplier.$id))
    },
    [confirm, firestore, hostId],
  )

  return (
    <EntitlementGatedCard
      hostId={hostId}
      feature="dropshipRouting"
      header={'Dropship suppliers'}
      upsell={
        'Dropship routing forwards each paid order to the right supplier ' +
        'by email or signed webhook, and takes tracking numbers back ' +
        'without the supplier needing an Aglyn account.'
      }
    >
    <CardDisplay header={'Dropship suppliers'} contentGutterX contentGutterY>
      <Stack spacing={1}>
        {(supplierDocs ?? []).length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'Route paid orders straight to a fulfillment partner: add a ' +
              'supplier, then assign it on products.'}
          </Typography>
        ) : (
          (supplierDocs ?? []).map((supplier: any) => (
            <Stack
              key={supplier.$id}
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center' }}
            >
              <Stack sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {supplier.name}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {[supplier.email, supplier.webhookUrl]
                    .filter(Boolean)
                    .join(' · ') || 'No delivery method set'}
                </Typography>
              </Stack>
              <Button
                size="small"
                onClick={() =>
                  setDraft({
                    id: supplier.$id,
                    name: supplier.name ?? '',
                    email: supplier.email ?? '',
                    webhookUrl: supplier.webhookUrl ?? '',
                    webhookSecret: supplier.webhookSecret ?? '',
                  })
                }
              >
                {'Edit'}
              </Button>
              <Button size="small" color="error" onClick={handleDelete(supplier)}>
                {'Remove'}
              </Button>
            </Stack>
          ))
        )}
        <Button
          size="small"
          sx={{ alignSelf: 'flex-start' }}
          onClick={() =>
            setDraft({ id: null, name: '', email: '', webhookUrl: '', webhookSecret: '' })
          }
        >
          {'Add supplier'}
        </Button>
      </Stack>
      <Dialog
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{draft?.id ? 'Edit supplier' : 'New supplier'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Name"
            value={draft?.name ?? ''}
            onChange={(event) =>
              setDraft((prev) =>
                prev ? { ...prev, name: event.target.value } : prev,
              )
            }
            size="small"
            autoFocus
            sx={{ mt: 1 }}
          />
          <TextField
            label="Notification email"
            value={draft?.email ?? ''}
            onChange={(event) =>
              setDraft((prev) =>
                prev ? { ...prev, email: event.target.value } : prev,
              )
            }
            size="small"
            helperText="Gets order details + a tracking link per sale"
          />
          <TextField
            label="Webhook URL"
            value={draft?.webhookUrl ?? ''}
            onChange={(event) =>
              setDraft((prev) =>
                prev ? { ...prev, webhookUrl: event.target.value } : prev,
              )
            }
            size="small"
            placeholder="https://…"
          />
          <TextField
            label="Webhook secret"
            value={draft?.webhookSecret ?? ''}
            onChange={(event) =>
              setDraft((prev) =>
                prev ? { ...prev, webhookSecret: event.target.value } : prev,
              )
            }
            size="small"
            helperText="Payloads carry an x-aglyn-signature HMAC header"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="primary"
            disabled={!draft?.name.trim()}
            onClick={handleSave}
          >
            {'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
    </EntitlementGatedCard>
  )
}
SuppliersCard.displayName = 'SuppliersCard'

export default SuppliersCard
