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

import { Image } from '@aglyn/shared-ui-next'
import Box from '@mui/material/Box'
import { useEffect, useState } from 'react'
import type { ChangelogImage } from '../data/changelog'

/**
 * A changelog image that enlarges into a lightbox on click (AGL-614) — the
 * marketing-site counterpart to the docs' image zoom. Uses a plain fixed
 * overlay (not MUI Modal) to keep it dependency-light and robust.
 */
export function ChangelogFigure({ image }: { image: ChangelogImage }) {
  const [open, setOpen] = useState(false)

  // Close on Escape and lock body scroll while the lightbox is open.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  return (
    <>
      <Box
        component="button"
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Enlarge image: ${image.alt}`}
        sx={{
          display: 'block',
          width: '100%',
          my: 3,
          p: 0,
          border: (theme) => `1px solid ${theme.palette.divider}`,
          borderRadius: 1,
          overflow: 'hidden',
          background: 'none',
          cursor: 'zoom-in',
        }}
      >
        <Image
          src={image.src}
          alt={image.alt}
          width={image.width}
          height={image.height}
          placeholder="empty"
          style={{ width: '100%', height: 'auto', display: 'block' }}
        />
      </Box>

      {open ? (
        <Box
          role="dialog"
          aria-modal="true"
          aria-label={image.alt}
          onClick={() => setOpen(false)}
          sx={{
            position: 'fixed',
            inset: 0,
            zIndex: (theme) => theme.zIndex.modal,
            bgcolor: 'rgba(0, 0, 0, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            p: { xs: 2, md: 6 },
            cursor: 'zoom-out',
          }}
        >
          <Image
            src={image.src}
            alt={image.alt}
            width={image.width}
            height={image.height}
            placeholder="empty"
            style={{
              maxWidth: '100%',
              maxHeight: '90vh',
              width: 'auto',
              height: 'auto',
              display: 'block',
            }}
          />
        </Box>
      ) : null}
    </>
  )
}

export default ChangelogFigure
