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

import { mdiShoppingOutline } from '@aglyn/shared-data-mdi'
import Box from '@mui/material/Box'
import SvgIcon from '@mui/material/SvgIcon'
import Typography from '@mui/material/Typography'
import type { SxProps, Theme } from '@mui/material/styles'

export interface ProductImagePlaceholderProps {
  /** The product's name; its first letter is drawn under the bag. */
  name: string
  sx?: SxProps<Theme>
}

/**
 * The tile a product card shows where the product has no photo yet.
 *
 * A blank box read as a broken image on a live store (AGL-3676 follow-up:
 * "You may also like" showed an empty tile). This one says what it is — a
 * product, by its initial — in the theme's own quiet colours, so it sits in
 * any palette, light or dark, without a hardcoded colour.
 */
export function ProductImagePlaceholder({ name, sx }: ProductImagePlaceholderProps) {
  const initial = (name.trim()[0] ?? '').toUpperCase()
  return (
    <Box
      role="img"
      aria-label={`${name} — no photo yet`}
      data-testid="product-image-placeholder"
      sx={[
        {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 0.5,
          bgcolor: 'action.hover',
          color: 'text.disabled',
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <SvgIcon sx={{ fontSize: 36 }}>
        <path d={mdiShoppingOutline.path} />
      </SvgIcon>
      {initial ? (
        <Typography variant="h6" component="span" aria-hidden sx={{ color: 'text.secondary', lineHeight: 1 }}>
          {initial}
        </Typography>
      ) : null}
    </Box>
  )
}
