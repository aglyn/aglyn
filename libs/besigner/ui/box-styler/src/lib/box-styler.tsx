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
import '@aglyn/shared-data-jsx'
import { Box as MuiBox, ButtonBase } from '@mui/material'
import { forwardRef, useCallback } from 'react'
import Box, { type BoxProps } from './components/box'
import Contents from './components/contents'
import Legend, { LegendItem } from './components/legend'
import MarginStyler from './components/margin-styler'
import PaddingStyler from './components/padding-styler'
import type { Measurements } from './types'

export { Measurements }

const BTN_SIZE = 20
const HEIGHT = 200

export interface BoxStylerProps extends Omit<BoxProps, 'onChange'> {
  measurements?: Measurements
  width?: Measurement
  height?: Measurement
  onChange?: (measurements?: Measurements) => void
}

export const BoxStyler = forwardRef<any, BoxStylerProps>((props, ref) => {
  const { measurements, width, height, onChange, ...rest } = props

  const handleChange = useCallback(
    (key: keyof Measurements) => (dimension: Measurement) => {
      const res = { ...measurements, [key]: dimension }
      onChange && onChange(res)
    },
    [onChange, measurements],
  )

  return (
    <>
      <MuiBox
        width={1}
        height={HEIGHT}
        sx={{
          bgcolor: 'background.default',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          textAlign: 'center',
        }}
      >
        <ButtonBase
          sx={{
            textAlign: 'center',
            width: 1,
            height: `${BTN_SIZE}%`,
            clipPath: `polygon(0% 0%, 100% 0%, ${
              100 - BTN_SIZE
            }% 100%, ${BTN_SIZE}% 100%)`,
            bgcolor: 'secondary.light',
            cursor: 'pointer',
            overflow: 'hidden',
            backfaceVisibility: 'hidden',
          }}
        >
          mt
        </ButtonBase>
        <ButtonBase
          sx={{
            height: 1,
            width: `${BTN_SIZE}%`,
            textAlign: 'center',
            clipPath: `polygon(0% 0%, 100% ${BTN_SIZE}%, 100% ${
              100 - BTN_SIZE
            }%, 0% 100%)`,
            bgcolor: 'secondary.dark',
            position: 'absolute',
            cursor: 'pointer',
            top: 0,
            left: 0,
            overflow: 'hidden',
            backfaceVisibility: 'hidden',
          }}
        >
          ml
        </ButtonBase>

        <MuiBox
          width={`calc(100% - ${BTN_SIZE * 2}%)`}
          height={`calc(100% - ${BTN_SIZE * 2}%)`}
          sx={{
            // bgcolor: 'background.default',
            display: 'flex',
            flexDirection: 'column',
            margin: '0 auto',
            position: 'relative',
            textAlign: 'center',
            overflow: 'hidden',
          }}
        >
          <ButtonBase
            sx={{
              textAlign: 'center',
              width: 1,
              height: `calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334))`,
              clipPath: `polygon(0% 0%, 100% 0%, calc(${BTN_SIZE * 2}% + (${
                100 - BTN_SIZE
              }% * 0.3333334)) 100%, calc(${BTN_SIZE}% + (${
                BTN_SIZE * 2
              }% * 0.3333334)) 100%)`,
              bgcolor: 'secondary.main',
              cursor: 'pointer',
              overflow: 'hidden',
              backfaceVisibility: 'hidden',
            }}
          >
            pt
          </ButtonBase>
          <ButtonBase
            sx={{
              height: 1,
              width: `calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334))`,
              textAlign: 'center',
              clipPath: `polygon(0% 0%, 100% calc(${BTN_SIZE}% + (${
                BTN_SIZE * 2
              }% * 0.3333334)), 100% calc(${BTN_SIZE * 2}% + (${
                100 - BTN_SIZE
              }% * 0.3333334)), 0% 100%)`,
              bgcolor: 'secondary.dark',
              position: 'absolute',
              cursor: 'pointer',
              top: 0,
              left: 0,
              overflow: 'hidden',
              backfaceVisibility: 'hidden',
              // --sizes: calc(${BTN_SIZE*2}% * (${BTN_SIZE} * 100) / (100 - ${BTN_SIZE*2})/100);
              // --ssss: calc(${BTN_SIZE}% + (${BTN_SIZE*2}% * 0.3333333));
            }}
          >
            pl
          </ButtonBase>

          <MuiBox
            width={`calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334))`}
            height={`calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334))`}
            sx={{
              // bgcolor: 'background.default',
              display: 'flex',
              flexDirection: 'column',
              margin: '0 auto',
              position: 'relative',
              textAlign: 'center',
            }}
          >
            <MuiBox>Contents</MuiBox>
          </MuiBox>

          <ButtonBase
            sx={{
              height: 1,
              width: `calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334))`,
              textAlign: 'center',
              clipPath: `polygon(0% calc(${BTN_SIZE}% + (${
                BTN_SIZE * 2
              }% * 0.3333334)), 100% 0%, 100% 100%, 0% calc(${
                BTN_SIZE * 2
              }% + (${100 - BTN_SIZE}% * 0.3333334)))`,
              bgcolor: 'secondary.dark',
              position: 'absolute',
              cursor: 'pointer',
              top: 0,
              right: 0,
              overflow: 'hidden',
              backfaceVisibility: 'hidden',
            }}
          >
            pr
          </ButtonBase>
          <ButtonBase
            sx={{
              width: 1,
              height: `calc(${BTN_SIZE}% + (${BTN_SIZE * 2}% * 0.3333334))`,
              textAlign: 'center',
              clipPath: `polygon(calc(${BTN_SIZE}% + (${
                BTN_SIZE * 2
              }% * 0.3333334)) 0%, calc(${BTN_SIZE * 2}% + (${
                100 - BTN_SIZE
              }% * 0.3333334)) 0%, 100% 100%, 0% 100%)`,
              bgcolor: 'secondary.light',
              cursor: 'pointer',
              overflow: 'hidden',
              backfaceVisibility: 'hidden',
            }}
          >
            pb
          </ButtonBase>
        </MuiBox>
        <ButtonBase
          sx={{
            height: 1,
            width: `${BTN_SIZE}%`,
            textAlign: 'center',
            clipPath: `polygon(0% ${BTN_SIZE}%, 100% 0%, 100% 100%, 0% ${
              100 - BTN_SIZE
            }%)`,
            bgcolor: 'secondary.dark',
            position: 'absolute',
            cursor: 'pointer',
            top: 0,
            right: 0,
            overflow: 'hidden',
            backfaceVisibility: 'hidden',
          }}
        >
          mr
        </ButtonBase>
        <ButtonBase
          sx={{
            width: 1,
            height: `${BTN_SIZE}%`,
            textAlign: 'center',
            clipPath: `polygon(${BTN_SIZE}% 0%, ${
              100 - BTN_SIZE
            }% 0%, 100% 100%, 0% 100%)`,
            bgcolor: 'secondary.main',
            cursor: 'pointer',
            overflow: 'hidden',
            backfaceVisibility: 'hidden',
          }}
        >
          mb
        </ButtonBase>
      </MuiBox>

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
          alignItems="center"
          justifyContent="space-around"
          spacing={1}
          marginTop={1}
          marginBottom={2}
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
