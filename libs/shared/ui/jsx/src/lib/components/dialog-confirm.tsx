/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import Button, { ButtonProps } from '@mui/material/Button'
import Dialog, { DialogProps } from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText, {
  DialogContentTextProps,
} from '@mui/material/DialogContentText'
import DialogTitle, { DialogTitleProps } from '@mui/material/DialogTitle'
import { forwardRef, useEffect, useState } from 'react'

export interface DialogConfirmOptions {
  cancellationText?: ButtonProps['children']
  confirmationText?: ButtonProps['children']
  cancellationButtonProps?: Partial<ButtonProps>
  confirmationButtonProps?: Partial<ButtonProps>
  dialogProps?: Partial<DialogProps>
  title?: DialogTitleProps['children']
  description?: DialogContentTextProps['children']
  /** The confirm button is held until this settles (see `ConfirmationContextConfig`). */
  confirmationHeldUntil?: PromiseLike<unknown>
}

/**
 * Whether `work` is still running. Settled work is remembered by identity, so
 * a dialog opened with new work is held from its first frame, never enabled
 * for one frame and then switched off.
 */
export function useHeldUntil(work: PromiseLike<unknown> | undefined): boolean {
  const [settled, setSettled] = useState<PromiseLike<unknown> | undefined>()
  useEffect(() => {
    if (!work) return
    let live = true
    const done = () => {
      if (live) setSettled(() => work)
    }
    work.then(done, done)
    return () => {
      live = false
    }
  }, [work])
  return Boolean(work) && settled !== work
}

export interface DialogConfirmProps extends DialogProps {
  options?: DialogConfirmOptions
  onConfirm?: ButtonProps['onClick']
  onCancel?: ButtonProps['onClick']
}

export const DialogConfirm = forwardRef<any, DialogConfirmProps>(
  (props, ref) => {
    const {
      open,
      options = {
        cancellationText: 'Cancel',
        confirmationText: 'OK',
      },
      onCancel,
      onConfirm,
      onClose,
      ...rest
    } = props
    const {
      title,
      description,
      confirmationText,
      cancellationText,
      dialogProps,
      confirmationButtonProps,
      cancellationButtonProps,
      confirmationHeldUntil,
    } = options
    const held = useHeldUntil(confirmationHeldUntil)
    return (
      <Dialog
        ref={ref}
        fullWidth
        {...rest}
        {...dialogProps}
        open={open}
        onClose={onClose}
      >
        {title && <DialogTitle>{title}</DialogTitle>}
        {description && (
          <DialogContent>
            <DialogContentText>{description}</DialogContentText>
          </DialogContent>
        )}
        {/* Once answered the dialog fades out with its buttons still drawn;
            they are disabled for that moment so they don't look live. */}
        <DialogActions>
          <Button
            {...cancellationButtonProps}
            disabled={!open || cancellationButtonProps?.disabled}
            onClick={onCancel}
          >
            {cancellationText}
          </Button>
          <Button
            color="primary"
            {...confirmationButtonProps}
            disabled={!open || held || confirmationButtonProps?.disabled}
            onClick={onConfirm}
          >
            {confirmationText}
          </Button>
        </DialogActions>
      </Dialog>
    )
  },
)

DialogConfirm.displayName = 'DialogConfirm'
DialogConfirm.aglyn = true

export default DialogConfirm
