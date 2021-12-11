/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import { styled, withStyles } from '@aglyn/shared-feature-themes'
import MuiDialog, { DialogProps as MuiDialogProps } from '@mui/material/Dialog'
import MuiDialogActions, {
  DialogActionsProps as MuiDialogActionsProps,
} from '@mui/material/DialogActions'
import MuiDialogContent from '@mui/material/DialogContent'
import MuiDialogTitle, { DialogTitleProps as MuiDialogTitleProps } from '@mui/material/DialogTitle'
import { forwardRef } from 'react'

const Dialog = styled(MuiDialog, {
  name: 'PopupDialog'
})(({theme}) => ({
  width: '100%',
  maxWidth: 360,
  backgroundColor: theme.palette.background.paper,
  ['& > .MuiPaper']: {
    width: '80%',
    maxHeight: 435,
  }
}))

export interface PopupDialogProps extends MuiDialogProps {
  dividers?: boolean
  header?: MuiDialogTitleProps
  actions?: MuiDialogActionsProps
  disableDialogContent?: boolean
}

const PopupDialog = forwardRef<any, PopupDialogProps>(
  function RefRenderFn(props, ref) {
    const {
      children,
      header,
      actions,
      dividers,
      disableDialogContent,
      ...rest
    } = props

    return (
      <Dialog ref={ref} aria-labelledby="popup-dialog-title" maxWidth="xs" {...rest}>
        {header && <MuiDialogTitle id="popup-dialog-title" {...header} />}
        {disableDialogContent ? children : (
          <MuiDialogContent dividers={dividers}>
            {children}
          </MuiDialogContent>
        )}
        {actions && <MuiDialogActions {...actions} />}
      </Dialog>
    )
  }
)

PopupDialog.displayName = 'PopupDialog'

export default PopupDialog
