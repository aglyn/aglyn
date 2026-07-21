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

import { ICON_VARIANT_USER_SETTINGS } from '@aglyn/shared-data-enums'
import { CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Avatar,
  Button,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { doc, setDoc, Timestamp } from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import AuthenticatedLayout from '../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../components/layouts/main.layout'
import manageNavTabItems from '../../../../constants/manage-nav-tabs'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import MediaUrlField from '../../../../components/media-url-field.component'
import { useOrgScope } from '../../../../hooks/use-org-scope'
import useFirestoreDoc from '../../../../hooks/use-firestore-doc'

const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/

/**
 * Personal community profile (AGL-366): your own identity on community
 * listings, comments, and the publisher page — distinct from the
 * organization's presence (which lives under the org's Community tab).
 */
const ManageCommunityProfile: NextPageWithLayout<Record<string, never>> = () => {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { currentOrg } = useOrgScope()
  const { enqueueSnackbar } = useSnackbar()
  const uid = user?.uid
  const { data: profile } = useFirestoreDoc<any>(
    () => doc(firestore, 'profiles', uid ?? '-anonymous-'),
    [firestore, uid],
    { idField: '$id' },
  )

  const [handle, setHandle] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [website, setWebsite] = useState('')
  useEffect(() => {
    setHandle(profile?.handle ?? '')
    setDisplayName(profile?.displayName ?? '')
    setBio(profile?.bio ?? '')
    setAvatarUrl(profile?.avatarUrl ?? '')
    setWebsite(profile?.website ?? '')
  }, [
    profile?.handle,
    profile?.displayName,
    profile?.bio,
    profile?.avatarUrl,
    profile?.website,
  ])
  const validHandle = !handle || HANDLE_PATTERN.test(handle)

  const handleSave = useCallback(async () => {
    if (!uid || !validHandle || !displayName.trim()) return
    if (avatarUrl && !/^https:\/\//i.test(avatarUrl)) {
      return void enqueueSnackbar('Avatar URLs must be https://', {
        variant: 'warning',
        persist: false,
      })
    }
    try {
      await setDoc(
        doc(firestore, 'profiles', uid),
        {
          ...(handle ? { handle } : {}),
          displayName: displayName.trim().slice(0, 80),
          bio: bio.trim().slice(0, 500),
          avatarUrl: avatarUrl.trim().slice(0, 500),
          website: website.trim().slice(0, 200),
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      )
      enqueueSnackbar('Profile saved', { variant: 'success', persist: false })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [
    uid,
    validHandle,
    handle,
    displayName,
    bio,
    avatarUrl,
    website,
    firestore,
    enqueueSnackbar,
  ])

  return (
    <>
      <NextPageTitle screen={'Community profile'} />
      <DashboardLayout
        navTabItems={manageNavTabItems()}
        activeTab={buildRoute(Route.MANAGE_MY_COMMUNITY)}
        breadcrumbItems={[
          {
            children: 'Community profile',
            href: buildRoute(Route.MANAGE_MY_COMMUNITY),
          },
        ]}
        header={{
          children: 'My community profile',
          icon: { path: ICON_VARIANT_USER_SETTINGS.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <CardDisplay
            header={'Profile'}
            help={docsHelp('publisherHandbook', {
              anchor: '#before-your-first-publish',
              excerpt:
                'Your personal identity on community listings and comments ' +
                '— separate from any organization profile.',
            })}
            contentGutterX
            contentGutterY
          >
            <Stack spacing={2} sx={{ maxWidth: 480 }}>
              <Typography variant="body2" color="text.secondary">
                {'How you appear on community listings and comments — ' +
                  'yours personally, separate from any organization ' +
                  'profile.'}
              </Typography>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                <Avatar src={avatarUrl || undefined} sx={{ width: 56, height: 56 }}>
                  {(displayName || user?.email || '?')
                    .slice(0, 1)
                    .toUpperCase()}
                </Avatar>
                <MediaUrlField
                  label="Avatar URL"
                  helperText="Browse the org media library or paste an https URL"
                  orgId={currentOrg?.$id ?? null}
                  value={avatarUrl}
                  onChange={setAvatarUrl}
                />
              </Stack>
              <TextField
                label="Display name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
              <TextField
                label="Handle"
                value={handle}
                error={Boolean(handle) && !HANDLE_PATTERN.test(handle)}
                helperText="Lowercase letters, digits and hyphens (3–30 chars)"
                onChange={(event) =>
                  setHandle(event.target.value.toLowerCase())
                }
              />
              <TextField
                label="Bio"
                multiline
                minRows={3}
                value={bio}
                onChange={(event) => setBio(event.target.value)}
              />
              <TextField
                label="Website"
                placeholder="https://…"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
              />
              <Stack direction="row">
                <Button
                  variant="contained"
                  disabled={!displayName.trim() || !validHandle}
                  onClick={() => void handleSave()}
                >
                  {'Save profile'}
                </Button>
              </Stack>
            </Stack>
          </CardDisplay>
        </Container>
      </DashboardLayout>
    </>
  )
}
ManageCommunityProfile.displayName = 'Page:ManageCommunityProfile'

export default ManageCommunityProfile
