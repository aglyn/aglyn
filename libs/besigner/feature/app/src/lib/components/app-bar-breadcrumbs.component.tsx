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
  BreadcrumbsProps as MuiBreadcrumbsProps,
  Link,
  type LinkProps,
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
])

const StyledBreadcrumbs = styled(MuiBreadcrumbs)(({ theme }) => ({
  lineHeight: 1,
  fontSize: 11,
  overflowX: 'auto',

  [`& .${breadcrumbsClasses.ol}`]: {
    flexWrap: 'nowrap',
    whiteSpace: 'nowrap',
  },
  [`& .${breadcrumbsClasses.separator}`]: {
    margin: 0,
    padding: theme.spacing(0.25),
    // width: '0px',
    // height: '100%',
    // background: 'transparent',
    // borderLeft: `0.45em solid ${theme.palette.divider}`,
    // borderBottom: '1em solid transparent',
    // borderTop: '1em solid transparent',
  },
  [`& .${breadcrumbsClasses.li}`]: {
    [`& .${breadcrumbItemClassKey.root}`]: {
      padding: theme.spacing(0.75),
      background: 'transparent',
      paddingLeft: '1em',
      paddingRight: '1em',

      [`&:hover`]: {
        color: theme.palette.secondary.contrastText,
        background: alpha(
          theme.palette.secondary.main,
          theme.palette.action.hoverOpacity + 0.4,
        ),
      },

      [`&.${breadcrumbItemClassKey.lastItem}`]: {
        cursor: 'initial',
        [`:hover`]: {
          color: theme.palette.tertiary.contrastText,
          background: alpha(
            theme.palette.tertiary.light,
            theme.palette.action.hoverOpacity + 0.4,
          ),
        },
      },
    },
  },
}))

const BreadcrumbLink = styled(Link)<LinkProps>(({ theme }) => ({}))

export interface BreadcrumbItemProps extends Partial<LinkProps<'button'>> {
  nodeId: Aglyn.NodeId
  lastItem?: boolean
}

const BreadcrumbItem = observer((props: BreadcrumbItemProps) => {
  const { children, nodeId, lastItem, ...rest } = props
  const node = Aglyn.screen.getNode(nodeId)
  // const schema = node?.componentSchema
  // const dndData = useMemo(() => {
  //   return {
  //     $id: nodeId,
  //     componentId: node?.componentId,
  //     pluginId: schema?.pluginId,
  //     trail: node?.breadcrumbPath,
  //     restrictParent: schema?.restrictParent,
  //     restrictChildren: schema?.restrictChildren,
  //   }
  // }, [nodeId, node, schema])
  const [, dropRef] = useLeafDrop({ node })

  const handleClick = useCallback(
    (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (!lastItem) Besigner.focus.setSelectedNode(node)
    },
    [lastItem, node],
  )

  const handleMouseEnter = useCallback(() => {
    Besigner.focus.setHoveredNode(node)
  }, [node])

  return (
    <BreadcrumbLink
      ref={dropRef}
      color="textSecondary"
      {...({ component: 'button' } as any)}
      fontSize="inherit"
      underline={lastItem ? 'none' : undefined}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      className={clsx(breadcrumbItemClassKey.root, {
        [breadcrumbItemClassKey.lastItem]: Boolean(lastItem),
      })}
      {...rest}
    >
      <>
        {node?.labelShort}
        {children}
      </>
    </BreadcrumbLink>
  )
})

interface BreadcrumbsProps extends Partial<MuiBreadcrumbsProps> {}

const Breadcrumbs = observer((props: BreadcrumbsProps) => {
  const { children, sx, ...rest } = props
  const lastSelected = Besigner.focus.state.lastSelected

  return (
    <StyledBreadcrumbs separator="›" aria-label="breadcrumb" sx={sx} {...rest}>
      {lastSelected?.breadcrumbPath.map(($id, index, arr) => (
        <BreadcrumbItem
          key={$id ?? index}
          nodeId={$id}
          lastItem={index === arr.length - 1}
        />
      ))}
    </StyledBreadcrumbs>
  )
})

export interface AppBarBreadcrumbsComponentProps
  extends Partial<MuiAppBarProps> {}

const AppBarBreadcrumbsComponent = forwardRef<
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
          alignItems="center"
          justifyContent="space-between"
          width={1}
          spacing={1}
        >
          <Breadcrumbs />
          {children}
        </Stack>
      </MuiToolbar>
    </MuiAppBar>
  )
})

AppBarBreadcrumbsComponent.displayName = 'AppBarBreadcrumbsComponent'
AppBarBreadcrumbsComponent.aglyn = true
AppBarBreadcrumbsComponent.defaultProps = {}

export { AppBarBreadcrumbsComponent }
export default AppBarBreadcrumbsComponent
