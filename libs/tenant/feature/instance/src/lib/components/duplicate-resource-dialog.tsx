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

import {
  DUPLICABLE_RESOURCE_NOUNS,
  DUPLICATE_COPIES,
  DUPLICATE_NAME_MAX,
  duplicateDisplayName,
  isDuplicableHostResourceKind,
  type DuplicableResourceKind,
} from '@aglyn/aglyn/app-utils/duplicate-resource'
import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import {
  useDuplicateResourceApi,
  type DuplicatedHostResource,
} from '../hooks/use-duplicate-resource-api'

/** The menu-item label every row menu and More menu uses for the action. */
export const DUPLICATE_MENU_LABEL = 'Duplicate…'

export interface DuplicateResourceDialogProps {
  open: boolean
  kind: DuplicableResourceKind
  sourceName: string
  busy?: boolean
  error?: string | null
  onClose: () => void
  onConfirm: (name: string) => void
}

/**
 * The one field a copy asks for — its name, default filled — above the
 * list of what the copy carries (AGL-2936). The list is the catalog's
 * sentence for the kind, so a person is not surprised by what came along
 * and what did not: a screen copy is a draft with no address, a workflow
 * copy is disarmed, a form copy keeps no submissions.
 */
export function DuplicateResourceDialog(props: DuplicateResourceDialogProps) {
  const { open, kind, sourceName, busy, error, onClose, onConfirm } = props
  const noun = DUPLICABLE_RESOURCE_NOUNS[kind]
  const [name, setName] = useState('')
  // Refilled on every open: the default is the SOURCE's name, and the
  // source changes between opens.
  useEffect(() => {
    if (open) setName(duplicateDisplayName(sourceName))
  }, [open, sourceName])
  const trimmed = name.trim()
  const handleSubmit = useCallback(
    (event: FormEvent) => {
      event.preventDefault()
      if (!trimmed || busy) return
      onConfirm(trimmed)
    },
    [trimmed, busy, onConfirm],
  )
  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      fullWidth
      maxWidth="xs"
      slotProps={{ paper: { component: 'form', onSubmit: handleSubmit } as never }}
    >
      <DialogTitle>{`Duplicate ${noun}`}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <TextField
          autoFocus
          fullWidth
          label="Name"
          margin="dense"
          value={name}
          onChange={(event) => setName(event.target.value)}
          slotProps={{ htmlInput: { maxLength: DUPLICATE_NAME_MAX } }}
          helperText={`A name another ${noun} already has gets a number.`}
          disabled={busy}
        />
        <div>
          <Typography variant="subtitle2">{'What the copy carries'}</Typography>
          <List dense disablePadding>
            {DUPLICATE_COPIES[kind].map((line) => (
              <ListItem key={line} disableGutters>
                <ListItemText primary={line} />
              </ListItem>
            ))}
          </List>
        </div>
        {error ? <Alert severity="error">{error}</Alert> : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {'Cancel'}
        </Button>
        <Button type="submit" variant="contained" disabled={!trimmed || busy}>
          {busy ? 'Duplicating…' : 'Duplicate'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
DuplicateResourceDialog.displayName = 'DuplicateResourceDialog'

export interface DuplicateResourceSource {
  id: string
  name: string
}

/** What a plugin's own door is asked, when the kind is not the core's. */
export interface DuplicateResourceAttempt {
  kind: DuplicableResourceKind
  sourceId: string
  name: string
  attemptKey: string
}

export interface UseDuplicateResourceOptions {
  hostId: string
  /**
   * The door for a kind the core module does not copy — a campaign, a CRM
   * email template — reached through the owning plugin's API. Absent, the
   * resources door is asked, which copies the host kinds only.
   */
  perform?: (attempt: DuplicateResourceAttempt) => Promise<DuplicatedHostResource>
  /** Called once the copy exists — the surface refreshes, navigates, or says so. */
  onDuplicated?: (
    kind: DuplicableResourceKind,
    copy: DuplicatedHostResource,
    source: DuplicateResourceSource,
  ) => void
}

export interface DuplicateResourceFlow {
  /** Opens the dialog for one source. */
  request: (kind: DuplicableResourceKind, source: DuplicateResourceSource) => void
  /** The dialog, mounted once by the surface. */
  dialog: ReactNode
}

/**
 * The whole flow a surface needs (AGL-2936): a menu item calls `request`,
 * the dialog collects the name, the door is asked, and `onDuplicated` hears
 * the result. One attempt key is minted per open, so pressing Duplicate
 * twice — or once more after a dropped response — yields one copy.
 */
export function useDuplicateResource(
  options: UseDuplicateResourceOptions,
): DuplicateResourceFlow {
  const { hostId, perform, onDuplicated } = options
  const duplicate = useDuplicateResourceApi()
  const [pending, setPending] = useState<{
    kind: DuplicableResourceKind
    source: DuplicateResourceSource
    attemptKey: string
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const request = useCallback(
    (kind: DuplicableResourceKind, source: DuplicateResourceSource) => {
      setError(null)
      setBusy(false)
      setPending({ kind, source, attemptKey: createResourceUid() })
    },
    [],
  )
  const close = useCallback(() => {
    setPending(null)
    setError(null)
  }, [])
  const confirm = useCallback(
    async (name: string) => {
      if (!pending || busy) return
      setBusy(true)
      setError(null)
      try {
        const attempt = {
          kind: pending.kind,
          sourceId: pending.source.id,
          name,
          attemptKey: pending.attemptKey,
        }
        let copy: DuplicatedHostResource
        if (perform) {
          copy = await perform(attempt)
        } else if (isDuplicableHostResourceKind(attempt.kind)) {
          copy = await duplicate({ hostId, ...attempt, kind: attempt.kind })
        } else {
          throw new Error('That resource is copied by its own plugin')
        }
        setPending(null)
        onDuplicated?.(pending.kind, copy, pending.source)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Duplicate failed')
      } finally {
        setBusy(false)
      }
    },
    [pending, busy, duplicate, perform, hostId, onDuplicated],
  )

  const dialog = useMemo(
    () =>
      pending ? (
        <DuplicateResourceDialog
          open
          kind={pending.kind}
          sourceName={pending.source.name}
          busy={busy}
          error={error}
          onClose={close}
          onConfirm={(name) => void confirm(name)}
        />
      ) : null,
    [pending, busy, error, close, confirm],
  )

  return { request, dialog }
}

export default DuplicateResourceDialog
