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

import type { Measurement } from '@aglyn/shared-data-enums'
import { classKeys } from '../constants'
import type { Measurements, PaddingMeasurements } from '../types'
import Box from './box'
import DimensionControl from './dimension-control'

interface PaddingStylerProps extends PaddingMeasurements {
  onChange: (key: keyof Measurements) => (dimension: Measurement) => void
  children?: JSX.Children
}

export const PaddingStyler = (props: PaddingStylerProps) => {
  const {
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft,
    onChange,
    children,
  } = props

  return (
    <Box className={classKeys.padding}>
      <div className={classKeys.label}>{'Padding'}</div>
      <DimensionControl
        dimension={paddingTop}
        onChange={onChange('paddingTop')}
      />
      <Box className={classKeys.row}>
        <DimensionControl
          dimension={paddingLeft}
          onChange={onChange('paddingLeft')}
        />

        {children}

        <DimensionControl
          dimension={paddingRight}
          onChange={onChange('paddingRight')}
        />
      </Box>
      <DimensionControl
        dimension={paddingBottom}
        onChange={onChange('paddingBottom')}
      />
    </Box>
  )
}

export default PaddingStyler
