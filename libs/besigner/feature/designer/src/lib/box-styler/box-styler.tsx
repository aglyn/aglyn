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

import type { Measurement } from '@aglyn/shared-data-enums'
import { forwardRef, useCallback } from 'react'
import Box, { type BoxProps } from './components/box'
import BoxButtonStyler from './components/box-button-styler'
import Contents from './components/contents'
import Legend, { LegendItem } from './components/legend'
import MarginStyler from './components/margin-styler'
import PaddingStyler from './components/padding-styler'
import type { Measurements } from './types'

export type { Measurements }

const BTN_SIZE = 20
const HEIGHT = 200

export interface BoxStylerProps extends Omit<BoxProps, 'onChange'> {
  measurements?: Measurements
  width?: Measurement
  height?: Measurement
  onChange?: (measurements?: Measurements) => void
}

export const BoxStyler = forwardRef<any, BoxStylerProps>((
  { measurements, width, height, onChange, ...rest }: BoxStylerProps,
  ref,
) => {

  const handleChange = useCallback(
    (key: keyof Measurements) => (dimension: Measurement) => {
      const res: Measurements = Object.assign({}, measurements, { [key]: dimension })
      onChange?.(res)
    },
    [onChange, measurements],
  )

  return (
    <>
      <BoxButtonStyler />
      <Box ref={ref} {...rest}>
        <MarginStyler
          onChange={handleChange}
          marginTop={measurements?.marginTop}
          marginRight={measurements?.marginRight}
          marginBottom={measurements?.marginBottom}
          marginLeft={measurements?.marginLeft}
        >
          <PaddingStyler
            onChange={handleChange}
            paddingTop={measurements?.paddingTop}
            paddingRight={measurements?.paddingRight}
            paddingBottom={measurements?.paddingBottom}
            paddingLeft={measurements?.paddingLeft}
          >
            <Contents />
          </PaddingStyler>
        </MarginStyler>

        <Legend
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', justifyContent: 'space-around', mt: 1, mb: 2 }}
        >
          <LegendItem item={'margin'} />
          <LegendItem item={'padding'} />
          <LegendItem item={'contents'} />
        </Legend>
      </Box>
    </>
  )
})
BoxStyler.displayName = 'BoxStyler'

export default BoxStyler
