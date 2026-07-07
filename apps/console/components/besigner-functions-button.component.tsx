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

import { mdiFunctionVariant } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  Tooltip,
} from '@mui/material'
import { useState } from 'react'
import HostFunctionsCard from './host-functions-card.component'
import HostVariablesCard from './host-variables-card.component'

export interface BesignerFunctionsButtonProps {
  hostId: string
}

/**
 * Functions/variables without leaving the besigner (AGL-100): an ƒx app-bar
 * action opening the same builder cards the dashboard uses, so bindings and
 * function widgets can be authored mid-design.
 */
export function BesignerFunctionsButton(props: BesignerFunctionsButtonProps) {
  const { hostId } = props
  const [open, setOpen] = useState(false)
  return (
    <>
      <Tooltip title="Variables & functions">
        <Button
          color="inherit"
          size="small"
          onClick={() => setOpen(true)}
          sx={{ minWidth: 'unset', px: 1 }}
          aria-label="variables and functions"
        >
          <MdiIcon path={mdiFunctionVariant.path} fontSize="small" />
        </Button>
      </Tooltip>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <HostVariablesCard hostId={hostId} />
          <HostFunctionsCard hostId={hostId} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{'Close'}</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
BesignerFunctionsButton.displayName = 'BesignerFunctionsButton'

export default BesignerFunctionsButton
