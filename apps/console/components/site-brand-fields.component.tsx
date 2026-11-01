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

import { ImageFileField } from '@aglyn/shared-ui-jsx/components/image-file-field.component'
import {
  saveSiteBrandFiles,
  SITE_BRAND_SLOTS,
  siteBrandFileAccept,
  siteBrandFileRefusal,
  siteBrandFileType,
  type SiteBrandSaveOutcome,
  type SiteBrandSlot,
} from '@aglyn/aglyn/app-utils/site-brand-files'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Box, Stack, Typography } from '@mui/material'
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { LOGO_SPACING_HINT } from '../constants/media-size-hints'
import { signedUploadMaxBytes } from '../utils/media-upload-limits'
import { saveMirroredHostFields } from '../utils/resync-host-memberships'
import { uploadHostImage } from '../utils/upload-host-image'

/** The ceiling every image takes on the upload routes. */
const IMAGE_MAX_BYTES = signedUploadMaxBytes('image/png') as number

const FIELD_GROUND: Partial<Record<SiteBrandSlot, 'light' | 'dark'>> = {
  logo: 'light',
  logoDark: 'dark',
}

export interface SiteBrandFiles {
  /** The three fields, in one quiet row. */
  fields: ReactNode
  /**
   * Puts what the form is holding into a new site's own library and writes
   * it to the site. Never rejects: `missed` says what did not make it.
   */
  save: (hostId: string) => Promise<SiteBrandSaveOutcome>
}

/**
 * A new site's logo, dark logo and favicon (AGL-4119), held as files until
 * the site exists. Beside the name and the address in every create that is
 * the owner's own: all three are optional and none of them ever stands in
 * the way of Create. What a route would refuse for its type or size is said
 * on the field, before anything is created.
 */
export function useSiteBrandFiles(): SiteBrandFiles {
  const { data: user } = useUser()
  // Read at the moment of the save, like the rest of the request.
  const userRef = useRef(user)
  userRef.current = user
  const [files, setFiles] = useState<Partial<Record<SiteBrandSlot, File | null>>>({})
  const filesRef = useRef(files)
  filesRef.current = files
  const [errors, setErrors] = useState<Partial<Record<SiteBrandSlot, string | null>>>({})

  const choose = useCallback((slot: SiteBrandSlot, file: File | null) => {
    const refusal = file ? siteBrandFileRefusal(file, slot, IMAGE_MAX_BYTES) : null
    setErrors((current) => ({ ...current, [slot]: refusal }))
    if (!refusal) setFiles((current) => ({ ...current, [slot]: file }))
  }, [])

  const save = useCallback(
    (hostId: string) =>
      saveSiteBrandFiles(filesRef.current, {
        upload: (file, slot) =>
          uploadHostImage(
            userRef.current as never,
            hostId,
            file,
            siteBrandFileType(file, slot) as string,
          ),
        save: (fields) => saveMirroredHostFields(hostId, userRef.current as never, fields),
      }),
    [],
  )

  const fields = useMemo(
    () => (
      <Stack spacing={1} component="section" aria-label="Logo and favicon" data-create-area="site-brand">
        <Typography variant="subtitle2" component="h3">
          {'Logo and favicon (optional)'}
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' },
            columnGap: 2,
            rowGap: 1.5,
            alignItems: 'start',
          }}
        >
          {SITE_BRAND_SLOTS.map(({ slot, label }) => (
            <ImageFileField
              key={slot}
              label={label}
              file={files[slot] ?? null}
              onChange={(file) => choose(slot, file)}
              onRejected={(file) => choose(slot, file)}
              accept={siteBrandFileAccept(slot)}
              ground={FIELD_GROUND[slot]}
              helperText={slot === 'favicon' ? 'Leave this blank to use your logo.' : undefined}
              error={errors[slot]}
            />
          ))}
        </Box>
        <Typography variant="caption" color="text.secondary" component="p">
          {LOGO_SPACING_HINT}
        </Typography>
      </Stack>
    ),
    [choose, errors, files],
  )

  return { fields, save }
}
