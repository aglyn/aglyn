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
import {
  useFirestore,
  useFirestoreCollection,
  useHostResourceApi,
} from '@aglyn/tenant-feature-instance'
import { Button, Stack, Typography } from '@mui/material'
import {
  collection,
  doc,
  limit,
  query,
  Timestamp,
  updateDoc,
} from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { createEmailScreen } from '../utils/create-email-screen'

const besignerHref = (hostId: string, screenId: string, versionId: string) =>
  `/${hostId}/screens/${screenId}/versions/${versionId}/besigner`

/**
 * Email screens list (AGL-395): designed emails are besigner documents with
 * kind 'email'. They used to show in the main Screens list; now they have
 * their own list here on the Emails page. Open in the besigner (where only
 * email-safe components are offered), or start a new one.
 */
export function EmailScreensCard(props: { hostId: string }) {
  const { hostId } = props
  const firestore = useFirestore()
  const createHostResource = useHostResourceApi()
  const router = useRouter()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()

  const { data: screenDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'screens'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const emailScreens = [...(screenDocs ?? [])]
    .filter((screen: any) => !screen.deletedAt && screen.kind === 'email')
    .sort((a: any, b: any) =>
      String(a.displayName ?? '').localeCompare(String(b.displayName ?? '')),
    )

  const handleCreate = async () => {
    try {
      const { screenId, versionId } = await createEmailScreen(
        firestore,
        hostId,
        createHostResource,
      )
      void router.push(besignerHref(hostId, screenId, versionId))
    } catch (error: any) {
      console.error(error)
      enqueueSnackbar(error?.message ?? 'Creating the email failed', {
        variant: 'error',
      })
    }
  }

  const handleDelete = (screen: any) => async () => {
    const confirmed = await confirm({
      title: 'Delete this email?',
      description: `"${screen.displayName ?? 'Untitled email'}" will be removed.`,
      confirmationText: 'Delete',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    await updateDoc(doc(firestore, 'hosts', hostId, 'screens', screen.$id), {
      deletedAt: Timestamp.now(),
    })
  }

  return (
    <CardDisplay header={'Emails'} contentGutterX contentGutterY>
      <Stack spacing={1}>
        {emailScreens.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'Design reusable emails here, then send them as campaigns. New ' +
              'emails open in the besigner with email-safe components only.'}
          </Typography>
        ) : (
          emailScreens.map((screen: any) => (
            <Stack
              key={screen.$id}
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center' }}
            >
              <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                {screen.displayName ?? 'Untitled email'}
              </Typography>
              <Button
                size="small"
                onClick={() =>
                  void router.push(
                    besignerHref(hostId, screen.$id, screen.versionId),
                  )
                }
              >
                {'Edit'}
              </Button>
              <Button size="small" color="error" onClick={handleDelete(screen)}>
                {'Delete'}
              </Button>
            </Stack>
          ))
        )}
        <Button
          size="small"
          color="secondary"
          sx={{ alignSelf: 'flex-start' }}
          onClick={() => void handleCreate()}
        >
          {'New email'}
        </Button>
      </Stack>
    </CardDisplay>
  )
}
EmailScreensCard.displayName = 'EmailScreensCard'

export default EmailScreensCard
