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

import * as Aglyn from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useHost } from '../hooks/use-host'
import { Box, Button, Stack, Typography } from '@mui/material'
import { useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import { SITE_LOGO_HINT } from '../constants/media-size-hints'
import MediaPickerDialog from './media/media-picker-dialog.component'

export interface LogoCardProps {
  hostId: string
}

/** The two host fields a logo slot writes. */
type LogoField = 'logoUrl' | 'logoDarkUrl'

/**
 * Site logo picker (AGL-594): pick (or upload) the site's brand mark in
 * the media browser and the asset URL lands on the host's `logoUrl`.
 * The tenant's navigation loader shows it (site name when unset);
 * distinct from `seo.entity.logo`, which is JSON-LD publisher data.
 *
 * A second slot holds the dark-scheme mark, `logoDarkUrl` (AGL-3400): the
 * live site shows it on the loader and error screens when the visitor's
 * scheme is dark, and falls back to the first when it is unset. Each preview
 * sits on the ground it will be seen on, which is how an owner notices that a
 * dark wordmark needs its partner before a visitor does.
 */
export function LogoCard(props: LogoCardProps) {
  const { hostId } = props

  return (
    <CardDisplay
      header={'Site logo'}
      help={docsHelp('media', {
        excerpt:
          "Your site's brand mark, picked from the media library — " +
          'shown while pages load on your live site.',
      })}
      contentGutterX
      contentGutterY
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {'Shown while pages load on your live site. Without a logo, the ' +
          'site name is shown instead. Add a dark mode version if your logo ' +
          'is hard to see on a dark background.'}
      </Typography>
      {/* What to bring, said before the upload (AGL-2486). */}
      <Typography
        variant="caption"
        color="text.secondary"
        component="div"
        sx={{ mt: 0.5, mb: 1 }}
      >
        {SITE_LOGO_HINT}
      </Typography>
      <Stack spacing={1.5}>
        <LogoSlot
          hostId={hostId}
          field="logoUrl"
          label="Light mode"
          ground="light"
        />
        <LogoSlot
          hostId={hostId}
          field="logoDarkUrl"
          label="Dark mode"
          ground="dark"
          emptyText="Uses the light mode logo"
        />
      </Stack>
    </CardDisplay>
  )
}
LogoCard.displayName = 'LogoCard'

function LogoSlot(props: {
  hostId: string
  field: LogoField
  label: string
  /** The background the mark is previewed on — the one it will be seen on. */
  ground: 'light' | 'dark'
  emptyText?: string
}) {
  const { hostId, field, label, ground, emptyText = 'No logo set' } = props
  const { enqueueSnackbar } = useSnackbar()
  const {
    doc: { data },
    setDoc,
  } = useHost({ hostId })
  const [pickerOpen, setPickerOpen] = useState(false)
  const value = data?.[field]
  /**
   * The stored value has three generations — a raw storage URL, an AGL-175
   * CDN path, and a `media:` reference (AGL-1407) — and only the resolver
   * knows all three. Handing the raw string to `<img src>` worked for exactly
   * as long as no site's `logoUrl` held a reference; the tenant's three
   * readers all resolve, so this preview was the last one that would have
   * shown a broken image the moment the data was converted.
   */
  const preview = Aglyn.resolveMediaSrc(value, { hostId })
  const write = (next: string, done: string) =>
    setDoc({ [field]: next }, { merge: true })
      .then(() => enqueueSnackbar(done, { variant: 'success', persist: false }))
      .catch(() =>
        enqueueSnackbar('An error has occurred', { variant: 'error' }),
      )

  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
    >
      <Typography variant="body2" sx={{ width: 88, flexShrink: 0 }}>
        {label}
      </Typography>
      <Box
        sx={{
          width: 176,
          height: 56,
          px: 1,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 1,
          border: 1,
          borderColor: 'divider',
          bgcolor: ground === 'dark' ? 'grey.900' : 'common.white',
        }}
      >
        {preview ? (
          <Box
            component="img"
            src={preview}
            alt={`Site logo, ${label.toLowerCase()}`}
            sx={{ maxHeight: 44, maxWidth: 160, objectFit: 'contain' }}
          />
        ) : (
          <Typography
            variant="caption"
            sx={{ color: ground === 'dark' ? 'grey.400' : 'grey.600' }}
          >
            {emptyText}
          </Typography>
        )}
      </Box>
      <Button size="small" color="primary" onClick={() => setPickerOpen(true)}>
        {value ? 'Replace from media' : 'Choose from media'}
      </Button>
      {value ? (
        <Button
          size="small"
          color="error"
          onClick={() => void write('', 'Logo removed')}
        >
          {'Remove'}
        </Button>
      ) : null}
      <MediaPickerDialog
        hostId={hostId}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(media) => {
          // `mediaNodeSrc`, not `media.url` — the same writer the besigner
          // picker and the social-image card use. It mints a `media:`
          // reference when the org is entitled to CDN delivery and falls back
          // to the raw URL when it is not, so the entitlement gate keeps
          // working and picking a logo stops undoing the AGL-1407 conversion
          // the next time someone opens this card.
          const src = Aglyn.mediaNodeSrc(media)
          if (!src) return
          void write(src, 'Logo saved')
        }}
      />
    </Stack>
  )
}
LogoSlot.displayName = 'LogoSlot'

export default LogoCard
