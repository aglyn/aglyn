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
import { createSvgPathIcon } from '../components/svg-path-icon'
import SvgIcon, {SvgIconProps} from '@mui/material/SvgIcon'
import { generateComponentClassKeys, styled } from '@aglyn/shared-feature-themes'


export const AGLYN_SVG_LOGO = {
  path: 'M17.8,19H15.53l-2.82-6.11H5.17L2.37,19H0L8.64,0h.65Zm-6.06-8.29L9,4.54,6.17,10.71Zm21.75,5.1a13,13,0,0,1-.46,4,5.65,5.65,0,0,1-1.4,2.2,6.26,6.26,0,0,1-2.25,1.36,8.63,8.63,0,0,1-2.89.46c-3.54,0-5.91-1.5-7.09-4.49h2.2a5.09,5.09,0,0,0,4.82,2.6,6.2,6.2,0,0,0,2.77-.6,3.6,3.6,0,0,0,1.72-1.6,7.09,7.09,0,0,0,.5-3.07v-.13a6.4,6.4,0,0,1-2.34,1.67,7.23,7.23,0,0,1-2.85.58,6.66,6.66,0,0,1-4.93-2,6.5,6.5,0,0,1-2-4.77A6.49,6.49,0,0,1,21.4,7.08a6.91,6.91,0,0,1,5-2,6.62,6.62,0,0,1,5,2.35v-2h2.08Zm-2-3.82a4.74,4.74,0,0,0-1.44-3.55A4.82,4.82,0,0,0,26.55,7a5,5,0,0,0-3.69,1.51,4.86,4.86,0,0,0-1.48,3.51,4.52,4.52,0,0,0,1.42,3.38,5,5,0,0,0,3.65,1.39,5,5,0,0,0,3.63-1.36A4.63,4.63,0,0,0,31.49,12Zm7,7h-2V.27h2ZM53.29,5.39,45.22,23.82H43.08l2.62-6L40.18,5.39h2.15l4.47,10,4.32-10ZM67,19H65V12.51a14.49,14.49,0,0,0-.21-3.06,3.85,3.85,0,0,0-.63-1.37,2.51,2.51,0,0,0-1-.84A4,4,0,0,0,61.52,7a3.86,3.86,0,0,0-1.79.45,4.48,4.48,0,0,0-1.5,1.25,4.75,4.75,0,0,0-.86,1.69,18.05,18.05,0,0,0-.23,3.6v5H55.06V5.39h2.08V7.44A6.07,6.07,0,0,1,61.93,5a4.87,4.87,0,0,1,2.67.77A4.65,4.65,0,0,1,66.4,7.9,10.59,10.59,0,0,1,67,12Z',
  viewBox: '0 0 67 23.82',
}
export const AGLYN_SVG_APP_ICON = {
  path: 'M-79.288-327.3l-2.672-5.8h-5.463l-2.33,5.1H-90.6l-.158.346h-.838l-.162.354H-94l8.184-18h.615l.111.249.274-.6h.615l.113.253.272-.6h.615l8.066,18H-76.29l.155.346h-1.158l.158.354Zm-6.87-8.553h2.96l-1.473-3.279Z',
  viewBox: '-95 -346.998 33.2 20.7',
}
export const BESIGNER_SVG_LOGO = {
  path: 'M39.4,18q-4,0-5.4-3v-.4h2.2a3.6,3.6,0,0,0,3.3,1.6,3.8,3.8,0,0,0,1.9-.4,2.3,2.3,0,0,0,1.2-.9,2.5,2.5,0,0,0,.2-1v-.4l-.4.3-1,.5a7.8,7.8,0,0,1-2.2.3,5.7,5.7,0,0,1-3.8-1.3,4.3,4.3,0,0,1-1.5-3.3,4.4,4.4,0,0,1,1.6-3.3,5.7,5.7,0,0,1,7-.4l.3.2v-1h2v7a9.1,9.1,0,0,1-.3,2.7,8.3,8.3,0,0,1-1.1,1.5,5.1,5.1,0,0,1-1.8.9A7.3,7.3,0,0,1,39.4,18Zm.1-10.8a3.9,3.9,0,0,0-2.6.9,2.8,2.8,0,0,0-1,2.1,2.6,2.6,0,0,0,1,2,4.3,4.3,0,0,0,5,0,2.7,2.7,0,0,0,1-2.1,2.8,2.8,0,0,0-1-2.1A4.1,4.1,0,0,0,39.5,7.2Zm22.1,8a6,6,0,0,1-3.9-1.4,5.1,5.1,0,0,1-1.5-3.5,4.7,4.7,0,0,1,1.5-3.4,5.8,5.8,0,0,1,7.7-.1A5.1,5.1,0,0,1,67,10.5v.2H58.2V11a2.8,2.8,0,0,0,1,1.7,3.6,3.6,0,0,0,2.3.8,4,4,0,0,0,3.4-2v-.2l1.7.8v.2a6.4,6.4,0,0,1-2.1,2.2A7,7,0,0,1,61.6,15.2Zm0-8a3.2,3.2,0,0,0-3,1.6v.3h6.2V8.8a2.2,2.2,0,0,0-.9-1A3.7,3.7,0,0,0,61.6,7.2Zm-35.3,8a3.9,3.9,0,0,1-3.2-1.5h-.2l1.3-1.3.2.2a2.6,2.6,0,0,0,1.8.9,1.7,1.7,0,0,0,1-.3,1.4,1.4,0,0,0,.5-.8,1.3,1.3,0,0,0-.4-.7l-1.5-.8a5.6,5.6,0,0,1-1.7-1.1,2.2,2.2,0,0,1-.6-1.9,1.9,1.9,0,0,1,.8-1.6,3.7,3.7,0,0,1,2.2-.8,4.7,4.7,0,0,1,3,1.3l.2.2L28.4,8.1h-.2a3.1,3.1,0,0,0-1.7-.9,1.1,1.1,0,0,0-.8.3.7.7,0,0,0-.4.6.7.7,0,0,0,.4.6l1.5.8a8.3,8.3,0,0,1,1.7,1.2,2.4,2.4,0,0,1,.7,1.8,2.6,2.6,0,0,1-1,1.9A3.2,3.2,0,0,1,26.3,15.2Zm-9.1,0a5.6,5.6,0,0,1-3.9-1.4,4.7,4.7,0,0,1-1.5-3.5,4.3,4.3,0,0,1,1.5-3.4,5.1,5.1,0,0,1,3.9-1.5,5.3,5.3,0,0,1,3.7,1.4,4.4,4.4,0,0,1,1.6,3.7v.2H13.8V11a4.2,4.2,0,0,0,1,1.7,3.8,3.8,0,0,0,2.3.8,3.9,3.9,0,0,0,3.4-2v-.2l1.8.8-.2.2a6.4,6.4,0,0,1-2.1,2.2A6.5,6.5,0,0,1,17.2,15.2Zm-.1-8a3.1,3.1,0,0,0-2.9,1.6v.3h6.2V8.8a1.9,1.9,0,0,0-1-1A3.7,3.7,0,0,0,17.1,7.2Zm-11.7,8a5.1,5.1,0,0,1-3.1-1.1L2,13.9v1H0V2.3H2V6.6l.3-.2a5.8,5.8,0,0,1,3.2-1A5.4,5.4,0,0,1,9.3,6.8a4.8,4.8,0,0,1,1.6,3.5,4.4,4.4,0,0,1-1.6,3.4A5.6,5.6,0,0,1,5.4,15.2Zm0-8.1A3.7,3.7,0,0,0,2.9,8a2.9,2.9,0,0,0-1,2.2,3.3,3.3,0,0,0,1,2.3,3.5,3.5,0,0,0,2.5.9h0a3.8,3.8,0,0,0,2.5-.9,3.2,3.2,0,0,0,1-2.2,3,3,0,0,0-1-2.2A3.3,3.3,0,0,0,5.4,7.1Zm62.5,7.8V5.6H70v.5l.3-.2c0-.1.1-.1.2-.2a2.4,2.4,0,0,1,1.2-.3,2.7,2.7,0,0,1,1.4.4h.3L72.3,7.4h-.7c-.3,0-.5.2-.8.4a2.3,2.3,0,0,0-.6,1.2,9.8,9.8,0,0,0-.2,2.8v3.3Zm-14.6,0V10.5a8.2,8.2,0,0,0-.1-1.9,2.9,2.9,0,0,0-.4-.8,1.2,1.2,0,0,0-.7-.5l-1-.2a3.1,3.1,0,0,0-1.3.3l-1,.7-.5,1a6.6,6.6,0,0,0-.2,2.3v3.5h-2V5.6h2v1l.3-.2a5.1,5.1,0,0,1,2.9-1,4.6,4.6,0,0,1,2.1.5,4.3,4.3,0,0,1,1.5,1.5,6.4,6.4,0,0,1,.4,2.7v4.8Zm-22.6,0V5.6h2v9.3Zm1-10a1.8,1.8,0,0,1-1-.4,1.1,1.1,0,0,1-.4-.9,1.1,1.1,0,0,1,.4-.9,1.5,1.5,0,0,1,1-.4,1.8,1.8,0,0,1,1,.4,1.5,1.5,0,0,1,.4.9,1.5,1.5,0,0,1-.4.9A1.8,1.8,0,0,1,31.7,4.9Z',
  viewBox: '0 0 77.2 18',
}

export const AglynSvgLogo = createSvgPathIcon('AglynSvgLogo', AGLYN_SVG_LOGO.path, {
  viewBox: AGLYN_SVG_LOGO.viewBox,
  'aria-label': 'Aglyn logo',
})

const aglynSvgIconClassKey = generateComponentClassKeys('AglynSvgIcon', [
  'rectBg',
  'a1',
  'a2',
  'a3',
])
export interface AglynSvgIconProps extends SvgIconProps {
  rectBgColor?: string
  a1Color?: string
  a2Color?: string
  a3Color?: string
}
export const AglynSvgIcon = styled(forwardRef<any, AglynSvgIconProps>(
  function RefRenderFn(props, ref) {
    return (
      <SvgIcon ref={ref} {...props}>
        <defs>
          <clipPath id="b">
            <rect width="24" height="24" />
          </clipPath>
        </defs>
        <g id="a" clipPath="url(#b)">
          <rect width="24" height="24" className={aglynSvgIconClassKey.rectBg} />
          <g transform="translate(3.128 2.629)">
            <g transform="translate(0 0.7)">
              <path
                d="M17.422,18.583H15.269l-2.673-5.8H5.453L2.8,18.583H.557l8.184-18h.615Zm-5.748-7.853L9.048,4.888,6.4,10.731Z"
                transform="translate(-0.557 -0.583)"
                className={aglynSvgIconClassKey.a1}
              />
            </g>
            <g transform="translate(1 0.346)">
              <path
                d="M17.422,18.583H15.269l-2.673-5.8H5.453L2.8,18.583H.557l8.184-18h.615Zm-5.748-7.853L9.048,4.888,6.4,10.731Z"
                transform="translate(-0.557 -0.583)"
                className={aglynSvgIconClassKey.a2}
              />
            </g>
            <g transform="translate(2)">
              <path
                d="M17.422,18.583H15.269l-2.673-5.8H5.453L2.8,18.583H.557l8.184-18h.615Zm-5.748-7.853L9.048,4.888,6.4,10.731Z"
                transform="translate(-0.557 -0.583)"
                className={aglynSvgIconClassKey.a3}
              />
            </g>
          </g>
        </g>
      </SvgIcon>
    )
  }
), {
  name: 'AglynSvgIcon'
})(({theme, rectBgColor, a1Color, a2Color, a3Color}) => ({
  [`& .${aglynSvgIconClassKey.rectBg}`]: {
    fill: 'currentColor',
    color: rectBgColor ?? theme.palette.primary.main,
  },
  [`& .${aglynSvgIconClassKey.a1}`]: {
    fill: 'currentColor',
    color: a1Color ?? theme.palette.secondary.main,
  },
  [`& .${aglynSvgIconClassKey.a2}`]: {
    fill: 'currentColor',
    color: a2Color ?? theme.palette.tertiary.main,
  },
  [`& .${aglynSvgIconClassKey.a3}`]: {
    fill: 'currentColor',
    color: a3Color ?? theme.palette.primary.contrastText,
  },
}))
AglynSvgIcon.displayName = "AglynSvgIcon"

export const BesignerSvgLogo = createSvgPathIcon('BesignerSvgLogo', BESIGNER_SVG_LOGO.path, {
  viewBox: BESIGNER_SVG_LOGO.viewBox,
  'aria-label': 'BesignerSvgLogo',
})
