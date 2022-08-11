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

import { getComponentSchema } from '@aglyn/core-data-app'
import { NodeId } from '@aglyn/core-data-foundation'
import {
  useAglynAppContext,
  useAglynCanvasElementHierarchy,
  useAglynElementData,
  useAglynElementLabel,
} from '@aglyn/core-feature-renderer'
import { useForkedRefs } from '@aglyn/shared-ui-jsx'
import {
  generateComponentClassKeys,
  mergeSxProps,
  styled,
} from '@aglyn/shared-ui-theme'
import {
  AppBar as MuiAppBar,
  type AppBarProps as MuiAppBarProps,
  Breadcrumbs as MuiBreadcrumbs,
  BreadcrumbsProps as MuiBreadcrumbsProps,
  Link,
  type LinkProps,
  Stack,
  Toolbar as MuiToolbar,
} from '@mui/material'
import clsx from 'clsx'
import { forwardRef, useCallback, useMemo } from 'react'
import { useAglynCanvasSetHovered } from '../hooks/use-aglyn-canvas-hovered'
import useAglynCanvasSelected, {
  useAglynCanvasSetSelected,
} from '../hooks/use-aglyn-canvas-selected'
import useLeafDrop from '../hooks/use-leaf-drop'

const breadcrumbItemClassKey = generateComponentClassKeys('BreadcrumbItem', [
  'root',
  'lastItem',
])

const BreadcrumbLink = styled(Link)<LinkProps>(({ theme }) => ({
  transition: theme.transitions.create('color', {
    duration: theme.transitions.duration.short,
  }),
  [`:hover`]: {
    color: theme.palette.secondary.light,
  },
  [`&.${breadcrumbItemClassKey.lastItem}`]: {
    cursor: 'initial',
    [`:hover`]: {
      color: theme.palette.tertiary.light,
    },
  },
}))

export interface BreadcrumbItemProps extends Partial<LinkProps<'button'>> {
  item: {
    $id: NodeId
  }
  lastItem?: boolean
}

const BreadcrumbItem = forwardRef<any, BreadcrumbItemProps>(
  (props, forwardRef) => {
    const { children, item, lastItem, ...rest } = props
    const { $id } = item
    const app = useAglynAppContext()
    const setSelected = useAglynCanvasSetSelected()
    const setHovered = useAglynCanvasSetHovered()
    const label = useAglynElementLabel($id)
    const componentId = useAglynElementData($id, 'componentId')
    const bundleId = useAglynElementData($id, 'bundleId')
    const trail = useAglynCanvasElementHierarchy($id)
    const dndData = useMemo(() => {
      const componentSchema = getComponentSchema(app, { componentId, bundleId })
      return {
        $id,
        componentId,
        bundleId,
        trail,
        restrictParent: componentSchema?.restrictParent,
        restrictChildren: componentSchema?.restrictChildren,
      }
    }, [app, componentId, bundleId, $id, trail])
    const [, dropRef] = useLeafDrop(dndData)
    const ref = useForkedRefs<any>(forwardRef, dropRef)

    const handleClick = useCallback(
      (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!lastItem) {
          setSelected({ $id })
        }
      },
      [$id, lastItem, setSelected],
    )

    const handleMouseEnter = useCallback(() => {
      setHovered({ $id })
    }, [$id, setHovered])

    return (
      <BreadcrumbLink
        ref={ref as any}
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
          {label}
          {children}
        </>
      </BreadcrumbLink>
    )
  },
)

interface BreadcrumbsProps extends Partial<MuiBreadcrumbsProps> {}

const Breadcrumbs = forwardRef<any, BreadcrumbsProps>((props, ref) => {
  const { children, sx, ...rest } = props
  const [selected] = useAglynCanvasSelected()
  const ids = useAglynCanvasElementHierarchy(selected?.$id)

  return (
    <MuiBreadcrumbs
      ref={ref}
      separator="›"
      aria-label="breadcrumb"
      sx={mergeSxProps({ lineHeight: 1, fontSize: 11 }, sx)}
      {...rest}
    >
      {ids.map(($id, index, arr) => (
        <BreadcrumbItem
          key={$id ?? index}
          item={{ $id }}
          lastItem={index === arr.length - 1}
        />
      ))}
    </MuiBreadcrumbs>
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
      <MuiToolbar variant="dense" sx={{ px: { xs: 2, sm: 2 } }}>
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
