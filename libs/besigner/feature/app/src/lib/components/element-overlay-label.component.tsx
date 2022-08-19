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

import { NodeId } from '@aglyn/core-data-foundation'
import { useAglynElementLabel } from '@aglyn/core-feature-renderer'
import { styled } from '@aglyn/shared-ui-theme'
import { Divider, Stack, type StackProps, Typography } from '@mui/material'
import { forwardRef } from 'react'
import ElementIconComponent from './element-icon.component'

const ElementLabelWrapper = styled(Stack, {
  name: 'AglynElementLabelWrapper',
})<StackProps>(({ theme }) => ({
  pointerEvents: 'none',
  marginLeft: '-2px',
  marginBottom: '1px',
  backgroundColor: theme.palette.primary.light,
  color: theme.palette.primary.contrastText,
  paddingLeft: theme.spacing(0.5),
  paddingRight: theme.spacing(0.5),
  paddingTop: theme.spacing(0.35),
  paddingBottom: theme.spacing(0.35),
  maxWidth: 140,
  fontSize: 12,
  ['& > .icon-wrapper']: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    display: 'flex',
    fontSize: theme.typography.pxToRem(12),
  },
}))

export interface ElementOverlayLabelProps extends StackProps {
  $id: NodeId
}

const ElementOverlayLabelComponent = forwardRef<
  HTMLDivElement,
  ElementOverlayLabelProps
>((props, ref) => {
  const { $id, children, ...rest } = props
  const badgeLabel = useAglynElementLabel($id)
  return (
    <ElementLabelWrapper
      ref={ref}
      id="aglyn:element-overlay-label"
      data-aglyn-node={$id}
      data-aglyn-kind="overlay-label"
      direction="row"
      justifyContent="flex-start"
      alignItems="center"
      spacing={0.35}
      fontSize={6}
      lineHeight={1}
      fontWeight={600}
      letterSpacing={-0.25}
      divider={
        <Divider orientation="vertical" variant="fullWidth" light flexItem />
      }
      {...rest}
    >
      <div className={'icon-wrapper'}>
        <ElementIconComponent
          $id={$id}
          sx={{ color: 'inherit' }}
          color="inherit"
          fontSize="inherit"
        />
      </div>
      <Typography
        component="div"
        textOverflow="ellipsis"
        overflow="hidden"
        whiteSpace="nowrap"
        fontSize="inherit"
        color="inherit"
        children={badgeLabel}
      />
    </ElementLabelWrapper>
  )
})
ElementOverlayLabelComponent.displayName = 'ElementOverlayLabelComponent'
ElementOverlayLabelComponent.aglyn = true
ElementOverlayLabelComponent.defaultProps = {}

export { ElementOverlayLabelComponent }
export default ElementOverlayLabelComponent
