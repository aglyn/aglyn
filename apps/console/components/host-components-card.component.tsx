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

import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
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
import { collection, doc, limit, query, updateDoc } from 'firebase/firestore'
import { useCallback, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../constants/docs-links'
import useFirestoreCollection from '../hooks/use-firestore-collection'

export interface HostComponentsCardProps {
  hostId: string
}

/**
 * Reusable-component management (user request 2026-07-07): rename/describe
 * and delete host component definitions. Deletion is a soft delete
 * (`deletedAt`), so already-published tenant pages keep grafting until
 * their next revalidate and nothing hard-breaks; the element drawer and
 * tenant compose both filter deleted definitions. Content editing lands
 * with the marketplace component editor.
 */
export function HostComponentsCard(props: HostComponentsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { data: componentDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'components'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const components = [...(componentDocs ?? [])]
    .filter((definition: any) => !definition.deletedAt)
    .sort((a: any, b: any) =>
      String(a.displayName ?? '').localeCompare(String(b.displayName ?? '')),
    )

  const [editor, setEditor] = useState<{
    id: string
    name: string
    description: string
  } | null>(null)

  // Community publish (AGL-44): posts to the server-side publish API —
  // sanitization/allowlisting happen there; clients cannot create listings.
  const { data: user } = useUser()
  const [publisher, setPublisher] = useState<{
    id: string
    name: string
    description: string
    category: string
    price: string
    busy?: boolean
  } | null>(null)

  const handlePublishConfirm = useCallback(async () => {
    if (!publisher || !publisher.name.trim() || publisher.busy) return
    setPublisher((prev) => (prev ? { ...prev, busy: true } : prev))
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/community/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          hostId,
          componentId: publisher.id,
          displayName: publisher.name.trim(),
          description: publisher.description.trim(),
          category: publisher.category.trim(),
          priceUsd: Number(publisher.price) || 0,
        }),
      })
      const payload = await response.json()
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'Publish failed', {
          variant: response.status === 412 ? 'warning' : 'error',
          allowDuplicate: true,
        })
      }
      setPublisher(null)
      enqueueSnackbar(`Published v${payload.version} to the community`, {
        variant: 'success',
        persist: false,
      })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setPublisher((prev) => (prev ? { ...prev, busy: false } : prev))
    }
  }, [publisher, user, hostId, enqueueSnackbar])

  const handleSave = useCallback(async () => {
    if (!editor || !editor.name.trim()) return
    await updateDoc(
      doc(firestore, 'hosts', hostId, 'components', editor.id),
      {
        displayName: editor.name.trim(),
        description: editor.description.trim(),
        updatedAt: Timestamp.now(),
      },
    )
    setEditor(null)
    enqueueSnackbar('Component updated', { variant: 'success', persist: false })
  }, [editor, firestore, hostId, enqueueSnackbar])

  const handleDelete = useCallback(
    (definition: any) => async () => {
      const confirmed = await confirm({
        title: 'Delete this component?',
        description:
          `"${definition.displayName ?? definition.$id}" disappears from ` +
          'Your components; existing instances on screens render as empty ' +
          'placeholders after the next publish.',
        confirmationText: 'Delete',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      await updateDoc(
        doc(firestore, 'hosts', hostId, 'components', definition.$id),
        { deletedAt: Timestamp.now() },
      )
      enqueueSnackbar('Component deleted', {
        variant: 'success',
        persist: false,
      })
    },
    [confirm, firestore, hostId, enqueueSnackbar],
  )

  return (
    <CardDisplay
      header={'Reusable components'}
      help={docsHelp('components', { anchor: '#manage' })}
      contentGutterX
      contentGutterY
    >
      {components.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {'Select an element in the besigner and choose "Save as reusable ' +
            'component" — definitions appear here and in the element drawer.'}
        </Typography>
      ) : (
        <Stack spacing={1}>
          {components.map((definition: any) => (
            <Stack
              key={definition.$id}
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center' }}
            >
              <Stack sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {definition.displayName ?? definition.$id}
                </Typography>
                {definition.description ? (
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {definition.description}
                  </Typography>
                ) : null}
              </Stack>
              <Button
                size="small"
                onClick={() =>
                  setEditor({
                    id: definition.$id,
                    name: definition.displayName ?? '',
                    description: definition.description ?? '',
                  })
                }
              >
                {'Edit'}
              </Button>
              <Button
                size="small"
                onClick={() =>
                  setPublisher({
                    id: definition.$id,
                    name: definition.displayName ?? '',
                    description: definition.description ?? '',
                    category: '',
                    price: '',
                  })
                }
              >
                {'Publish'}
              </Button>
              <Button
                size="small"
                color="error"
                onClick={handleDelete(definition)}
              >
                {'Delete'}
              </Button>
            </Stack>
          ))}
        </Stack>
      )}
      <Dialog
        open={Boolean(editor)}
        onClose={() => setEditor(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'Edit component'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
        >
          <TextField
            label="Name"
            value={editor?.name ?? ''}
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, name: event.target.value } : prev,
              )
            }
            size="small"
            autoFocus
            sx={{ mt: 1 }}
          />
          <TextField
            label="Description"
            value={editor?.description ?? ''}
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, description: event.target.value } : prev,
              )
            }
            size="small"
            multiline
            minRows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditor(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={!editor?.name.trim()}
            onClick={handleSave}
          >
            {'Save'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(publisher)}
        onClose={() => (publisher?.busy ? null : setPublisher(null))}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'Publish to community'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
        >
          <Typography variant="body2" color="text.secondary">
            {'Publishes a snapshot as a public listing under your ' +
              'community profile. Re-publishing releases a new version; ' +
              'sites that installed it choose when to update.'}
          </Typography>
          <TextField
            label="Listing name"
            value={publisher?.name ?? ''}
            onChange={(event) =>
              setPublisher((prev) =>
                prev ? { ...prev, name: event.target.value } : prev,
              )
            }
            size="small"
            autoFocus
          />
          <TextField
            label="Description"
            value={publisher?.description ?? ''}
            onChange={(event) =>
              setPublisher((prev) =>
                prev ? { ...prev, description: event.target.value } : prev,
              )
            }
            size="small"
            multiline
            minRows={2}
          />
          <TextField
            label="Category"
            placeholder="e.g. Hero, Footer, Pricing"
            value={publisher?.category ?? ''}
            onChange={(event) =>
              setPublisher((prev) =>
                prev ? { ...prev, category: event.target.value } : prev,
              )
            }
            size="small"
          />
          <TextField
            label="Price (USD)"
            placeholder="0 = free"
            helperText="Paid listings need payouts set up on your community profile"
            value={publisher?.price ?? ''}
            onChange={(event) =>
              setPublisher((prev) =>
                prev
                  ? {
                      ...prev,
                      price: event.target.value.replace(/[^0-9]/g, ''),
                    }
                  : prev,
              )
            }
            size="small"
          />
        </DialogContent>
        <DialogActions>
          <Button
            disabled={publisher?.busy}
            onClick={() => setPublisher(null)}
          >
            {'Cancel'}
          </Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={!publisher?.name.trim() || publisher?.busy}
            onClick={handlePublishConfirm}
          >
            {publisher?.busy ? 'Publishing…' : 'Publish'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
HostComponentsCard.displayName = 'HostComponentsCard'

export default HostComponentsCard
