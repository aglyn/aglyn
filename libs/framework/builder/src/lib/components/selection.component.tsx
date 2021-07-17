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

import { createStyles, Theme, WithStyles, withStyles } from '@material-ui/core/styles'
import clsx from 'clsx'
import { forwardRef, HTMLAttributes } from 'react'
import Button, { ButtonProps } from '@material-ui/core/Button'
import Dialog, { DialogProps } from '@material-ui/core/Dialog'
import DialogContentText, { DialogContentTextProps } from '@material-ui/core/DialogContentText'
import DialogTitle, { DialogTitleProps } from '@material-ui/core/DialogTitle'

export interface SelectionComponentOptions {
  cancellationText?: ButtonProps['children']
  confirmationText?: ButtonProps['children']
  cancellationButtonProps?: Partial<ButtonProps>
  confirmationButtonProps?: Partial<ButtonProps>
  dialogProps?: Partial<DialogProps>
  title?: DialogTitleProps['children']
  description?: DialogContentTextProps['children']
  clientRect?: DOMRect
}

export interface SelectionComponentProps extends HTMLAttributes<HTMLDivElement> {
  options?: SelectionComponentOptions
  open?: boolean
  onConfirm?: ButtonProps['onClick']
  onCancel?: ButtonProps['onClick']
  onClose?: ButtonProps['onClick']
}

export const styles = (theme: Theme) =>
  createStyles({
    root: {
      outlineWidth: 2,
      outlineOffset: -2,
      outlineColor: theme.palette.secondary.main,
      outlineStyle: 'solid',
      pointerEvents: 'none',
      position: 'absolute',
    },
  })

const SelectionComponent = forwardRef<any, SelectionComponentProps & WithStyles<typeof styles>>(
  function RefRenderFn(props, ref) {
    const { open, options, onCancel, onConfirm, onClose, classes, className, ...rest } = props
    const { title, clientRect } = options
    return (
      open && (
        <div
          ref={ref}
          {...rest}
          className={clsx(classes.root, className)}
          style={{
            ...clientRect,
          }}
        ></div>
      )
    )
  }
)

SelectionComponent.displayName = 'SelectionComponent'
SelectionComponent.defaultProps = {
  options: {
    title: 'My Title',
  },
}

export default withStyles(styles, { name: 'SelectionComponent' })(SelectionComponent)
