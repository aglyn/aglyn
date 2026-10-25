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

import { useMediaPicker, type PickedMedia } from '@aglyn/aglyn/app-utils/media-picker-context'
import { BlockedControl } from '@aglyn/shared-ui-jsx/components/blocked-control.component'
import { PrerequisiteNotice } from '@aglyn/shared-ui-jsx/components/prerequisite-notice.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useConsoleHostRoute, useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import {
  POS_READER_SPLASH_LARGEST,
  posReaderSplashArtworkProblem,
  type PosReaderSplashChoice,
  type PosReaderSplashStatus,
} from '../../model/pos-reader-splash'
import {
  PosReaderSplashRequestError,
  readerSplashStatus,
  saveReaderSplash,
} from './pos/pos-reader-splash-api'

export interface PosReaderSplashSettingProps {
  hostId: string
  /** Whether the viewer may change the site's readers (`managePos`, admin or editor). */
  canManagePos: boolean
}

/** An image's pixel size, read in the browser before anything is saved. */
function imageSize(src: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => resolve(null)
    image.src = src
  })
}

const NOT_ALLOWED = 'Only an admin or editor with the "Use the point of sale" permission can change the readers.'

/**
 * "Reader start-up screen" on the POS devices card (AGL-4048): what the
 * store's Stripe smart readers show while they wait for a payment. The
 * platform's default screen, the workspace's logo on a white screen, or a
 * full-screen portrait image from the media library. A white-label
 * workspace is never offered the platform's screen and shows its own logo
 * unless it picks an image.
 *
 * The server applies the choice to the store's readers when it is saved
 * (and again when this opens and finds the logo changed since); readers
 * pick it up within about ten minutes.
 */
export function PosReaderSplashSetting({ hostId, canManagePos }: PosReaderSplashSettingProps) {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { pickMedia } = useMediaPicker()
  const { orgSlug } = useConsoleHostRoute(hostId)
  const [status, setStatus] = useState<PosReaderSplashStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState<PickedMedia | null>(null)
  const uid = user?.uid ?? ''

  useEffect(() => {
    if (!user) return
    let active = true
    readerSplashStatus(user, hostId)
      .then((answer) => {
        if (active) setStatus(answer)
      })
      .catch(() => {
        if (active) setStatus(null)
      })
    return () => {
      active = false
    }
    // Keyed on the person, not the session object (see the register page).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, hostId])

  const save = useCallback(
    async (choice: PosReaderSplashChoice, image?: { mediaScope: string; mediaId: string }) => {
      if (!user) return
      setBusy(true)
      try {
        const answer = await saveReaderSplash(user, hostId, choice, image)
        setStatus(answer)
        if (!answer.problem) {
          enqueueSnackbar(
            answer.locationReady
              ? 'Saved. Your readers show it within about ten minutes.'
              : 'Saved. Your readers show it once you add one.',
            { variant: 'success', persist: false },
          )
        }
      } catch (error) {
        enqueueSnackbar(
          error instanceof PosReaderSplashRequestError ? error.message : 'The start-up screen could not be saved',
          { variant: 'warning', persist: false },
        )
      } finally {
        setBusy(false)
      }
    },
    [user, hostId, enqueueSnackbar],
  )

  const chooseImage = async () => {
    const media = await pickMedia?.({ kind: 'image' })
    if (!media) return
    if (!media.mediaId || !media.mediaScope) {
      enqueueSnackbar('Choose an image from your media library.', { variant: 'warning', persist: false })
      return
    }
    const size = await imageSize(media.url)
    const problem = posReaderSplashArtworkProblem({
      contentType: media.contentType ?? null,
      width: size?.width ?? 0,
      height: size?.height ?? 0,
    })
    if (problem) {
      enqueueSnackbar(problem, { variant: 'warning', persist: false })
      return
    }
    setPicked(media)
    await save('image', { mediaScope: media.mediaScope, mediaId: media.mediaId })
  }

  if (!status?.available) return null

  const blockedReason = !canManagePos ? NOT_ALLOWED : busy ? 'Saving…' : null
  const hasLogo = Boolean(status.logoUrl)
  const profileHref = orgSlug ? `/${orgSlug}/settings/profile` : undefined
  const brand = status.productName
  const preview =
    status.effectiveChoice === 'logo' ? status.logoUrl : status.effectiveChoice === 'image' ? (picked?.url ?? status.image?.url ?? null) : null

  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">{'Reader start-up screen'}</Typography>
      <Typography variant="body2" color="text.secondary">
        {'What your card readers show while they wait for a payment.'}
      </Typography>
      <RadioGroup
        value={status.effectiveChoice}
        onChange={(event) => {
          const choice = event.target.value as PosReaderSplashChoice
          if (choice === 'image') {
            if (status.image) void save('image', { mediaScope: status.image.mediaScope, mediaId: status.image.mediaId })
            else void chooseImage()
            return
          }
          void save(choice)
        }}
      >
        {status.whiteLabel ? null : (
          <FormControlLabel
            value="platform"
            disabled={Boolean(blockedReason)}
            control={<Radio size="small" />}
            label={
              <Stack>
                <Typography variant="body2">{`The ${brand} start-up screen`}</Typography>
                {status.platformReady ? null : (
                  <Typography variant="caption" color="text.secondary">
                    {'Until it is ready, your readers show their standard screen.'}
                  </Typography>
                )}
              </Stack>
            }
          />
        )}
        <FormControlLabel
          value="logo"
          disabled={Boolean(blockedReason) || !hasLogo}
          control={<Radio size="small" />}
          label={
            <Stack>
              <Typography variant="body2">{'Your logo'}</Typography>
              <Typography variant="caption" color="text.secondary">
                {'Your organization profile’s logo, centered on a white screen.'}
              </Typography>
            </Stack>
          }
        />
        <FormControlLabel
          value="image"
          disabled={Boolean(blockedReason)}
          control={<Radio size="small" />}
          label={
            <Stack>
              <Typography variant="body2">{'Your own image'}</Typography>
              <Typography variant="caption" color="text.secondary">
                {`A full-screen portrait image from your media library, at least ${POS_READER_SPLASH_LARGEST.width} × ${POS_READER_SPLASH_LARGEST.height} pixels.`}
              </Typography>
            </Stack>
          }
        />
      </RadioGroup>
      {hasLogo ? null : (
        <PrerequisiteNotice
          href={profileHref}
          actionLabel="Organization profile"
          severity={status.effectiveChoice === 'logo' ? 'warning' : 'info'}
        >
          {'Add a logo to your organization profile to show it on your card readers.'}
        </PrerequisiteNotice>
      )}
      {status.effectiveChoice === 'image' ? (
        <Box>
          <BlockedControl blocked={Boolean(blockedReason)} reason={blockedReason ?? ''}>
            <Button size="small" onClick={() => void chooseImage()}>
              {status.image ? 'Choose another image' : 'Choose image'}
            </Button>
          </BlockedControl>
        </Box>
      ) : null}
      {preview ? (
        <Box
          component="img"
          src={preview}
          alt=""
          sx={(theme) => ({
            alignSelf: 'flex-start',
            maxWidth: theme.spacing(16),
            maxHeight: theme.spacing(16),
            objectFit: 'contain',
            borderRadius: 1,
            border: 1,
            borderColor: 'divider',
          })}
        />
      ) : null}
      {status.problem && !(status.effectiveChoice === 'logo' && !hasLogo) ? (
        <Alert severity="warning">{status.problem}</Alert>
      ) : (
        <Typography variant="caption" color="text.secondary">
          {!status.locationReady
            ? 'Your readers show it once you add your first one.'
            : status.appliedAtMs
              ? `Sent to your readers ${new Date(status.appliedAtMs).toLocaleString()}. Readers update within about ten minutes.`
              : 'Readers update within about ten minutes of a change.'}
        </Typography>
      )}
    </Stack>
  )
}
PosReaderSplashSetting.displayName = 'PosReaderSplashSetting'

export default PosReaderSplashSetting
