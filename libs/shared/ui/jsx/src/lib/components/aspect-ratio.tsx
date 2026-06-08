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

import { unstable_composeClasses as composeClasses } from '@mui/base'
import {
  capitalize,
  generateUtilityClass,
  generateUtilityClasses,
  useThemeProps,
} from '@mui/material'
import { styled } from '@mui/material/styles'
import { Children, cloneElement, forwardRef, isValidElement } from 'react'

export interface AspectRatioClasses {
  /** Styles applied to the root element. */
  root: string
  /** Styles applied to the content element. */
  content: string
  /** Styles applied to the content element if `color="primary"`. */
  colorPrimary: string
  /** Styles applied to the content element if `color="neutral"`. */
  colorNeutral: string
  /** Styles applied to the content element if `color="danger"`. */
  colorDanger: string
  /** Styles applied to the content element if `color="info"`. */
  colorInfo: string
  /** Styles applied to the content element if `color="success"`. */
  colorSuccess: string
  /** Styles applied to the content element if `color="warning"`. */
  colorWarning: string
  /** Styles applied to the root element when color inversion is triggered. */
  colorContext: string
  /** Styles applied to the content element if `variant="plain"`. */
  variantPlain: string
  /** Styles applied to the content element if `variant="outlined"`. */
  variantOutlined: string
  /** Styles applied to the content element if `variant="soft"`. */
  variantSoft: string
  /** Styles applied to the content element if `variant="solid"`. */
  variantSolid: string
}

export type AspectRatioClassKey = keyof AspectRatioClasses

export function getAspectRatioUtilityClass(slot: string): string {
  return generateUtilityClass('MuiAspectRatio', slot)
}

const aspectRatioClasses: AspectRatioClasses = generateUtilityClasses(
  'MuiAspectRatio',
  [
    'root',
    'content',
    'colorPrimary',
    'colorNeutral',
    'colorDanger',
    'colorInfo',
    'colorSuccess',
    'colorWarning',
    'colorContext',
    'variantPlain',
    'variantOutlined',
    'variantSoft',
    'variantSolid',
  ],
)

const useUtilityClasses = (ownerState: AspectRatioOwnerState) => {
  const { variant, color } = ownerState
  const slots = {
    root: ['root'],
    content: [
      'content',
      variant && `variant${capitalize(variant)}`,
      color && `color${capitalize(color)}`,
    ],
  }

  return composeClasses(slots, getAspectRatioUtilityClass, {})
}

type AspectRatioOwnerState = {
  ratio?: number | string
  minHeight?: number | string
  maxHeight?: number | string
  objectFit?:
    | '-moz-initial'
    | 'contain'
    | 'cover'
    | 'fill'
    | 'inherit'
    | 'initial'
    | 'none'
    | 'revert-layer'
    | 'revert'
    | 'scale-down'
    | 'unset'
  variant?: 'outlined' | 'plain' | 'soft' | 'solid' | string
  color?: 'danger' | 'info' | 'neutral' | 'primary' | 'success' | 'warning'
}

// Use to control the width of the content, usually in a flexbox row container
const AspectRatioRoot = styled('div', {
  name: 'MuiAspectRatio',
  slot: 'Root',
  shouldForwardProp(propName) {
    return propName !== 'ratio'
  },
})<{ ownerState: AspectRatioOwnerState }>(({ ownerState }) => {
  const minHeight =
    typeof ownerState.minHeight === 'number'
      ? `${ownerState.minHeight}px`
      : ownerState.minHeight
  const maxHeight =
    typeof ownerState.maxHeight === 'number'
      ? `${ownerState.maxHeight}px`
      : ownerState.maxHeight
  return {
    // a context variable for any child component
    '--AspectRatio-paddingBottom':
      minHeight || maxHeight
        ? `clamp(${minHeight || '0px'}, calc(100% / (${ownerState.ratio})), ${
            maxHeight || '9999px'
          })`
        : `calc(100% / (${ownerState.ratio}))`,
    borderRadius: 'var(--AspectRatio-radius)',
    flexDirection: 'column',
    margin: 'var(--AspectRatio-margin)',
  }
})

const AspectRatioContent = styled('div', {
  name: 'MuiAspectRatio',
  slot: 'Content',
  overridesResolver: (props, styles) => styles.content,
})<{ ownerState: AspectRatioOwnerState }>(({ theme, ownerState }) => [
  {
    flex: 1,
    position: 'relative',
    borderRadius: 'inherit',
    height: 0,
    paddingBottom: 'var(--AspectRatio-paddingBottom)',
    overflow: 'hidden',
    // use data-attribute instead of :first-child to support zero config SSR (emotion)
    // use nested selector for integrating with nextjs image `fill` layout (spans are inserted on top of the img)
    '& [data-first-child]': {
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      boxSizing: 'border-box',
      position: 'absolute',
      width: '100%',
      height: '100%',
      objectFit: ownerState.objectFit,
      margin: 0,
      padding: 0,
      '& > img': {
        // support art-direction that uses <picture><img /></picture>
        width: '100%',
        height: '100%',
        objectFit: ownerState.objectFit,
      },
    },
  },
  theme.palette[ownerState.variant!]?.[ownerState.color!],
])

export interface AspectRatioProps extends AspectRatioOwnerState {
  children?: JSX.Children
}

export const AspectRatio = forwardRef<any, AspectRatioProps>((inProps, ref) => {
  const props = useThemeProps<any, typeof inProps & AspectRatioProps, any>({
    props: inProps,
    name: 'MuiAspectRatio',
  })

  const {
    children,
    ratio = '16 / 9',
    minHeight,
    maxHeight,
    objectFit = 'cover',
    color: colorProp = 'neutral',
    variant = 'soft',
    ...other
  } = props
  // const { getColor } = useColorInversion(variant)
  // const color = getColor(inProps.color, colorProp)

  const ownerState = {
    ...props,
    minHeight,
    maxHeight,
    objectFit,
    ratio,
    // color,
    variant,
  }

  const classes = useUtilityClasses(ownerState)

  return (
    <AspectRatioRoot
      className={classes.root}
      ownerState={ownerState}
      {...(other as any)}
    >
      <AspectRatioContent
        className={classes.content}
        ownerState={ownerState}
        {...(other as any)}
      >
        {Children.map(children, (child, index) =>
          index === 0 && isValidElement(child)
            ? cloneElement(child, { 'data-first-child': '' } as Record<
                string,
                string
              >)
            : child,
        )}
      </AspectRatioContent>
    </AspectRatioRoot>
  )
})
AspectRatio.displayName = 'AspectRatio'

export default AspectRatio
