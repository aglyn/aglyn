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

import type { ConsoleStaffPageProps } from '@aglyn/aglyn'
import { resolveStaffRoleGate } from '@aglyn/aglyn/app-utils/staff-role-gate'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { BlockedControl } from '@aglyn/shared-ui-jsx/components/blocked-control.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Alert, Box, Button, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { POS_READER_SPLASH_MAX_BYTES, type PosReaderSplashFamilyId } from '../../model/pos-reader-splash'
import {
  PosReaderSplashRequestError,
  staffApplyReaderSplash,
  staffReaderSplash,
  staffReaderSplashPreview,
  staffRemoveReaderSplash,
  staffUploadReaderSplash,
  type StaffReaderSplash,
  type StaffReaderSplashFamily,
} from './pos/pos-reader-splash-api'

const WRITE_ROLES = ['super'] as const

/** A file as base64, without the `data:` prefix. */
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? '').replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/**
 * Staff → Reader start-up screen (AGL-4048): the platform's default screen
 * for Stripe smart readers, shown by every store that has not picked its own
 * logo or image. White-label workspaces never show it. The artwork is made
 * separately and uploaded here, one image per screen size, each checked
 * against Stripe's rules before it is kept. A change is put on every store's
 * readers straight away; readers pick it up within about ten minutes.
 */
export function PosReaderSplashStaffPage(props: ConsoleStaffPageProps) {
  const { staffRole = null } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [state, setState] = useState<StaffReaderSplash | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [previews, setPreviews] = useState<Partial<Record<PosReaderSplashFamilyId, string>>>({})
  const inputs = useRef<Partial<Record<PosReaderSplashFamilyId, HTMLInputElement | null>>>({})
  const gate = resolveStaffRoleGate(staffRole, WRITE_ROLES)
  const uid = user?.uid ?? ''

  const warn = useCallback(
    (caught: unknown, fallback: string) =>
      enqueueSnackbar(caught instanceof PosReaderSplashRequestError ? caught.message : fallback, {
        variant: 'warning',
        persist: false,
      }),
    [enqueueSnackbar],
  )

  const load = useCallback(async () => {
    if (!user) return
    setError(null)
    try {
      setState(await staffReaderSplash(user))
    } catch (caught) {
      setError(caught instanceof PosReaderSplashRequestError ? caught.message : 'The start-up screen could not be read')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid])

  useEffect(() => {
    void load()
  }, [load])

  // Each family's image, fetched with the staff session (the route is not public).
  const shas = state?.families.map((family) => family.image?.sha256 ?? '').join(',') ?? ''
  useEffect(() => {
    if (!user || !state) return
    let active = true
    const made: string[] = []
    void Promise.all(
      state.families.map(async (family) => {
        const url = family.image ? await staffReaderSplashPreview(user, family.id).catch(() => null) : null
        if (url) made.push(url)
        return [family.id, url ?? undefined] as const
      }),
    ).then((entries) => {
      if (active) setPreviews(Object.fromEntries(entries))
    })
    return () => {
      active = false
      made.forEach((url) => URL.revokeObjectURL(url))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, shas])

  const applyEverywhere = async () => {
    if (!user) return
    try {
      const counts = await staffApplyReaderSplash(user)
      enqueueSnackbar(
        `Updated ${counts.applied} ${counts.applied === 1 ? 'store' : 'stores'}` +
          (counts.failed ? `; ${counts.failed} could not be updated` : '') +
          (counts.more ? '. Press Update stores again for the rest.' : '.'),
        { variant: counts.failed ? 'warning' : 'success', persist: false },
      )
    } catch (caught) {
      warn(caught, 'Stores could not be updated')
    }
  }

  const change = async (run: () => Promise<StaffReaderSplash>, fallback: string) => {
    setBusy(true)
    try {
      setState(await run())
      await applyEverywhere()
    } catch (caught) {
      warn(caught, fallback)
    } finally {
      setBusy(false)
    }
  }

  const upload = async (family: StaffReaderSplashFamily, file: File | undefined) => {
    if (!user || !file) return
    if (file.size >= POS_READER_SPLASH_MAX_BYTES) {
      enqueueSnackbar('Use an image under 2 MB.', { variant: 'warning', persist: false })
      return
    }
    const data = await readBase64(file)
    await change(() => staffUploadReaderSplash(user, family.id, data), 'The image could not be uploaded')
  }

  const remove = async (family: StaffReaderSplashFamily) => {
    if (!user) return
    const confirmed = await confirm({
      title: `Remove the ${family.label} screen?`,
      description:
        family.id === 'portrait-large'
          ? 'Without it there is no default: stores that use it go back to the reader’s standard screen.'
          : 'This screen is then drawn from the S700 and S710 image.',
      confirmationText: 'Remove',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (confirmed) await change(() => staffRemoveReaderSplash(user, family.id), 'The image could not be removed')
  }

  const writeReason = gate.reason ?? (busy ? 'Saving…' : undefined)

  return (
    <CardDisplay
      header={'Reader start-up screen'}
      HeaderProps={{
        action: (
          <BlockedControl blocked={Boolean(writeReason) || !state?.ready} reason={writeReason ?? 'Upload the S700 and S710 screen first.'}>
            <Button size="small" onClick={() => void applyEverywhere()}>
              {'Update stores'}
            </Button>
          </BlockedControl>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'The default screen Stripe smart readers show while they wait for a payment, on every store that has not ' +
            'chosen its own logo or image. White-label workspaces never show it. Readers pick up a change within about ' +
            'ten minutes.'}
        </Typography>
        <Alert severity="info">
          {'Each image must be a PNG or JPEG under 2 MB, at exactly the reader’s screen size. The WisePOS E screen is ' +
            'drawn from the S700 and S710 image when none is uploaded.'}
        </Alert>
        {error ? <Alert severity="warning">{error}</Alert> : null}
        {(state?.families ?? []).map((family) => (
          <Stack key={family.id} direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
            <Box
              sx={(theme) => ({
                width: theme.spacing(12),
                aspectRatio: '9 / 16',
                borderRadius: 1,
                border: 1,
                borderColor: 'divider',
                bgcolor: 'action.hover',
                overflow: 'hidden',
                flexShrink: 0,
              })}
            >
              {previews[family.id] ? (
                <Box
                  component="img"
                  src={previews[family.id]}
                  alt={`${family.label} start-up screen`}
                  sx={{ width: 1, height: 1, objectFit: 'cover', display: 'block' }}
                />
              ) : null}
            </Box>
            <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle2">{family.label}</Typography>
              <Typography variant="body2" color="text.secondary">
                {`${family.width} × ${family.height} pixels. ` +
                  (family.image
                    ? `Uploaded ${new Date(family.image.uploadedAtMs).toLocaleString()}.`
                    : family.id === 'portrait-large'
                      ? 'Not uploaded: stores show the reader’s standard screen.'
                      : 'Not uploaded: drawn from the S700 and S710 image.')}
              </Typography>
            </Stack>
            <Stack direction="row" spacing={1}>
              <input
                ref={(element) => {
                  inputs.current[family.id] = element
                }}
                type="file"
                accept="image/png,image/jpeg"
                hidden
                aria-label={`Upload the ${family.label} screen`}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  void upload(family, file)
                }}
              />
              <BlockedControl blocked={Boolean(writeReason)} reason={writeReason ?? ''}>
                <Button size="small" onClick={() => inputs.current[family.id]?.click()}>
                  {family.image ? 'Replace' : 'Upload'}
                </Button>
              </BlockedControl>
              {family.image ? (
                <BlockedControl blocked={Boolean(writeReason)} reason={writeReason ?? ''}>
                  <Button size="small" color="error" onClick={() => void remove(family)}>
                    {'Remove'}
                  </Button>
                </BlockedControl>
              ) : null}
            </Stack>
          </Stack>
        ))}
      </Stack>
    </CardDisplay>
  )
}
PosReaderSplashStaffPage.displayName = 'PosReaderSplashStaffPage'

export default PosReaderSplashStaffPage
