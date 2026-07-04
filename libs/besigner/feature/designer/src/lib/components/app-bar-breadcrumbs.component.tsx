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
  generateComponentClassKeys,
  mergeSxProps,
  styled,
} from '@aglyn/shared-ui-theme'
import {
  alpha,
  AppBar as MuiAppBar,
  type AppBarProps as MuiAppBarProps,
  Breadcrumbs as MuiBreadcrumbs,
  breadcrumbsClasses,
  type BreadcrumbsProps as MuiBreadcrumbsProps,
  ButtonBase as MuiButtonBase,
  type ButtonBaseProps as ButtonBaseProps,
  Stack,
  Toolbar as MuiToolbar,
} from '@mui/material'
import clsx from 'clsx'
import { observer } from 'mobx-react-lite'
import { forwardRef, useCallback } from 'react'
import useLeafDrop from '../hooks/use-leaf-drop'

const breadcrumbItemClassKey = generateComponentClassKeys('BreadcrumbItem', [
  'root',
  'lastItem',
  'hovered',
])

const StyledBreadcrumbs = styled(MuiBreadcrumbs)(({ theme }) => {
  const tv = (theme as any).vars || theme
  return {
    lineHeight: 1,
    fontSize: 11,
    overflowX: 'auto',

    [`.${breadcrumbsClasses.ol}`]: {
      flexWrap: 'nowrap',
      whiteSpace: 'nowrap',
    },
    [`.${breadcrumbsClasses.separator}`]: {
      margin: 0,
      padding: 0,
    },
    [`.${breadcrumbsClasses.li}`]: {
      marginLeft: theme.spacing(-0.5),
      [`.${breadcrumbItemClassKey.root}`]: {
        fontSize: 'inherit',
        padding: theme.spacing(0.75),
        paddingLeft: theme.spacing(1.75),
        paddingRight: theme.spacing(1.75),
        marginLeft: theme.spacing(-0.5),
        clipPath: `polygon(calc(100% - ${theme.spacing(
          1,
        )}) 0px, 100% 50%, calc(100% - ${theme.spacing(
          1,
        )}) 100%, 0% 100%, ${theme.spacing(1)} 50%, 0% 0%)`,

        color: tv.palette.text.primary,
        background: `rgba(${tv.palette.primary.lightChannel} / ${theme.palette.action.hoverOpacity})`,
        [`:hover, .${breadcrumbItemClassKey.hovered}`]: {
          background: `rgba(${tv.palette.secondary.lightChannel} / ${theme.palette.action.activatedOpacity})`,
        },
        [`:focus`]: {
          background: `rgba(${tv.palette.primary.lightChannel} / ${theme.palette.action.focusOpacity})`,
        },
        [`:active`]: {
          background: `rgba(${tv.palette.primary.lightChannel} / ${theme.palette.action.activatedOpacity})`,
        },
      },

      [':before']: {
        content: '""',
        position: 'absolute',
        top: 0,
        height: '100%',
        width: `calc(${theme.spacing(1)} + 1px)`,
        backgroundColor: tv.palette.divider,
        marginLeft: theme.spacing(-0.5),
        clipPath: `polygon(calc(100% - ${theme.spacing(
          1,
        )}) 0px, 100% 50%, calc(100% - ${theme.spacing(
          1,
        )}) 100%, 0% 100%, ${theme.spacing(1)} 50%, 0% 0%)`,
      },

      [`:first-of-type .${breadcrumbItemClassKey.root}`]: {
        clipPath: `polygon(calc(100% - ${theme.spacing(
          1,
        )}) 0px, 100% 50%, calc(100% - ${theme.spacing(
          1,
        )}) 100%, 0% 100%, 0% 0%, 0% 0%)`,
      },

      [[
        `:last-of-type .${breadcrumbItemClassKey.root}`,
        `.${breadcrumbItemClassKey.root} .${breadcrumbItemClassKey.lastItem}`,
      ].join()]: {
        color: tv.palette.text.primary,
        background: `rgba(${tv.palette.tertiary.lightChannel} / ${theme.palette.action.selectedOpacity})`,
        [`:hover, ${breadcrumbItemClassKey.hovered}`]: {
          background: `rgba(${tv.palette.tertiary.lightChannel} / ${theme.palette.action.activatedOpacity})`,
        },
        [`:focus, .Mui-focusVisible`]: {
          background: `rgba(${tv.palette.tertiary.lightChannel} / ${theme.palette.action.focusOpacity})`,
        },
        [`:active`]: {
          background: `rgba(${tv.palette.tertiary.lightChannel} / ${theme.palette.action.hoverOpacity})`,
        },
      },
    },
  }
})

export interface BreadcrumbItemProps
  extends Partial<
    Omit<
      ButtonBaseProps<'button'>,
      'onClick' | 'onMouseEnter' | 'onFocusVisible'
    >
  > {
  $id: Aglyn.NodeId
  lastItem?: boolean
  onClick?: (e, node: Aglyn.NodeSchema<any>) => void
  onMouseEnter?: (e, node: Aglyn.NodeSchema<any>) => void
  onFocusVisible?: (e, node: Aglyn.NodeSchema<any>) => void
}

const BreadcrumbItem = observer((props: BreadcrumbItemProps) => {
  const {
    children,
    $id,
    lastItem,
    onClick,
    onMouseEnter,
    onFocusVisible,
    ...rest
  } = props
  const node = Aglyn.canvas.getNode($id)
  const isHovered = Besigner.focus.isNodeHovered(node)
  const { setNodeRef: setDroppableNodeRef } = useLeafDrop(node)

  const handleClick = useCallback(
    (e) => {
      onClick && onClick(e, node)
    },
    [onClick, node],
  )

  const handleMouseEnter = useCallback(
    (e) => {
      onMouseEnter && onMouseEnter(e, node)
    },
    [onMouseEnter, node],
  )

  const handleFocusVisible = useCallback(
    (e) => {
      onFocusVisible && onFocusVisible(e, node)
    },
    [onFocusVisible, node],
  )

  return (
    <MuiButtonBase
      ref={setDroppableNodeRef}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onFocusVisible={handleFocusVisible}
      className={clsx(breadcrumbItemClassKey.root, {
        [breadcrumbItemClassKey.lastItem]: lastItem,
        [breadcrumbItemClassKey.hovered]: isHovered,
      })}
      {...rest}
    >
      <>
        {node?.labelShort}
        {children}
      </>
    </MuiButtonBase>
  )
})

interface BreadcrumbsProps extends Partial<MuiBreadcrumbsProps> {}

const Breadcrumbs = observer((props: BreadcrumbsProps) => {
  const { children, sx, ...rest } = props
  const lastSelected = Besigner.focus.getLastSelected()

  const handleClick = useCallback((e, node: Aglyn.NodeSchema<any>) => {
    Besigner.focus.setSelectedNode(node)
  }, [])

  const handleMouseEnter = useCallback((e, node: Aglyn.NodeSchema<any>) => {
    Besigner.focus.setHoveredNode(node)
  }, [])

  const handleFocusVisible = useCallback((e, node: Aglyn.NodeSchema<any>) => {
    Besigner.focus.setHoveredNode(node)
  }, [])

  return (
    <StyledBreadcrumbs
      separator={null}
      aria-label="breadcrumb"
      sx={sx}
      {...rest}
    >
      {lastSelected?.breadcrumbPath.map(($id) => {
        return (
          <BreadcrumbItem
            key={$id}
            $id={$id}
            onClick={handleClick}
            onMouseEnter={handleMouseEnter}
            onFocusVisible={handleFocusVisible}
            lastItem={lastSelected?.$id === $id}
          />
        )
      })}
    </StyledBreadcrumbs>
  )
})

export interface AppBarBreadcrumbsComponentProps
  extends Partial<MuiAppBarProps> {}

export const AppBarBreadcrumbsComponent = forwardRef<
  any,
  AppBarBreadcrumbsComponentProps
>((props, ref) => {
  const { children, sx, ...rest } = props

  return (
    <MuiAppBar
      ref={ref}
      id="aglyn:besigner-appbar-secondary"
      aria-label="secondary app toolbar"
      position="static"
      color="surface"
      component="header"
      elevation={0}
      sx={mergeSxProps(
        {
          top: 0,
          borderBottomWidth: '1px',
          borderBottomStyle: 'solid',
          borderBottomColor: 'divider',
          [`& .MuiToolbar-root`]: { minHeight: 24 },
        },
        sx,
      )}
      {...rest}
    >
      <MuiToolbar variant="dense" sx={{ px: { xs: 0, sm: 0 } }}>
        <Stack
          direction="row"
          spacing={1}
          sx={{
            alignItems: "center",
            justifyContent: "space-between",
            width: 1
          }}>
          <Breadcrumbs />
          {children}
        </Stack>
      </MuiToolbar>
    </MuiAppBar>
  );
})

AppBarBreadcrumbsComponent.displayName = 'AppBarBreadcrumbsComponent'
AppBarBreadcrumbsComponent.aglyn = true

export default AppBarBreadcrumbsComponent
