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
import { HelpTip, MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Tooltip,
} from '@mui/material'
import { useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import PluginWidgetSlot from './plugin-widget-slot.component'
import useCurrentOrg from '../hooks/use-current-org'

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
  const { org } = useCurrentOrg()
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
        <DialogTitle
          sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
        >
          {'Variables & functions'}
          <HelpTip
            {...docsHelp('bindings', {
              anchor: '#no-code-functions',
              excerpt:
                'Define typed variables and no-code functions, then bind them into content anywhere on the canvas.',
            })}
            sx={{ fontSize: '0.7em' }}
          />
        </DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <PluginWidgetSlot
            slot="besignerFunctions"
            hostId={hostId}
            org={org}
          />
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
