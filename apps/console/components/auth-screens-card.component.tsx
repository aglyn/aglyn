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
import { MenuItem, Stack, TextField, Typography } from '@mui/material'
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
import { docsHelp } from '../constants/docs-links'
import useFirestoreCollection from '../hooks/use-firestore-collection'
import useFirestoreDoc from '../hooks/use-firestore-doc'

export interface AuthScreensCardProps {
  hostId: string
}

const AUTH_SLOTS: Array<{
  key: 'signinScreenId' | 'signupScreenId' | 'recoveryScreenId'
  label: string
  hint: string
}> = [
  {
    key: 'signinScreenId',
    label: 'Sign-in screen',
    hint: 'Rendered at /signin — drop a Member sign-in block on it',
  },
  {
    key: 'signupScreenId',
    label: 'Sign-up screen',
    hint: 'Rendered at /signup — drop a Member sign-up block on it',
  },
  {
    key: 'recoveryScreenId',
    label: 'Password recovery screen',
    hint: 'Rendered at /recover — drop a Password recovery block on it',
  },
]

/**
 * Auth screens (AGL-553), the error-pages card's sibling: designate a
 * besigner-built screen per membership route (`authScreens` on the host
 * doc). Designated screens render through the normal composition pipeline
 * (theme + shared layout); cleared slots fall back to the built-in forms,
 * minimally restyled with the site theme.
 */
export function AuthScreensCard(props: AuthScreensCardProps) {
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
        [`authScreens.${key}`]: value || deleteField(),
      })
      enqueueSnackbar(value ? 'Auth screen set' : 'Auth screen cleared', {
        variant: 'success',
        persist: false,
      })
    },
    [firestore, hostId, enqueueSnackbar],
  )

  const authScreens = host?.authScreens ?? {}

  return (
    <CardDisplay
      header="Sign-in & sign-up pages"
      help={docsHelp('members', {
        anchor: '#1-the-built-in-sign-in-and-sign-up-pages',
        excerpt:
          'Replace the built-in membership forms at /signin, /signup, ' +
          'and /recover with screens you design.',
      })}
      contentGutterX
      contentGutterY
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {'Design your own membership pages with the Members blocks ' +
          '(Member sign-in, Member sign-up, Password recovery), then ' +
          'assign them here to replace the built-in forms at /signin, ' +
          '/signup, and /recover. Assigned screens are kept out of ' +
          'search results.'}
      </Typography>
      <Stack spacing={2}>
        {AUTH_SLOTS.map((slot) => (
          <TextField
            key={slot.key}
            select
            size="small"
            label={slot.label}
            helperText={slot.hint}
            value={authScreens[slot.key] ?? ''}
            onChange={(event) =>
              void handleChange(slot.key)(event.target.value)
            }
            sx={{ minWidth: 280 }}
          >
            <MenuItem value="">{'Built-in form'}</MenuItem>
            {screens.map((screen: any) => (
              <MenuItem key={screen.$id} value={screen.$id}>
                {screen.displayName ?? screen.$id}
              </MenuItem>
            ))}
          </TextField>
        ))}
      </Stack>
    </CardDisplay>
  )
}
AuthScreensCard.displayName = 'AuthScreensCard'

export default AuthScreensCard
