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

import * as Aglyn from '@aglyn/aglyn'
import useAddElementDrawerCallback from '@aglyn/besigner-feature-app/hooks/use-add-element-drawer-callback'
import { ICON_VARIANT_MODIFY_ADD } from '@aglyn/shared-data-enums'
import { styled } from '@aglyn/shared-ui-theme'
import { Divider, Stack, type StackProps, Typography } from '@mui/material'
import { observer } from 'mobx-react-lite'
import ComponentIconComponent from './component-icon.component'
import { BadgeButton } from './element-overlay-actions.component'

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
  $id: Aglyn.NodeId
}

const ElementOverlayLabel = (props: ElementOverlayLabelProps) => {
  const { $id, children, ...rest } = props
  const node = Aglyn.screen.getNode($id)
  const label = Aglyn.screen.getNodeLabelShort(node)
  const handleAddElementClick = useAddElementDrawerCallback({ $id })
  return (
    <Stack
      id="aglyn:element-overlay-label"
      data-aglyn-node={$id}
      data-aglyn-kind="overlay-label"
      direction="row"
      justifyContent="flex-start"
      alignItems="center"
      spacing={0.35}
      sx={{
        fontSize: 12,
        lineHeight: 1,
        fontWeight: 600,
        letterSpacing: 0.25,
        // pointerEvents: 'none',
        marginLeft: '-2px',
        marginBottom: '1px',
        backgroundColor: 'primary.light',
        color: 'primary.contrastText',
        px: 0.5,
        py: 0.35,
        maxWidth: 140,
      }}
      divider={
        <Divider orientation="vertical" variant="fullWidth" light flexItem />
      }
      {...rest}
    >
      <Stack
        direction="column"
        alignItems="center"
        justifyContent="center"
        sx={{ fontSize: 12 }}
      >
        <ComponentIconComponent
          component={node?.componentSchema}
          color="inherit"
          fontSize="inherit"
          sx={{ color: 'inherit' }}
        />
      </Stack>
      <Typography
        component="div"
        textOverflow="ellipsis"
        overflow="hidden"
        whiteSpace="nowrap"
        fontSize="inherit"
        color="inherit"
        children={label}
      />
      <BadgeButton
        title="Add"
        children={'add'}
        disableInteractive={false}
        ButtonProps={{
          onClick: (e) => handleAddElementClick(e, { $id }),
          variant: 'contained',
          color: 'primary',
          sx: { borderRadius: `0.2em`, ml: -0.2, pointerEvent: 'unset' },
        }}
        icon={{ path: ICON_VARIANT_MODIFY_ADD.path }}
      />
    </Stack>
  )
}
ElementOverlayLabel.displayName = 'ElementOverlayLabelComponent'
ElementOverlayLabel.aglyn = true
ElementOverlayLabel.defaultProps = {}
const ElementOverlayLabelComponent = observer(ElementOverlayLabel)

export { ElementOverlayLabelComponent }
export default ElementOverlayLabelComponent
