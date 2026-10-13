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

import { IconButton, Tooltip, Typography } from '@mui/material'
import { lazy, Suspense, useState } from 'react'
import type { FormulaName } from '../model/formula-names'

// The dialog is its own chunk: a function editor that never presses ƒx
// never downloads it.
const FormulaBuilderDialog = lazy(() => import('./formula-builder-dialog.component'))

export interface FormulaBuilderButtonProps {
  /** What the box holds now; offered as a value so formulas can be layered. */
  current: string
  /** Parameters, local variables and site variables, grouped. */
  names: readonly FormulaName[]
  /** Receives the expression the builder wrote. */
  onUse: (expression: string) => void
  /** Called as the dialog opens — where a caller loads names it reads lazily. */
  onOpen?: () => void
}

/** The ƒx "Build formula" button beside an expression box (AGL-3757). */
export function FormulaBuilderButton(props: FormulaBuilderButtonProps) {
  const { current, names, onUse, onOpen } = props
  const [open, setOpen] = useState(false)
  return (
    <>
      <Tooltip title="Build formula">
        <IconButton
          size="small"
          aria-label="Build formula"
          onClick={() => {
            onOpen?.()
            setOpen(true)
          }}
        >
          <Typography
            component="span"
            sx={{ fontStyle: 'italic', fontWeight: 600, lineHeight: 1 }}
          >
            {'ƒx'}
          </Typography>
        </IconButton>
      </Tooltip>
      {open ? (
        <Suspense fallback={null}>
          <FormulaBuilderDialog
            current={current}
            names={names}
            onUse={onUse}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      ) : null}
    </>
  )
}

export default FormulaBuilderButton
