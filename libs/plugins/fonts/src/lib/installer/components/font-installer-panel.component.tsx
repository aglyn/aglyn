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

import type { ConsoleThemeEditorFontsZoneProps } from '@aglyn/aglyn'
import FileDropZone from '@aglyn/shared-ui-jsx/components/file-drop-zone.component'
import { mdiFormatFont } from '@mdi/js'
import { Divider, Stack, Typography } from '@mui/material'
import { useMemo } from 'react'
import { FONT_UPLOAD_ACCEPT, FONT_UPLOAD_MAX_BYTES } from '../constants'
import { useInstalledFontFaces } from '../font-preview'
import {
  customFontFamilies,
  fontRolesOf,
  removeCustomFontFace,
  removeCustomFontFamily,
  setCustomFontCategory,
  setCustomFontRole,
} from '../theme-fonts'
import { useFontInstaller } from '../use-font-installer'
import { FontJobRow } from './font-job-row.component'
import { InstalledFontRow } from './installed-font-row.component'

/**
 * The font installer (AGL-3656), in the theme editor's Typography card:
 * drop or choose font files, see what each one is and whether its license
 * lets a website use it, and pick what the site draws with. Every change is
 * an unsaved edit of the editor's draft, saved or discarded with the
 * editor's own buttons; the files themselves are in the site's media
 * library from the moment they are installed.
 */
export function FontInstallerPanel(props: ConsoleThemeEditorFontsZoneProps) {
  const { hostId, draft, updateDraft } = props
  const { jobs, add, dismiss, reject } = useFontInstaller({ hostId, draft, updateDraft })
  const families = useMemo(() => customFontFamilies(draft), [draft])
  useInstalledFontFaces(hostId, families)

  return (
    <Stack spacing={1.5} sx={{ mt: 2 }} component="section" aria-labelledby="font-installer-heading">
      <Divider />
      <div>
        <Typography id="font-installer-heading" variant="subtitle2" component="h3">
          {'Your own fonts'}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {'Upload a font you are licensed to use on a website. It is checked, trimmed to the scripts it covers and served from your site.'}
        </Typography>
      </div>
      <FileDropZone
        accept={FONT_UPLOAD_ACCEPT}
        onFiles={add}
        onRejected={reject}
        icon={mdiFormatFont}
        label="Drop font files here, or choose files"
        hint={`WOFF2, WOFF, TTF or OTF · up to ${Math.round(FONT_UPLOAD_MAX_BYTES / 1024 / 1024)} MB each`}
      />
      {jobs.map((job) => (
        <FontJobRow key={job.id} job={job} onDismiss={() => dismiss(job.id)} />
      ))}
      {families.map((font) => (
        <InstalledFontRow
          key={font.family}
          font={font}
          roles={fontRolesOf(draft, font.family)}
          onRole={(role) => updateDraft((theme) => setCustomFontRole(theme, font.family, role))}
          onCategory={(category) => updateDraft((theme) => setCustomFontCategory(theme, font.family, category))}
          onRemoveFace={(face) => updateDraft((theme) => removeCustomFontFace(theme, font.family, face))}
          onRemove={() => updateDraft((theme) => removeCustomFontFamily(theme, font.family))}
        />
      ))}
    </Stack>
  )
}

export default FontInstallerPanel
