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

import * as Aglyn from '@aglyn/aglyn'
import * as Besigner from '@aglyn/besigner'
import {
  ICON_VARIANT_MODIFY_ADD,
  ICON_VARIANT_MODIFY_DRAG,
  ICON_VARIANT_SHOW_MORE_VERTICAL,
} from '@aglyn/shared-data-enums'
import { SrOnly, SrOnlyProps } from '@aglyn/shared-ui-jsx'
import { MdiIcon, MdiIconProps } from '@aglyn/shared-ui-mdi-jsx'
import { styled } from '@aglyn/shared-ui-theme'
import {
  Button as MuiButton,
  type ButtonProps,
  Divider,
  Stack,
  type StackProps,
  Tooltip as MuiTooltip,
  TooltipProps,
  Typography,
} from '@mui/material'
import { observer } from 'mobx-react-lite'
import { forwardRef } from 'react'
import { Else, If, Then } from 'react-if'
import useAddElementDrawerCallback from '../hooks/use-add-element-drawer-callback'
import ComponentIconComponent from './component-icon.component'
import NodeContextMenu from './node-context-menu'

interface LabelActionProps extends Omit<TooltipProps, 'children'> {
  children?: JSX.Children
  icon: MdiIconProps
  ButtonProps?: ButtonProps
  SrOnlyProps?: SrOnlyProps
}

const ActionButton = styled(MuiButton)(({ theme }) => ({
  borderRadius: `0.2em`,
  marginLeft: theme.spacing(-0.2),
  pointerEvent: 'unset',
  paddingTop: theme.spacing(0.1),
  paddingBottom: theme.spacing(0.1),
  paddingRight: theme.spacing(0.15),
  paddingLeft: theme.spacing(0.15),
  fontSize: theme.typography.pxToRem(16),
  minWidth: 20,
  '&.MuiButtonGroup-grouped': { minWidth: 25 },
}))

const LabelAction = forwardRef<any, LabelActionProps>((props, ref) => {
  const { children, ButtonProps, icon, SrOnlyProps, ...rest } = props

  return (
    <MuiTooltip ref={ref} {...rest}>
      <ActionButton variant={'contained'} color={'primary'} {...ButtonProps}>
        <MdiIcon fontSize="inherit" {...icon} />
        <SrOnly {...SrOnlyProps}>{children}</SrOnly>
      </ActionButton>
    </MuiTooltip>
  )
})
LabelAction.displayName = 'AglynLabelAction'

export interface NodeQuickActionsProps extends StackProps {
  node: Aglyn.NodeSchema
  variant?: 'label' | 'actions'
}

export const NodeQuickActions = observer(
  forwardRef<any, NodeQuickActionsProps>((props, ref) => {
    const { node, children, variant, ...rest } = props
    const handleAddElementClick = useAddElementDrawerCallback()
    const handleProps = Besigner.handles.get(node?.$id)
    return (
      <Stack
        ref={ref}
        id="aglyn:element-overlay-label"
        data-aglyn-node={node?.$id}
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
          pl: 0.5,
          pr: 0.25,
          py: 0.35,
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
            fontSize="inherit"
          />
        </Stack>
        <If condition={variant !== 'actions'}>
          <Then>
            <Typography
              component="div"
              textOverflow="ellipsis"
              overflow="hidden"
              whiteSpace="nowrap"
              fontSize="inherit"
              color="inherit"
              maxWidth={100}
              title={node?.labelShort}
            >
              {node?.labelShort}
            </Typography>
          </Then>
          <Else>
            <Stack
              direction="row"
              justifyContent="flex-start"
              alignItems="center"
              spacing={0.25}
            >
              <LabelAction
                title="move"
                disableInteractive
                ButtonProps={{
                  ...handleProps,
                  onClick: () => handleAddElementClick(node),
                }}
                icon={{ path: ICON_VARIANT_MODIFY_DRAG.path }}
              >
                {'move'}
              </LabelAction>
              <LabelAction
                title="Add"
                disableInteractive
                ButtonProps={{
                  onClick: () => handleAddElementClick(node),
                }}
                icon={{ path: ICON_VARIANT_MODIFY_ADD.path }}
              >
                {'add'}
              </LabelAction>
              <LabelAction
                placement="right"
                children={'add'}
                icon={{ path: ICON_VARIANT_SHOW_MORE_VERTICAL.path }}
                enterDelay={200}
                leaveDelay={500}
                componentsProps={{
                  popper: {
                    disablePortal: false,
                    modifiers: [
                      {
                        name: 'flip',
                        enabled: true,
                        options: {
                          altBoundary: true,
                          rootBoundary: 'document',
                          padding: 100,
                        },
                      },
                      {
                        name: 'preventOverflow',
                        enabled: true,
                        options: {
                          altAxis: true,
                          altBoundary: true,
                          tether: true,
                          rootBoundary: 'document',
                          padding: 100,
                        },
                      },
                      {
                        name: 'arrow',
                        enabled: true,
                      },
                    ],
                  },
                  tooltip: {
                    sx: {
                      padding: 0,
                      m: -2,
                    },
                  },
                }}
                title={<NodeContextMenu node={node} />}
              />
            </Stack>
          </Else>
        </If>
      </Stack>
    )
  }),
)
NodeQuickActions.displayName = 'NodeQuickActions'

export default NodeQuickActions
