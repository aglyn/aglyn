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

import { isScreenGroup, useMediaPicker } from '@aglyn/aglyn'
import { formatMediaRef, mediaNodeSrc, resolveMediaSrc } from '@aglyn/aglyn/app-utils/media-ref'
import { SCREEN_KIND_EMAIL } from '@aglyn/aglyn/app-utils/screen-kind'
import type { CustomFieldInputProps } from '@aglyn/aglyn/plugin-manager/custom-fields'
import { mdiImageOutline } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { useFirestore, useFirestoreCollection } from '@aglyn/tenant-feature-instance'
import { Box, Button, Link, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { collection, limit, query } from 'firebase/firestore'
import { createContext, useContext, useMemo, useState } from 'react'
import { datasetPageScreenId, datasetPageValue } from '../model/dataset-page-field'

/**
 * The record editor's inputs for the two field types that hold a PLACE rather
 * than words (AGL-3763): a photo and a page. Both are chosen from what the
 * workspace already holds — the media library and the site's pages — so a
 * site owner filling a record never types an address or a path.
 */

/**
 * The site the record editor is open on, for the Page field's list.
 *
 * Datasets belong to the organization, and a page belongs to one site, so
 * the list can only be the pages of the site whose Data page is open. The
 * organization Data page provides no site, and its Page field says where to
 * go instead of guessing one.
 */
export const DatasetRecordSiteContext = createContext<{ hostId?: string }>({})
DatasetRecordSiteContext.displayName = 'DatasetRecordSiteContext'

/** The most pages the Page field lists — the Besigner's own page pickers read as many. */
const PAGE_LIST_LIMIT = 200

function valueOf(props: CustomFieldInputProps): string {
  return typeof props.value === 'string' ? props.value : ''
}

/**
 * A record's photo: Choose from media opens the console's media library
 * (this site's files and the organization's), and the pick is stored as a
 * `media:` reference so moving or replacing the file never breaks the record.
 * A photo hosted elsewhere is still possible, behind "Use a link instead".
 */
export function DatasetImageFieldInput(props: CustomFieldInputProps) {
  const { onChange, disabled, label } = props
  const { hostId } = useContext(DatasetRecordSiteContext)
  const { pickMedia } = useMediaPicker()
  const value = valueOf(props)
  const preview = resolveMediaSrc(value.trim(), { hostId })
  // A stored https link opens on the link field, so it can be read and edited.
  const [linkOpen, setLinkOpen] = useState(() => /^https:\/\//i.test(value) || !pickMedia)

  const choose = async () => {
    const media = await pickMedia?.({ kind: 'image' })
    if (!media) return
    // The asset by identity when the picker names it, else read back out of
    // the CDN path it handed over; a library with neither gives its address.
    onChange(
      formatMediaRef(media.mediaScope, media.mediaId) ??
        mediaNodeSrc({ cdnPath: media.url, url: media.url }) ??
        media.url,
    )
  }

  return (
    <Stack spacing={1}>
      {label ? (
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
      ) : null}
      <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        {preview ? (
          <Box
            component="img"
            src={preview}
            alt=""
            sx={{
              width: 96,
              height: 72,
              objectFit: 'cover',
              borderRadius: 1,
              border: 1,
              borderColor: 'divider',
              bgcolor: 'action.hover',
            }}
          />
        ) : (
          <Stack
            sx={{
              width: 96,
              height: 72,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 1,
              border: 1,
              borderStyle: 'dashed',
              borderColor: 'divider',
              color: 'text.secondary',
            }}
          >
            <MdiIcon path={mdiImageOutline.path} size={1} />
          </Stack>
        )}
        {pickMedia ? (
          <Button size="small" variant="outlined" disabled={disabled} onClick={choose}>
            {value ? 'Change photo' : 'Choose from media'}
          </Button>
        ) : null}
        {value ? (
          <Button size="small" color="error" disabled={disabled} onClick={() => onChange('')}>
            {'Remove'}
          </Button>
        ) : null}
      </Stack>
      {linkOpen ? (
        <TextField
          size="small"
          label="Photo link"
          placeholder="https://"
          disabled={disabled}
          // A picked photo is a reference, not a link: the field stays empty
          // for it rather than showing a value nobody should edit by hand.
          value={/^https:\/\//i.test(value) || !value ? value : ''}
          onChange={(event) => onChange(event.target.value.trim())}
          helperText="A photo hosted on another website, starting with https://"
        />
      ) : (
        <Link
          component="button"
          type="button"
          variant="caption"
          underline="hover"
          sx={{ alignSelf: 'flex-start' }}
          disabled={disabled}
          onClick={() => setLinkOpen(true)}
        >
          {'Use a link instead'}
        </Link>
      )}
    </Stack>
  )
}
DatasetImageFieldInput.displayName = 'DatasetImageFieldInput'

/** The Page field where no site is open: it names what is held and where to choose. */
function PageFieldWithoutSite(props: { label?: string; chosen: boolean }) {
  return (
    <Stack spacing={0.5}>
      <TextField size="small" label={props.label} value={props.chosen ? 'A page is chosen' : 'No page chosen'} disabled />
      <Typography variant="caption" color="text.secondary">
        {'Pages belong to a site. Open this dataset from that site’s Data page to choose one.'}
      </Typography>
    </Stack>
  )
}
PageFieldWithoutSite.displayName = 'PageFieldWithoutSite'

/**
 * A record's page: one of the site's pages, picked by name. Stored as the
 * page's link reference, so a Button or Link bound to it follows the page to
 * its current address.
 */
export function DatasetPageFieldInput(props: CustomFieldInputProps) {
  const { onChange, disabled, label } = props
  const { hostId } = useContext(DatasetRecordSiteContext)
  const firestore = useFirestore()
  const value = valueOf(props)
  const selected = datasetPageScreenId(value) ?? ''
  const { data: screenDocs, status } = useFirestoreCollection<any>(
    () =>
      hostId
        ? query(collection(firestore, 'hosts', hostId, 'screens'), limit(PAGE_LIST_LIMIT))
        : null,
    [firestore, hostId],
    { idField: '$id' },
  )
  const pages = useMemo(
    () =>
      [...(screenDocs ?? [])]
        // Pages a visitor can open: not an email design, not a page group.
        .filter((screen: any) => !screen.deletedAt && screen.kind !== SCREEN_KIND_EMAIL && !isScreenGroup(screen))
        .map((screen: any) => ({
          id: String(screen.$id),
          name: String(screen.displayName ?? screen.name ?? screen.$id),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [screenDocs],
  )
  const known = !selected || pages.some((page) => page.id === selected)

  if (!hostId) return <PageFieldWithoutSite label={label} chosen={Boolean(selected)} />

  return (
    <TextField
      size="small"
      select
      label={label}
      disabled={disabled}
      value={selected}
      onChange={(event) => onChange(event.target.value ? datasetPageValue(event.target.value) : '')}
      helperText={status === 'loading' && !screenDocs ? 'Loading pages…' : undefined}
    >
      <MenuItem value="">{'No page'}</MenuItem>
      {pages.map((page) => (
        <MenuItem key={page.id} value={page.id}>
          {page.name}
        </MenuItem>
      ))}
      {/* A page that was deleted, or is not in this site, is named rather than shown as empty. */}
      {known ? null : (
        <MenuItem value={selected} disabled>
          {'⚠ A page this site no longer has'}
        </MenuItem>
      )}
    </TextField>
  )
}
DatasetPageFieldInput.displayName = 'DatasetPageFieldInput'
