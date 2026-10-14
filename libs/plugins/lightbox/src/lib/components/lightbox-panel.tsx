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

/**
 * The open Lightbox (AGL-3717): the shared lightbox shell with the author's
 * elements in it.
 *
 * Reached from `lightbox.tsx` only through `lazy(() => import())`, the first
 * time the element is opened, because the shell names MUI's Dialog and a page
 * that places a Lightbox nobody opens should not pay for it (AGL-1290).
 */
'use client'

import type { LightboxAppearance } from '@aglyn/shared-ui-jsx/components/lightbox/lightbox-appearance'
import { LightboxDialog } from '@aglyn/shared-ui-jsx/components/lightbox/lightbox-dialog'
import Box from '@mui/material/Box'
import type { SxProps, Theme } from '@mui/material/styles'
import type { ReactNode } from 'react'

export interface LightboxPanelProps {
  open: boolean
  onClose: () => void
  label: string
  appearance?: LightboxAppearance
  /** The author's node styles, which belong on the panel body. */
  sx?: SxProps<Theme>
  children?: ReactNode
}

export function LightboxPanel(props: LightboxPanelProps) {
  const { open, onClose, label, appearance, sx, children } = props
  const nodeSx = Array.isArray(sx) ? sx : sx ? [sx] : []
  return (
    <LightboxDialog
      open={open}
      onClose={onClose}
      label={label}
      closeLabel={`Close ${label}`}
      appearance={appearance}
      maxWidth="sm"
      fullWidth
    >
      <Box
        sx={[
          {
            // Room under the close control, so the first line of the author's
            // content never sits beneath it.
            p: appearance?.padding ? 0 : 3,
            pt: appearance?.padding ? 0 : 5,
            overflowY: 'auto',
          },
          ...nodeSx,
        ]}
      >
        {children}
      </Box>
    </LightboxDialog>
  )
}
LightboxPanel.displayName = 'LightboxPanel'

export default LightboxPanel
