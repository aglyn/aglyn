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

import {mergeSxProps} from '@aglyn/shared-feature-themes'
import {
  BackgroundImageComponent,
  type BackgroundImageComponentProps,
  ContainerComponent,
} from '@aglyn/shared-ui-jsx'
import {MdiIcon, type MdiIconProps} from '@aglyn/shared-ui-mdi-jsx'
import {Grid, Typography, type TypographyProps} from '@mui/material'
import {type ReactNode, useMemo} from 'react'
import {isElement} from 'react-is'
import BreadcrumbsComponent, {type BreadcrumbsProps} from '../components/breadcrumbs.component'
import {CONTENT_MAX_WIDTH} from '../constants/shared'


export interface DashboardHeaderProps extends Partial<BackgroundImageComponentProps> {
  children?: ReactNode
  breadcrumbItems?: BreadcrumbsProps['items']
  disableBreadcrumbs?: true
  header?: TypographyProps<any, any> & {
    icon?: MdiIconProps | ReactNode
  }
  headerRight?: ReactNode
}

function DashboardHeaderComponent(props: DashboardHeaderProps) {
  const {
    children,
    header: headerProp,
    breadcrumbItems,
    disableBreadcrumbs,
    headerRight,
    ...rest
  } = props

  const {
    children: headerChildren,
    sx: headerSx,
    icon: headerIcon,
    ...header
  } = headerProp || {}

  const breadcrumbs = useMemo(() => {
    return Array.isArray(breadcrumbItems) ? breadcrumbItems : []
  }, [breadcrumbItems])

  return (
    <BackgroundImageComponent
      component="header"
      url="/_static/images/backgrounds/patterns/abstract-wave-lines.svg"
      bgPosition="50% 90%"
      sx={{
        pt: 10,
        pb: 2,
        bgcolor: 'background.secondary',
        color: 'text.primary',
        borderBottomWidth: `1px`,
        borderBottomStyle: 'solid',
        borderBottomColor: 'divider',
      }}
      {...rest}
    >
      <ContainerComponent maxWidth={CONTENT_MAX_WIDTH}>
        <Grid
          container
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          spacing={2}
        >
          <Grid
            item
          >
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
                    fontSize: `1.5em`,
                    borderWidth: `1px`,
                    borderStyle: 'solid',
                    borderColor: 'tertiary.dark',
                    color: 'quaternary.contrastText',
                    bgcolor: 'quaternary.main',
                    borderRadius: (theme) => `${theme.shape.appIconBorderRadius}`,
                  }, headerIcon['sx'])}
                />
              )}
              {headerChildren}
            </Typography>

            {disableBreadcrumbs ? null : (
              <BreadcrumbsComponent
                items={breadcrumbs}
                sx={{
                  my: 2,
                  marginTop: 1,
                  color: 'text.primary',
                  'a': {
                    textDecoration: 'none',
                    ':hover': {
                      color: 'secondary.main',
                    },
                  },
                }}
              />
            )}
          </Grid>

          {headerRight && (
            <Grid item>
              {headerRight}
            </Grid>
          )}
        </Grid>
        {children}
      </ContainerComponent>
    </BackgroundImageComponent>
  )
}
DashboardHeaderComponent.displayName = 'DashboardHeaderComponent'
DashboardHeaderComponent.aglyn = true
DashboardHeaderComponent.defaultProps = {
  breadcrumbItems: [],
  disableBreadcrumbs: false,
  disableDefaultBreadcrumb: false,
}

export {DashboardHeaderComponent}
export default DashboardHeaderComponent
