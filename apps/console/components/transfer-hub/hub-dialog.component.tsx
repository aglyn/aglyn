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

import { ICON_VARIANT_CLOSE } from '@aglyn/shared-data-enums'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { Dialog, DialogContent, DialogTitle, IconButton, Stack, Typography, useMediaQuery, useTheme } from '@mui/material'
import type { ReactNode } from 'react'

/** A hub dialog: titled, closable, full screen on a phone. */
export function HubDialog(props: { title: string; id: string; onClose(): void; children: ReactNode }) {
  const theme = useTheme()
  const narrow = useMediaQuery(theme.breakpoints.down('sm'))
  return (
    <Dialog open onClose={props.onClose} fullWidth maxWidth="lg" fullScreen={narrow} aria-labelledby={props.id}>
      <DialogTitle id={props.id}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6" component="span">
            {props.title}
          </Typography>
          <IconButton aria-label="Close" onClick={props.onClose} edge="end">
            <MdiIcon path={ICON_VARIANT_CLOSE.path} />
          </IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>{props.children}</DialogContent>
    </Dialog>
  )
}

/** Saves a file the browser holds. */
export function saveBlob(body: Blob, fileName: string): void {
  const url = URL.createObjectURL(body)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

/** A thrown error as a sentence. */
export function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Something went wrong. Try again.'
}
