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

import {ElementId} from '@aglyn/core-data-framework'
import {useAglynCanvasElementHierarchy, useAglynElementLabel} from '@aglyn/core-feature-renderer'
import {mergeSxProps} from '@aglyn/shared-ui-theme'
import {
  AppBar as MuiAppBar,
  type AppBarProps as MuiAppBarProps,
  Breadcrumbs,
  Link,
  LinkProps,
  Stack,
  Toolbar as MuiToolbar,
} from '@mui/material'
import {forwardRef, useCallback} from 'react'
import {useAglynCanvasSetHovered} from '../hooks/use-aglyn-canvas-hovered'
import useAglynCanvasSelected, {useAglynCanvasSetSelected} from '../hooks/use-aglyn-canvas-selected'


interface BreadcrumbItemProps extends LinkProps<'button'> {
  $id: ElementId
  isLast?: boolean
}

const BreadcrumbItem = forwardRef<any, BreadcrumbItemProps>(
  function RefRenderFn(props, ref) {
    const {children, $id, isLast, ...rest} = props
    const setSelected = useAglynCanvasSetSelected()
    const setHovered = useAglynCanvasSetHovered()
    const label = useAglynElementLabel($id)

    const handleClick = useCallback(() => {
      if (isLast) return
      setSelected({$id})
    }, [$id, isLast, setSelected])

    const handleMouseEnter = useCallback(() => {
      setHovered({$id})
    }, [$id, setHovered])

    return (
      <Link
        ref={ref}
        color="textSecondary"
        component="button"
        underline={isLast ? 'none' : undefined}
        onClick={handleClick}
        fontSize="inherit"
        onMouseEnter={handleMouseEnter}
        sx={!isLast ? undefined : {
          cursor: 'initial',
        }}
        {...rest}
      >
        {label}
        {children}
      </Link>
    )
  },
)

export interface AppBarBreadcrumbsComponentProps extends Partial<MuiAppBarProps> {}

const AppBarBreadcrumbsComponent = forwardRef<any, AppBarBreadcrumbsComponentProps>(
  function RefRenderFn(props, ref) {
    const {children, sx, ...rest} = props

    const [selected] = useAglynCanvasSelected()
    const breadcrumbs = useAglynCanvasElementHierarchy(selected?.$id)

    return (
      <MuiAppBar
        ref={ref}
        id="aglyn:besigner-appbar-secondary"
        aria-label="secondary app toolbar"
        position="static"
        color="inherit"
        component="header"
        elevation={0}
        sx={mergeSxProps(
          {
            top: 0,
            borderBottomWidth: '1px',
            borderBottomStyle: 'solid',
            borderBottomColor: 'divider',
            [`& .MuiToolbar-root`]: {minHeight: 24},
          },
          sx,
        )}
        {...rest}
      >
        <MuiToolbar variant="dense" sx={{px: {xs: 2, sm: 2}}}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            width={1}
            spacing={1}
          >
            <Breadcrumbs
              separator="›"
              aria-label="breadcrumb"
              sx={{lineHeight: 1, fontSize: 11}}
            >
              {breadcrumbs.map(($id, index, arr) => (
                <BreadcrumbItem
                  key={$id}
                  $id={$id}
                  isLast={index + 1 === arr.length}
                />
              ))}
            </Breadcrumbs>
            {children}
          </Stack>
        </MuiToolbar>
      </MuiAppBar>
    )
  },
)

AppBarBreadcrumbsComponent.displayName = 'AppBarBreadcrumbsComponent'
AppBarBreadcrumbsComponent.aglyn = true
AppBarBreadcrumbsComponent.defaultProps = {}

export {AppBarBreadcrumbsComponent}
export default AppBarBreadcrumbsComponent
