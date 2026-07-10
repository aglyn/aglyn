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
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import {
  collection,
  deleteField,
  doc,
  limit,
  query,
  updateDoc,
} from 'firebase/firestore'
import { useCallback } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import useFirestoreCollection from '../hooks/use-firestore-collection'
import useFirestoreDoc from '../hooks/use-firestore-doc'

export interface ErrorScreensCardProps {
  hostId: string
}

const ERROR_SLOTS: Array<{
  key: 'notFound' | 'unauthorized' | 'forbidden' | 'unavailable'
  label: string
  hint: string
}> = [
  {
    key: 'notFound',
    label: '404 · Not found',
    hint: 'Missing addresses',
  },
  {
    key: 'unauthorized',
    label: '401 · Members only',
    hint: 'Members-only pages when signed out',
  },
  {
    key: 'forbidden',
    label: '403 · Forbidden',
    hint: 'Reserved for future access rules',
  },
  {
    key: 'unavailable',
    label: '503 · Maintenance',
    hint: 'Shown everywhere while maintenance mode is on',
  },
]

/**
 * Error screens (AGL-131, grown from the AGL-87 404 card): assign a
 * designed screen per status code, plus the site-wide maintenance toggle.
 * The 404 pick also writes the legacy `notFoundScreenId` so older tenant
 * builds keep working.
 */
export function ErrorScreensCard(props: ErrorScreensCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { data: host } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: screenDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'screens'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const screens = [...(screenDocs ?? [])]
    .filter((screen: any) => !screen.deletedAt)
    .sort((a: any, b: any) =>
      String(a.displayName ?? '').localeCompare(String(b.displayName ?? '')),
    )

  const handleChange = useCallback(
    (key: string) => async (value: string) => {
      await updateDoc(doc(firestore, 'hosts', hostId), {
        [`errorScreens.${key}`]: value || deleteField(),
        // Back-compat (AGL-87): older tenant builds read the flat field.
        ...(key === 'notFound' && {
          notFoundScreenId: value || deleteField(),
        }),
      })
      enqueueSnackbar(value ? 'Error screen set' : 'Error screen cleared', {
        variant: 'success',
        persist: false,
      })
    },
    [firestore, hostId, enqueueSnackbar],
  )

  const handleMaintenance = useCallback(
    async (enabled: boolean) => {
      await updateDoc(doc(firestore, 'hosts', hostId), {
        maintenance: enabled || deleteField(),
      })
      enqueueSnackbar(
        enabled
          ? 'Maintenance mode on — visitors see the 503 screen'
          : 'Maintenance mode off',
        { variant: enabled ? 'warning' : 'success', persist: false },
      )
    },
    [firestore, hostId, enqueueSnackbar],
  )

  const errorScreens = host?.errorScreens ?? {}

  return (
    <CardDisplay header="Error pages" contentGutterX contentGutterY>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {'Design these like any screen, then assign them here. Assigned ' +
          'screens are kept out of search results.'}
      </Typography>
      <Stack spacing={2}>
        {ERROR_SLOTS.map((slot) => (
          <TextField
            key={slot.key}
            select
            size="small"
            label={slot.label}
            helperText={slot.hint}
            value={
              errorScreens[slot.key] ??
              (slot.key === 'notFound' ? (host?.notFoundScreenId ?? '') : '')
            }
            onChange={(event) =>
              void handleChange(slot.key)(event.target.value)
            }
            sx={{ minWidth: 280 }}
          >
            <MenuItem value="">{'Built-in default'}</MenuItem>
            {screens.map((screen: any) => (
              <MenuItem key={screen.$id} value={screen.$id}>
                {screen.displayName ?? screen.$id}
              </MenuItem>
            ))}
          </TextField>
        ))}
        <FormControlLabel
          control={
            <Switch
              color="warning"
              checked={Boolean(host?.maintenance)}
              onChange={(event) =>
                void handleMaintenance(event.target.checked)
              }
            />
          }
          label="Maintenance mode — show the 503 screen on every page"
        />
      </Stack>
    </CardDisplay>
  )
}
ErrorScreensCard.displayName = 'ErrorScreensCard'

export default ErrorScreensCard
