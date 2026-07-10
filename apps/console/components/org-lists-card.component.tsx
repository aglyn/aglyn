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
  deleteDoc,
  doc,
  getCountFromServer,
  limit,
  query,
  setDoc,
} from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import useFirestoreCollection from '../hooks/use-firestore-collection'
import useHostOrgId from '../hooks/use-host-org-id'

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
  const hostOrgId = useHostOrgId(hostId)
  const scope = hostOrgId
    ? (['orgs', hostOrgId] as const)
    : (['hosts', hostId] as const)

  const { data: listDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, scope[0], scope[1], 'lists'), limit(50)),
    [firestore, hostId, hostOrgId],
    { idField: '$id' },
  )
  const lists = [...(listDocs ?? [])].sort((a, b) =>
    String(a.name ?? '').localeCompare(String(b.name ?? '')),
  )
  const [counts, setCounts] = useState<Record<string, number>>({})
  useEffect(() => {
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
  }, [firestore, hostOrgId, JSON.stringify((listDocs ?? []).map((l: any) => l.$id))])

  const [name, setName] = useState('')

  const handleCreate = async () => {
    if (!name.trim()) return
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
    const accepted = await confirm({
      title: 'Delete list?',
      description: `"${list.name}" and its enrollments stop being targetable; automations enrolling into it start reporting errors.`,
      confirmationButtonProps: { color: 'error' },
    })
    if (!accepted) return
    await deleteDoc(doc(firestore, scope[0], scope[1], 'lists', list.$id))
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
            color="secondary"
            disabled={!name.trim()}
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
