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

import { forwardRef } from 'react'
import Button, { ButtonProps } from '@material-ui/core/Button'
import Dialog, { DialogProps } from '@material-ui/core/Dialog'
import DialogActions from '@material-ui/core/DialogActions'
import DialogContent from '@material-ui/core/DialogContent'
import DialogContentText, { DialogContentTextProps } from '@material-ui/core/DialogContentText'
import DialogTitle, { DialogTitleProps } from '@material-ui/core/DialogTitle'


export interface DialogConfirmOptions {
  cancellationText?: ButtonProps['children']
  confirmationText?: ButtonProps['children']
  cancellationButtonProps?: Partial<ButtonProps>
  confirmationButtonProps?: Partial<ButtonProps>
  dialogProps?: Partial<DialogProps>
  title?: DialogTitleProps['children']
  description?: DialogContentTextProps['children']
}

export interface DialogConfirmProps extends DialogProps {
  options?: DialogConfirmOptions
  onConfirm?: ButtonProps['onClick']
  onCancel?: ButtonProps['onClick']
}

export const DialogConfirm = forwardRef<any, DialogConfirmProps>(
  function RefRenderFn(props, ref) {
    const { open, options, onCancel, onConfirm, onClose, ...rest } = props
    const {
      title,
      description,
      confirmationText,
      cancellationText,
      dialogProps,
      confirmationButtonProps,
      cancellationButtonProps,
    } = options
    return (
      <Dialog
        ref={ref}
        fullWidth
        {...rest}
        {...dialogProps}
        open={open}
        onClose={onClose}
      >
        {title && (
          <DialogTitle>{title}</DialogTitle>
        )}
        {description && (
          <DialogContent>
            <DialogContentText>{description}</DialogContentText>
          </DialogContent>
        )}
        <DialogActions>
          <Button {...cancellationButtonProps} onClick={onCancel}>
            {cancellationText}
          </Button>
          <Button color="primary" {...confirmationButtonProps} onClick={onConfirm}>
            {confirmationText}
          </Button>
        </DialogActions>
      </Dialog>
    )
  },
)

DialogConfirm.displayName = 'DialogConfirm'
DialogConfirm.defaultProps = {
  options: {
    cancellationText: 'Cancel',
    confirmationText: 'OK',
  },
}

export default DialogConfirm
