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

import { createResourceUid } from '@aglyn/aglyn'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Button,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import {
  collection,
  doc,
  getCountFromServer,
  limit,
  query,
  setDoc,
} from 'firebase/firestore'
import { useEffect, useState } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
  useOrgDataScope,
  useUser,
} from '@aglyn/tenant-feature-instance'

export interface OrgListsCardProps {
  hostId: string
}

/**
 * Email lists (AGL-254): static audiences at `orgs/{orgId}/lists`, shared
 * across the org's sites. Members arrive via the enrollList automation
 * step, popup email capture, or manual adds here; campaigns target a
 * list from the audience picker.
 */
export function OrgListsCard(props: OrgListsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { data: user } = useUser()
  // The org lookup is async (AGL-1061): `scope` is null until it settles,
  // and stays null for a host with no owning org. Lists have always been
  // org-shared (AGL-254) — there is no host path to fall back to any more
  // (AGL-1050), so creating one is held rather than misdirected.
  const { scope } = useOrgDataScope({ hostId })

  const { data: listDocs } = useFirestoreCollection<any>(
    () =>
      scope
        ? query(collection(firestore, scope[0], scope[1], 'lists'), limit(50))
        : null,
    [firestore, scope],
    { idField: '$id' },
  )
  const lists = [...(listDocs ?? [])].sort((a, b) =>
    String(a.name ?? '').localeCompare(String(b.name ?? '')),
  )
  const [counts, setCounts] = useState<Record<string, number>>({})
  useEffect(() => {
    // `listDocs` can only be non-empty when `scope` resolved, but the
    // effect must say so for itself — it reads `scope` outside the query.
    if (!scope) return undefined
    let active = true
    void Promise.all(
      (listDocs ?? []).map(async (list: any) => {
        try {
          const snapshot = await getCountFromServer(
            collection(
              firestore,
              scope[0],
              scope[1],
              'lists',
              list.$id,
              'members',
            ),
          )
          return [list.$id, snapshot.data().count] as const
        } catch {
          return [list.$id, 0] as const
        }
      }),
    ).then((entries) => {
      if (active) setCounts(Object.fromEntries(entries))
    })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    firestore,
    scope,
    JSON.stringify((listDocs ?? []).map((l: any) => l.$id)),
  ])

  const [name, setName] = useState('')

  const handleCreate = async () => {
    // Without an org there is nowhere org-shared to put the list, and the
    // host path that used to absorb it is gone (AGL-1050). The button is
    // disabled here; this is the same answer for a stale closure.
    if (!name.trim() || !scope) return
    const id = createResourceUid()
    try {
      await setDoc(doc(firestore, scope[0], scope[1], 'lists', id), {
        name: name.trim(),
        createdAt: Timestamp.now(),
      })
      setName('')
      enqueueSnackbar(`List "${name.trim()}" created`, {
        variant: 'success',
        persist: false,
      })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', { variant: 'error' })
    }
  }

  const handleDelete = async (list: any) => {
    if (!scope) return
    const accepted = await confirm({
      title: 'Delete list?',
      description: `"${list.name}" and its enrollments stop being targetable; automations enrolling into it start reporting errors.`,
      confirmationText: 'Delete',
      confirmationButtonProps: { color: 'error' },
    })
      // `confirm` resolves with no value and REJECTS on cancel, so gating on
      // the resolved value alone made this always return (AGL-950).
      .then(() => true)
      .catch(() => false)
    if (!accepted) return
    // The list owns a `members` subcollection of enrolled contacts, and
    // Firestore doesn't cascade — deleting the doc from here left that PII
    // behind, unreachable but still readable to every org member. Only the
    // Admin SDK can recursiveDelete, so this goes through the erase route
    // (AGL-946).
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/resources/erase', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          scope: scope[0],
          scopeId: scope[1],
          kind: 'lists',
          id: list.$id,
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result?.error ?? 'List delete failed')
    } catch (error: any) {
      return void enqueueSnackbar(error?.message ?? 'List delete failed', {
        variant: 'error',
      })
    }
    enqueueSnackbar('List deleted', { variant: 'success', persist: false })
  }

  return (
    <CardDisplay
      header="Email lists"
      contentGutterX
      contentGutterY
      contentBordered="all"
    >
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          {'Static audiences shared across your organization. Enroll ' +
            'contacts with the "Enroll in a list" automation step or popup ' +
            'email capture, then target a list from the campaign composer.'}
        </Typography>
        <Stack direction="row" spacing={1}>
          <TextField
            size="small"
            label="New list name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            sx={{ flexGrow: 1, maxWidth: 320 }}
          />
          <Button
            size="small"
            variant="contained"
            color="primary"
            disabled={!name.trim() || !scope}
            onClick={() => void handleCreate()}
          >
            {'Create'}
          </Button>
        </Stack>
        {lists.length === 0 ? null : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'List'}</TableCell>
                <TableCell>{'Subscribers'}</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {lists.map((list) => (
                <TableRow key={list.$id}>
                  <TableCell>{list.name}</TableCell>
                  <TableCell>{counts[list.$id] ?? '…'}</TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      color="error"
                      onClick={() => void handleDelete(list)}
                    >
                      {'Delete'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Stack>
    </CardDisplay>
  )
}
OrgListsCard.displayName = 'OrgListsCard'

export default OrgListsCard
