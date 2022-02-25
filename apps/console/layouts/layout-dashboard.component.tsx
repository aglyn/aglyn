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

import {BUILD_ID, PACKAGE_VERSION} from '@aglyn/shared-data-enums'
import {darken, mergeSxProps} from '@aglyn/shared-feature-themes'
import {
  AppLink,
  BackgroundImageComponent,
  GridButtons,
  GridItems,
  type GridItemsProps,
} from '@aglyn/shared-ui-jsx'
import {MdiIcon, type MdiIconProps} from '@aglyn/shared-ui-mdi-jsx'
import {Box, Container, Typography, TypographyProps} from '@mui/material'
import {type ReactNode} from 'react'
import {isElement} from 'react-is'
import BreadcrumbsComponent, {type BreadcrumbsProps} from '../components/breadcrumbs.component'
import CopyrightComponent from '../components/copyright.component'
import {tailNavigation} from '../const'
import LayoutConsoleComponent from './layout-console.component'


export const CONTENT_MAX_WIDTH = 'xl'
export const FOOTER_MAX_WIDTH = 'xl'

export interface LayoutDashboardProps {
  children?: ReactNode
  ContentGridItemsProps?: GridItemsProps
  items?: GridItemsProps['items']
  breadcrumbItems?: BreadcrumbsProps['items']
  header?: TypographyProps<any, any> & {
    icon?: MdiIconProps | ReactNode
  }
}

function LayoutDashboardComponent(props: LayoutDashboardProps) {
  const {
    children,
    header: headerProp,
    ContentGridItemsProps,
    breadcrumbItems,
    items,
  } = props

  const {
    children: headerChildren,
    sx: headerSx,
    icon: headerIcon,
    ...header
  } = headerProp || {}

  return (
    <>
      <main /*className={classes.content}*/>
        <BackgroundImageComponent
          component="header"
          url="/_static/images/backgrounds/patterns/abstract-wave-lines.svg"
          bgPosition="50% 90%"
          sx={{
            pt: 10,
            bgcolor: 'background.secondary',
            color: 'text.primary',
            borderBottomWidth: `1px`,
            borderBottomStyle: 'solid',
            borderBottomColor: 'divider',
          }}
        >
          <Container maxWidth={CONTENT_MAX_WIDTH}>
            <Typography
              component="h1"
              variant="h4"
              sx={mergeSxProps({
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
              }, headerSx)}
              {...header}
            >
              {!headerIcon || isElement(headerIcon) ? headerIcon : (
                <MdiIcon
                  color="inherit"
                  {...headerIcon}
                  sx={mergeSxProps({
                    padding: 1,
                    mr: 1.75,
                    ml: -0.5,
                    fontSize: `1.5em`,
                    borderWidth: `1px`,
                    borderStyle: 'solid',
                    borderColor: 'tertiary.dark',
                    color: 'quaternary.contrastText',
                    bgcolor: 'quaternary.main',
                    borderRadius: (theme) => theme.shape.appIconBorderRadius,
                  }, headerIcon['sx'])}
                />
              )}
              {headerChildren}
            </Typography>
            <BreadcrumbsComponent
              items={breadcrumbItems || []}
              sx={{
                my: 2,
                marginTop: 1,
                color: (theme) => darken(
                  theme.palette.getContrastText(theme.palette.background.secondary),
                  0.12,
                ),
                ['& .AglynBreadcrumbs-item']: {
                  color: 'inherit',
                  ['&.AglynBreadcrumbs-last']: {
                    fontWeight: 'fontWeightMedium',
                    color: (theme) => theme.palette.getContrastText(theme.palette.background.secondary),
                  },
                },
              }}
            />
          </Container>
        </BackgroundImageComponent>

        <Container maxWidth={CONTENT_MAX_WIDTH}>
          {items || ContentGridItemsProps ? (
            <GridItems
              items={items}
              spacing={3}
              {...ContentGridItemsProps}
            />
          ) : null}
          {children}
        </Container>
      </main>
      <footer>
        <Container maxWidth={FOOTER_MAX_WIDTH}>
          <Box
            component={'div'}
            sx={{
              mt: 6,
              pb: 1,
              pt: 2,
              borderTop: 1,
              display: 'flex',
              flexWrap: 'wrap',
              borderColor: 'divider',
              alignItems: 'center',
            }}
          >
            <Box
              component={'div'}
              sx={{
                flexGrow: 1,
                display: 'flex',
              }}
            >
              <CopyrightComponent />
            </Box>
            <Box
              component={'div'}
              sx={{display: 'flex'}}
            >
              <GridButtons
                spacing={1}
                ItemComponent={AppLink}
                items={tailNavigation.map((i) => ({
                  size: 'small',
                  componentVariant: 'button',
                  ...i,
                }))}
              />
            </Box>

            <Box
              alignItems="space-around"
              display="flex"
              flex="1 1 auto"
              flexBasis="100%"
              justifyContent="center"
            >
              <Typography align="center" color="textSecondary" variant="overline">
                <span>{`Version ${PACKAGE_VERSION}`}</span>
                {' '}
                <span>{`(${BUILD_ID})`}</span>
              </Typography>
            </Box>
          </Box>
        </Container>
      </footer>
    </>
  )
}
LayoutDashboardComponent.displayName = 'LayoutDashboardComponent'
LayoutDashboardComponent.layoutComponent = LayoutConsoleComponent

export {LayoutDashboardComponent}
export default LayoutDashboardComponent
