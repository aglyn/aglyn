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

import type { CustomFieldInputProps } from '@aglyn/aglyn/plugin-manager/custom-fields'
import { mdiShapePlus } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material'
import { lazy, Suspense, useState } from 'react'
import { datasetIconLabel, readDatasetIconValue } from '../model/dataset-icon-field'

/**
 * The library picker, loaded when the person opens it: the icon catalog
 * behind it is large, and most record edits never touch an icon.
 */
const DatasetIconPicker = lazy(() => import('./dataset-icon-picker.component'))

/** A record's icon as the records table and the editor draw it: the icon, then its name. */
export function DatasetIconPreview({ value }: { value: unknown }) {
  const icon = readDatasetIconValue(value)
  if (!icon) return null
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0, height: '100%' }}>
      {icon.iconPath ? <MdiIcon path={icon.iconPath} size={0.9} /> : null}
      <Typography variant="body2" noWrap>
        {datasetIconLabel(icon.iconId)}
      </Typography>
    </Stack>
  )
}

/**
 * A record's icon (AGL-4190): chosen from the same icon library the Besigner's
 * Icon element offers, never typed. The pick is stored with its SVG path, so
 * the published page that shows it never needs the library.
 *
 * The value travels in the record editor's input form, a JSON string, which
 * the editor's coercion turns back into the stored map.
 */
export function DatasetIconFieldInput(props: CustomFieldInputProps) {
  const { value, onChange, disabled, label } = props
  const icon = readDatasetIconValue(value)
  const [open, setOpen] = useState(false)

  return (
    <Stack spacing={1}>
      {label ? (
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
      ) : null}
      <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Stack
          sx={{
            width: 48,
            height: 48,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 1,
            border: 1,
            borderStyle: icon ? 'solid' : 'dashed',
            borderColor: 'divider',
            color: icon ? 'text.primary' : 'text.secondary',
          }}
        >
          <MdiIcon path={icon?.iconPath || mdiShapePlus.path} size={1} />
        </Stack>
        {icon ? (
          <Typography variant="body2">{datasetIconLabel(icon.iconId)}</Typography>
        ) : null}
        <Button size="small" variant="outlined" disabled={disabled} onClick={() => setOpen((was) => !was)}>
          {open ? 'Close library' : icon ? 'Change icon' : 'Choose icon'}
        </Button>
        {icon ? (
          <Button size="small" color="error" disabled={disabled} onClick={() => onChange('')}>
            {'Remove'}
          </Button>
        ) : null}
      </Stack>
      {open ? (
        <Suspense
          fallback={
            <Box sx={{ py: 2, display: 'flex', justifyContent: 'center' }}>
              <CircularProgress size={24} aria-label="Loading the icon library" />
            </Box>
          }
        >
          <DatasetIconPicker
            iconId={icon?.iconId ?? ''}
            disabled={disabled}
            onPick={(picked) => {
              onChange(picked ? JSON.stringify(picked) : '')
              setOpen(false)
            }}
          />
        </Suspense>
      ) : null}
    </Stack>
  )
}
