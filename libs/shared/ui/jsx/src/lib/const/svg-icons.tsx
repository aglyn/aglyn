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

import { generateComponentClassKeys } from '@aglyn/shared-ui-theme'
import { _isEqualitySameType } from '@aglyn/shared-util-tools'
import { styled, SvgIcon, SvgIconProps } from '@mui/material'
import { forwardRef } from 'react'
import { aglynLogoClassKeys, type AglynLogoProps } from './aglyn-logo-class-keys'

export * from './aglyn-besigner-logo-full'
export * from './aglyn-console-logo-full'
export * from './aglyn-logo-class-keys'
export * from './aglyn-logo-full'


/**
 * ## The `<title>` on every wordmark below says `Aglyn`, deliberately
 *
 * The brand-literal ratchet learned to read JSX text in AGL-2350 and the
 * `<title>` element in each of these wordmarks — and in `aglyn-logo-full.tsx`
 * beside them — is what it found. They are baselined rather than rewritten,
 * and a future sweep should leave them alone.
 *
 * A `<title>` inside an `<svg>` is the ACCESSIBLE NAME of the artwork around
 * it, and this artwork is Aglyn's own compass mark and logotype, drawn as
 * vector paths. Substituting `productName` would announce a white-label org's
 * name over a picture that unmistakably draws ours — the label would become
 * false to the only users who ever hear it, for no gain, since a screen-reader
 * user and a sighted one would then be told different things about the same
 * image. It is the `docs-self-host.mjs` line: *what must not survive is a
 * value the software ACTS on*, and an accessible name for a fixed drawing is
 * not one.
 *
 * The real question is not what these say but WHERE they render.
 * `main.layout.tsx` already swaps the console chrome on `whiteLabel`; the open
 * item is every other placement, the tenant admin bar's `<AglynMark />` most
 * of all, which sits on a white-label customer's PUBLISHED site. That is
 * tracked as AGL-2350 and is a product decision, not a lint fix — no detector
 * that reads source can see a wordmark anyway, because the paths carry the
 * brand with no string in them at all.
 */
export const AglynLogoMark = styled(
  (props) => {
    return (
      <SvgIcon {...props}>
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <title>Aglyn</title>
          <g id="aglyn-logo-mark-light">
            <path
              className={aglynLogoClassKeys.compass}
              d="M5,16.202l-0.267,0.183l-1.733,0.152l-0,1.46l-1,-0l-0,4l4,-0l0,-1l7.171,-0l-0.148,-0.263l-0,-1.737l-7.023,-0l0,-1l-1,-0l0,-1.795Zm14,-7.234l0,9.029l-0.004,-0l0,2.737l-0.714,1.263l3.718,-0l0,-4l-1,-0l0,-10.273c-0.37,-0 -0.836,-0 -0.836,-0.001c-0.307,0.47 -0.697,0.894 -1.164,1.245Zm-16,0.145l2,-1.376l0,-1.74l1,-0l0,-1l4.748,-0l0.279,-0.193c0.025,-0.623 0.167,-1.237 0.416,-1.807l-5.443,-0l0,-1l-4,-0l-0,4l1,-0l-0,3.116Zm19,-7.116l-2.029,-0c0.067,0.088 0.131,0.179 0.192,0.273l1.281,-0l0.556,0.556l0,-0.829Z"
            />
            <path
              className={aglynLogoClassKeys.boundingBox}
              d="M15,9.997c0.323,0.073 0.661,0.112 1.01,0.112c0.348,-0 0.687,-0.039 1.009,-0.112l0,10.217l-1.009,1.783l-1.01,-1.783l0,-10.217Zm-1.898,-4.221c-0.345,-1.28 0.196,-2.683 1.398,-3.377c1.434,-0.828 3.27,-0.336 4.098,1.098c0.139,0.241 0.241,0.493 0.307,0.75l1.72,-0l0.375,0.375l-0,0.75l-0.375,0.375l-1.721,-0c-0.194,0.752 -0.679,1.429 -1.404,1.848c-1.052,0.607 -2.319,0.504 -3.247,-0.159l-3.458,2.379l-0.252,1.364l-3.296,2.267l-1.363,-0.252l-1.843,1.267l-2.041,0.179l0.897,-1.842l1.826,-1.257c0,0 0.257,-1.39 0.257,-1.39l3.296,-2.268l1.39,0.257l3.436,-2.364Zm3.398,0.087c-0.478,0.276 -1.09,0.112 -1.366,-0.366c-0.276,-0.478 -0.112,-1.09 0.366,-1.366c0.478,-0.276 1.09,-0.112 1.366,0.366c0.276,0.478 0.112,1.09 -0.366,1.366Z"
            />
          </g>
        </svg>
      </SvgIcon>
    )
  },
  {
    name: 'AglynLogoMark',
    shouldForwardProp: (prop) => prop !== 'variant',
  },
)<AglynLogoProps>(({ theme, variant }) => {
  let compass: string
  let boundingBox: string

  switch (variant) {
    case 'black':
      compass = theme.palette.common.black
      boundingBox = theme.palette.common.black
      break
    case 'white':
      compass = theme.palette.common.white
      boundingBox = theme.palette.common.white
      break
    default:
      compass = theme.palette.secondary.main
      boundingBox = theme.palette.primary.main
      break
  }

  return {
    fillRule: 'evenodd',
    [`& .${aglynLogoClassKeys.compass}`]: {
      fill: compass,
    },
    [`& .${aglynLogoClassKeys.boundingBox}`]: {
      fill: boundingBox,
    },
  }
})

export const AglynLogoText = styled(
  (props: SvgIconProps) => {
    return (
      <SvgIcon {...props} viewBox="0 0 55 24">
        <title>Aglyn</title>
        <g id="aglyn-logo-text-light">
          <path
            className={aglynLogoClassKeys.textAglyn}
            d="M31.612,19.327c0.246,0.057 0.482,0.106 0.707,0.146c0.224,0.039 0.414,0.059 0.57,0.059c0.257,0 0.477,-0.065 0.658,-0.196c0.182,-0.131 0.355,-0.366 0.518,-0.706c0.163,-0.341 0.34,-0.815 0.53,-1.424l-4.385,-10.908l2.938,0l2.995,8.059l2.618,-8.059l2.697,0l-4.645,13.066c-0.165,0.494 -0.423,0.94 -0.774,1.337c-0.352,0.398 -0.781,0.709 -1.289,0.935c-0.507,0.227 -1.08,0.34 -1.717,0.34c-0.228,-0 -0.457,-0.018 -0.686,-0.054c-0.229,-0.036 -0.475,-0.096 -0.735,-0.182l-0,-2.413Zm-13.445,-2.053c-0.734,0 -1.408,-0.144 -2.023,-0.433c-0.614,-0.29 -1.14,-0.69 -1.579,-1.201c-0.438,-0.511 -0.777,-1.1 -1.017,-1.766c-0.241,-0.666 -0.361,-1.373 -0.361,-2.12c0,-0.789 0.125,-1.525 0.375,-2.208c0.25,-0.683 0.604,-1.284 1.062,-1.801c0.458,-0.518 1,-0.921 1.626,-1.21c0.627,-0.289 1.32,-0.434 2.081,-0.434c0.859,0 1.614,0.193 2.266,0.577c0.651,0.385 1.184,0.899 1.599,1.542l-0,-1.922l2.477,0l0,10.388c0,1.078 -0.264,2.002 -0.793,2.772c-0.529,0.771 -1.256,1.362 -2.182,1.774c-0.925,0.412 -1.979,0.617 -3.162,0.617c-1.208,0 -2.227,-0.199 -3.058,-0.598c-0.83,-0.399 -1.541,-0.954 -2.132,-1.665l1.545,-1.491c0.424,0.52 0.956,0.925 1.596,1.216c0.641,0.291 1.324,0.437 2.049,0.437c0.594,-0 1.141,-0.108 1.642,-0.322c0.501,-0.215 0.903,-0.549 1.207,-1.002c0.304,-0.452 0.456,-1.032 0.456,-1.738l0,-1.371c-0.364,0.623 -0.88,1.105 -1.547,1.447c-0.667,0.341 -1.376,0.512 -2.127,0.512Zm-16.167,-3.288c-0,-0.713 0.202,-1.335 0.607,-1.867c0.405,-0.531 0.964,-0.946 1.678,-1.242c0.714,-0.297 1.536,-0.445 2.466,-0.445c0.468,0 0.941,0.037 1.417,0.11c0.476,0.073 0.894,0.183 1.253,0.33l0,-0.585c0,-0.689 -0.207,-1.221 -0.622,-1.597c-0.416,-0.376 -1.031,-0.563 -1.846,-0.563c-0.613,-0 -1.194,0.104 -1.744,0.313c-0.551,0.209 -1.129,0.511 -1.737,0.908l-0.895,-1.817c0.731,-0.48 1.48,-0.838 2.246,-1.075c0.767,-0.236 1.575,-0.355 2.427,-0.355c1.568,0 2.794,0.389 3.678,1.165c0.884,0.777 1.326,1.89 1.326,3.34l-0,3.484c-0,0.291 0.05,0.498 0.151,0.621c0.102,0.123 0.274,0.195 0.517,0.215l-0,2.28c-0.247,0.046 -0.472,0.081 -0.676,0.104c-0.204,0.024 -0.38,0.035 -0.528,0.035c-0.564,0 -0.99,-0.122 -1.278,-0.368c-0.289,-0.245 -0.466,-0.553 -0.532,-0.923l-0.061,-0.556c-0.486,0.617 -1.087,1.091 -1.805,1.421c-0.718,0.33 -1.451,0.495 -2.199,0.495c-0.733,-0 -1.392,-0.151 -1.976,-0.452c-0.584,-0.302 -1.041,-0.713 -1.371,-1.232c-0.331,-0.519 -0.496,-1.1 -0.496,-1.744Zm24.558,-11.982l2.833,0l-0,11.695c-0,0.51 0.086,0.851 0.258,1.024c0.172,0.174 0.4,0.26 0.684,0.26c0.239,0 0.476,-0.029 0.712,-0.089c0.236,-0.059 0.443,-0.13 0.62,-0.212l0.391,2.138c-0.386,0.169 -0.831,0.304 -1.333,0.407c-0.502,0.102 -0.963,0.153 -1.382,0.153c-0.878,-0 -1.561,-0.234 -2.05,-0.703c-0.488,-0.468 -0.733,-1.129 -0.733,-1.983l0,-12.69Zm26.442,15.202l-2.832,-0l-0,-6.118c-0,-0.877 -0.155,-1.517 -0.463,-1.92c-0.308,-0.403 -0.737,-0.604 -1.285,-0.604c-0.381,-0 -0.765,0.098 -1.154,0.294c-0.389,0.197 -0.738,0.465 -1.046,0.804c-0.308,0.339 -0.537,0.729 -0.687,1.172l-0,6.372l-2.833,-0l0,-10.908l2.559,0l-0,2.013c0.283,-0.464 0.645,-0.859 1.084,-1.187c0.44,-0.328 0.943,-0.58 1.509,-0.757c0.566,-0.177 1.171,-0.266 1.812,-0.266c0.692,0 1.257,0.123 1.696,0.367c0.44,0.245 0.778,0.574 1.015,0.986c0.237,0.413 0.4,0.874 0.49,1.382c0.09,0.508 0.135,1.026 0.135,1.553l-0,6.817Zm-44.119,-2.675c0.163,-0.156 0.294,-0.32 0.392,-0.49c0.099,-0.17 0.148,-0.324 0.148,-0.463l0,-1.109c-0.341,-0.129 -0.709,-0.231 -1.102,-0.306c-0.393,-0.075 -0.768,-0.112 -1.125,-0.112c-0.735,0 -1.337,0.154 -1.808,0.463c-0.47,0.308 -0.705,0.719 -0.705,1.232c-0,0.279 0.077,0.543 0.233,0.794c0.155,0.252 0.38,0.455 0.674,0.61c0.294,0.155 0.649,0.232 1.065,0.232c0.425,0 0.84,-0.08 1.243,-0.24c0.404,-0.16 0.733,-0.364 0.985,-0.611Zm10.247,0.512c0.306,-0 0.599,-0.049 0.88,-0.148c0.28,-0.098 0.541,-0.23 0.781,-0.397c0.24,-0.166 0.451,-0.362 0.634,-0.588c0.183,-0.226 0.322,-0.463 0.418,-0.712l0,-2.598c-0.165,-0.424 -0.4,-0.796 -0.703,-1.116c-0.302,-0.319 -0.642,-0.567 -1.018,-0.745c-0.376,-0.177 -0.763,-0.266 -1.161,-0.266c-0.436,-0 -0.832,0.093 -1.187,0.279c-0.355,0.185 -0.659,0.439 -0.911,0.759c-0.253,0.321 -0.448,0.68 -0.586,1.078c-0.137,0.399 -0.206,0.81 -0.206,1.235c0,0.447 0.078,0.865 0.234,1.253c0.156,0.388 0.372,0.731 0.646,1.027c0.275,0.297 0.6,0.528 0.976,0.692c0.376,0.164 0.777,0.247 1.203,0.247Z"
          />
        </g>
      </SvgIcon>
    )
  },
  {
    name: 'AglynLogoText',
    shouldForwardProp: (prop) => prop !== 'variant',
  },
)<AglynLogoProps>(({ theme, variant }) => {
  if (variant === 'white') {
    return {
      height: 'auto',
      [`& .${aglynLogoClassKeys.textAglyn}`]: {
        fill: theme.palette.common.white,
      },
    }
  }

  if (variant === 'black') {
    return {
      height: 'auto',
      [`& .${aglynLogoClassKeys.textAglyn}`]: {
        fill: theme.palette.common.black,
      },
    }
  }

  return {
    height: 'auto',
    [`& .${aglynLogoClassKeys.textAglyn}`]: {
      fill:
        theme.palette.mode === 'light'
          ? theme.palette.primary.main
          : theme.palette.common.white,
    },
  }
})

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

const AglynSvgLogoRoot = styled(SvgIcon, { name: 'AglynSvgLogo' })({
  // width: 'unset',
  height: 'unset',
})

export const AglynSvgLogo = forwardRef<SVGSVGElement, SvgIconProps>(
  function AglynSvgLogo(
    {
      'aria-label': ariaLabel = 'aglyn',
      viewBox = AGLYN_SVG_LOGO.viewBox,
      children,
      ...props
    },
    ref,
  ) {
    return (
      <AglynSvgLogoRoot
        aria-label={ariaLabel}
        viewBox={viewBox}
        ref={ref}
        {...props}
      >
        {children ?? <path d={AGLYN_SVG_LOGO.path} />}
      </AglynSvgLogoRoot>
    )
  },
)
AglynSvgLogo.displayName = 'AglynSvgLogo'
AglynSvgLogo.aglyn = true

const BesignerSvgLogoRoot = styled(SvgIcon, { name: 'BesignerSvgLogo' })({
  // width: 'unset',
  // height: 'unset',
})

export const BesignerSvgLogo = forwardRef<SVGSVGElement, SvgIconProps>(
  function BesignerSvgLogo(
    {
      'aria-label': ariaLabel = 'besigner',
      viewBox = BESIGNER_SVG_LOGO.viewBox,
      children,
      ...props
    },
    ref,
  ) {
    return (
      <BesignerSvgLogoRoot
        aria-label={ariaLabel}
        viewBox={viewBox}
        ref={ref}
        {...props}
      >
        {children ?? <path d={BESIGNER_SVG_LOGO.path} />}
      </BesignerSvgLogoRoot>
    )
  },
)
BesignerSvgLogo.displayName = 'BesignerSvgLogo'
BesignerSvgLogo.aglyn = true

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
  rounded?: boolean
  bordered?: boolean
}

export const AglynSvgIcon = styled(
  forwardRef<any, AglynSvgIconProps>((props, ref) => {
    return (
      <SvgIcon ref={ref} {...props}>
        <title>Aglyn</title>
        <defs>
          <clipPath id="b">
            <rect width="24" height="24" />
          </clipPath>
        </defs>
        <g id="a" clipPath="url(#b)">
          <rect
            width="24"
            height="24"
            className={aglynSvgIconClassKey.rectBg}
          />
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
  }),
  {
    name: 'AglynSvgIcon',
    shouldForwardProp: (propName) =>
      !_isEqualitySameType(
        propName,
        null,
        'rectBgColor',
        'a1Color',
        'a2Color',
        'a3Color',
        'rounded',
        'bordered',
      ),
  },
)<AglynSvgIconProps>(
  ({ theme, rectBgColor, a1Color, a2Color, a3Color, rounded, bordered }) => {
    // Use (theme.vars || theme) so all palette refs become CSS custom-property
    // references that switch correctly when the color scheme changes.
    const tv = (theme as any).vars || theme
    return {
      borderRadius: !rounded ? undefined : theme.shape.appIconBorderRadius,
      border: !bordered ? undefined : `1px solid ${tv.palette.divider}`,
      [`& .${aglynSvgIconClassKey.rectBg}`]: {
        fill: 'currentColor',
        // primary.main CSS var: #404C5C (light) / #2C3540 (dark) — both respond to mode
        color: rectBgColor || tv.palette.primary.main,
      },
      [`& .${aglynSvgIconClassKey.a1}`]: {
        fill: 'currentColor',
        color: a1Color || tv.palette.primary.main,
      },
      [`& .${aglynSvgIconClassKey.a2}`]: {
        fill: 'currentColor',
        color: a2Color || tv.palette.secondary.main,
      },
      [`& .${aglynSvgIconClassKey.a3}`]: {
        fill: 'currentColor',
        color: a3Color || tv.palette.primary.contrastText,
      },
    }
  },
)
AglynSvgIcon.displayName = 'AglynSvgIcon'
AglynSvgIcon.aglyn = true
