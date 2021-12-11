/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import {generateComponentClassKeys, styled} from '@aglyn/shared-feature-themes'
import Card, {CardProps} from '@mui/material/Card'
import CardActions, {CardActionsProps} from '@mui/material/CardActions'
import MuiCardContent, {CardContentProps} from '@mui/material/CardContent'
import MuiCardHeader, {CardHeaderProps} from '@mui/material/CardHeader'
import clsx from 'clsx'
import React, {forwardRef} from 'react'
import ErrorBoundary from './ErrorBoundary'


const classKey = generateComponentClassKeys('AglynCard', [
  'contentGuttersX',
  'contentGuttersY',
  'contentBordered',
  'headerCentered',
])

const CardContent = styled(MuiCardContent, {
  name: 'AglynCardContent',
})(({theme}) => ({
  padding: 0,

  [`&.${classKey.contentGuttersX}`]: {
    paddingLeft: theme.spacing(2),
    paddingRight: theme.spacing(2),
    [theme.breakpoints.up('md')]: {
      paddingTop: theme.spacing(3),
      paddingBottom: theme.spacing(3),
    },
  },
  [`&.${classKey.contentGuttersY}`]: {
    paddingTop: theme.spacing(2),
    paddingBottom: theme.spacing(2),
    '&:last-child': {paddingBottom: theme.spacing(3)},
  },
  [`&.${classKey.contentBordered}`]: {
    border: `1px solid ${theme.palette.divider}`,
    borderRight: 'none',
    borderLeft: 'none',
  },
}))

const CardHeader = styled(MuiCardHeader, {
  name: 'AglynCardHeader',
})(({theme}) => ({
  fontWeight: theme.typography.fontWeightBold,

  [`&.${classKey.headerCentered}`]: {
    marginBottom: theme.spacing(-1),
    alignSelf: 'center',
  },
}))

export interface WidgetCardProps extends CardProps {
  header?: string
  actions?: CardActionsProps
  guttersX?: boolean
  guttersY?: boolean
  bordered?: boolean
  HeaderProps?: CardHeaderProps
  ContentProps?: CardContentProps
  ActionProps?: CardActionsProps
}

const WidgetCard = forwardRef<any, WidgetCardProps>(
  function RefRenderFn(props, ref) {
    const {
      actions,
      bordered,
      classes,
      children,
      className,
      guttersX,
      guttersY,
      header,
      ActionProps,
      HeaderProps,
      ContentProps,
      ...rest
    } = props

    const headerClassName = clsx({
      [classKey.headerCentered]: !props.HeaderProps?.subheader,
    }, HeaderProps?.className)

    const contentClassName = clsx({
      [classKey.contentGuttersX]: Boolean(guttersX),
      [classKey.contentGuttersY]: Boolean(guttersY),
      [classKey.contentBordered]: Boolean(bordered),
    }, ContentProps?.className)

    return (
      <Card
        ref={ref}
        sx={{mb: 3}}
        {...rest}
      >
        {header || HeaderProps ? (
          <CardHeader
            {...HeaderProps}
            title={header}
            className={headerClassName}
            titleTypographyProps={{
              ...HeaderProps?.titleTypographyProps,
              variant: 'h6',
            }}
          />
        ) : null}
        <CardContent {...ContentProps} className={contentClassName}>
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </CardContent>
        {actions || ActionProps ? (
          <CardActions {...ActionProps}>
            <ErrorBoundary>
              {actions}
            </ErrorBoundary>
          </CardActions>
        ) : null}
      </Card>
    )
  },
)

WidgetCard.displayName = 'WidgetCard'

export default WidgetCard
