/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import type { IconId } from '@aglyn/shared-data-mdi'
import { _isStrT } from '@aglyn/shared-util-guards'
import { forwardRef } from 'react'
import { useMdiIcon } from '../hooks/use-mdi-icon'
import MdiIcon, { type MdiIconProps } from './mdi-icon'

export interface MdiSvgIconProps extends MdiIconProps {
  iconId?: IconId
}

const MdiSvgIcon = forwardRef<any, MdiSvgIconProps>((props, ref) => {
  const { iconId, ...rest } = props
  const icon = useMdiIcon(_isStrT(iconId) ? iconId : null)

  return <MdiIcon ref={ref} path={icon?.path} {...rest} />
})

MdiSvgIcon.displayName = 'MdiSvgIcon'
MdiSvgIcon.aglyn = true

export { MdiSvgIcon }
export default MdiSvgIcon
