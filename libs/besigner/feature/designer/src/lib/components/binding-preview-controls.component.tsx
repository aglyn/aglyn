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

import { mdiCodeBraces } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  IconButton as MuiIconButton,
  type IconButtonProps as MuiIconButtonProps,
  Tooltip as MuiTooltip,
} from '@mui/material'
import { forwardRef, useCallback, useContext } from 'react'
import BindingPickerContext from '../contexts/binding-picker-context'
import useAglynBesignerFlag from '../hooks/use-aglyn-besigner-flag'

export interface BindingPreviewControlsProps
  extends Partial<MuiIconButtonProps> {}

/**
 * WYSIWYG bindings toggle (AGL-97): the canvas resolves variable and
 * function binding tokens live by default; this switches to raw tokens
 * for editing clarity. Hidden when the host app provides no
 * variables/functions to resolve with.
 */
const BindingPreviewControlsComponent = forwardRef<
  any,
  BindingPreviewControlsProps
>((props, ref) => {
  const { ...rest } = props
  const [resolveFlag, setResolveFlag] =
    useAglynBesignerFlag('resolveBindings')
  const { variables, functions } = useContext(BindingPickerContext)
  const showingRaw = resolveFlag === false

  const handleToggle = useCallback(() => {
    setResolveFlag((prev) => prev === false)
  }, [setResolveFlag])

  if (
    !Object.keys(variables ?? {}).length &&
    !Object.keys(functions ?? {}).length
  ) {
    return null
  }

  return (
    <MuiTooltip
      title={
        showingRaw
          ? 'Show resolved binding values on the artboard'
          : 'Show raw binding tokens on the artboard'
      }
    >
      <MuiIconButton
        ref={ref}
        aria-label="toggle binding resolution"
        size="small"
        color={showingRaw ? 'secondary' : 'inherit'}
        onClick={handleToggle}
        {...rest}
      >
        <MdiIcon fontSize="inherit" path={mdiCodeBraces.path} />
      </MuiIconButton>
    </MuiTooltip>
  )
})
BindingPreviewControlsComponent.displayName = 'BindingPreviewControlsComponent'
BindingPreviewControlsComponent.aglyn = true

export { BindingPreviewControlsComponent }
export default BindingPreviewControlsComponent
