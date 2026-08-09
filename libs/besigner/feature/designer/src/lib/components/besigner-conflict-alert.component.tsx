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

import { Alert, Button } from '@mui/material'

export interface BesignerConflictAlertProps {
  /** 'screen', 'layout', 'component', 'template', 'email'. */
  noun: string
}

/**
 * The concurrent-save conflict banner (AGL-1301): someone else saved this
 * document while the author was editing, so saving is paused until they
 * reload. Shown as soon as the remote save lands, not on Save — finding
 * out after twenty more minutes of editing is the bad version of this
 * (AGL-674).
 *
 * One component for every besigner editor so the copy names the document
 * kind the author is actually in — the AGL-1301 adoption copy-pasted the
 * banner per page and two editors kept another page's noun. The single
 * action is Reload, deliberately: there is no "save anyway" that could
 * silently destroy a teammate's work, and the canvas keeps everything
 * until the reload.
 */
export function BesignerConflictAlertComponent(
  props: BesignerConflictAlertProps,
) {
  const { noun } = props
  return (
    <Alert
      severity="warning"
      sx={{ borderRadius: 0, position: 'relative', zIndex: 'appBar' }}
      action={
        <Button
          color="inherit"
          size="small"
          onClick={() => window.location.reload()}
        >
          {'Reload'}
        </Button>
      }
    >
      {`Someone else saved this ${noun} while you were editing. ` +
        'Saving is paused so their work is not overwritten — ' +
        'reload to pick up their changes. Nothing you have done ' +
        'here is lost until you do.'}
    </Alert>
  )
}

export default BesignerConflictAlertComponent
