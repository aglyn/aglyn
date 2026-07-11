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
import useFirestoreCollection from '../../hooks/use-firestore-collection'

export interface SuppliersCardProps {
  hostId: string
}

/**
 * Dropship suppliers (AGL-289): paid orders whose product points at a
 * supplier notify it by email and/or HMAC-signed webhook, and the
 * supplier posts tracking back through a token link — no Aglyn account
 * needed. Assign suppliers per product in the product editor.
 */
export function SuppliersCard(props: SuppliersCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { data: supplierDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'suppliers'), limit(50)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const [draft, setDraft] = useState<
    (Aglyn.HostSupplier & { id: string | null }) | null
  >(null)

  const handleSave = useCallback(async () => {
    if (!draft?.name.trim()) return
    const { id, ...data } = draft
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
    setDraft(null)
    enqueueSnackbar('Supplier saved', { variant: 'success', persist: false })
  }, [draft, firestore, hostId, enqueueSnackbar])

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
            color="secondary"
            disabled={!draft?.name.trim()}
            onClick={handleSave}
          >
            {'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
SuppliersCard.displayName = 'SuppliersCard'

export default SuppliersCard
