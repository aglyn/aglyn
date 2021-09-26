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

import { styled } from '@aglyn/shared-feature-themes'
import { ButtonProps } from '@mui/material/Button'
import { DialogProps } from '@mui/material/Dialog'
import { DialogContentTextProps } from '@mui/material/DialogContentText'
import { DialogTitleProps } from '@mui/material/DialogTitle'
import { forwardRef, Fragment, HTMLAttributes } from 'react'

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

const SelectionRoot = styled('div', {
  name: 'SelectionComponent',
})(({ theme }) => ({
  outlineWidth: 2,
  outlineOffset: -2,
  outlineColor: theme.palette.secondary.main,
  outlineStyle: 'solid',
  pointerEvents: 'none',
  position: 'absolute',
}))

export const SelectionComponent = forwardRef<any, SelectionComponentProps>(function RefRenderFn(
  props,
  ref
) {
  const { open, options, onCancel, onConfirm, onClose, children, ...rest } = props
  const { title, clientRect } = options
  console.log('selection client rect', { ...clientRect })
  return (
    <Fragment>
      {open ? (
        <SelectionRoot ref={ref} {...rest} style={{ ...clientRect }}>
          {children}
        </SelectionRoot>
      ) : null}
    </Fragment>
  )
})

SelectionComponent.displayName = 'SelectionComponent'
SelectionComponent.defaultProps = {
  options: {
    title: 'My Title',
  },
}

export default SelectionComponent
