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

import { IconButton, InputAdornment, SvgIcon } from '@mui/material'
import { mdiBarcodeScan } from '@aglyn/shared-data-mdi'
import { useCallback, useState } from 'react'
import { BarcodeScanner } from './barcode-scanner.component'

/**
 * The camera scan button that sits at the end of a search or barcode field
 * (AGL-3619): it opens the camera scanner and hands back the code, the way a
 * keyboard-mode scanner would have typed it.
 */
export function ScanAdornment(props: { label: string; onScan: (code: string) => void }) {
  const { label, onScan } = props
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const detected = useCallback(
    (code: string) => {
      setOpen(false)
      onScan(code)
    },
    [onScan],
  )
  return (
    <InputAdornment position="end">
      <IconButton size="small" edge="end" aria-label={label} onClick={() => setOpen(true)}>
        <SvgIcon fontSize="small">
          <path d={mdiBarcodeScan.path} />
        </SvgIcon>
      </IconButton>
      {open ? <BarcodeScanner open title={label} onClose={close} onDetected={detected} /> : null}
    </InputAdornment>
  )
}

export default ScanAdornment
