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

import { ErrorBoundaryComponent } from '@aglyn/shared-ui-jsx'
import { generateComponentClassKeys, styled } from '@aglyn/shared-ui-theme'
import {
  Card as MuiCard,
  CardActions as MuiCardActions,
  type CardActionsProps,
  CardContent as MuiCardContent,
  type CardContentProps,
  CardHeader as MuiCardHeader,
  type CardHeaderProps,
  type CardProps,
} from '@mui/material'
import clsx from 'clsx'
import { forwardRef } from 'react'

const classKeys = generateComponentClassKeys('AglynWidgetCard', [
  'contentGutterX',
  'contentGutterY',
  'contentBordered',
  'headerCentered',
])

const Card = styled(MuiCard, {
  name: 'AglynWidgetCard',
})(({ theme }) => ({
  '& .MuiCardContent-root': {
    padding: 0,
    ':last-child': {
      paddingBottom: 'initial',
    },
  },
  '& .MuiCardHeader-root': {
    fontWeight: theme.typography.fontWeightBold,
  },
  [`&.${classKeys.contentGutterX}`]: {
    '& .MuiCardContent-root': {
      paddingLeft: theme.spacing(2),
      paddingRight: theme.spacing(2),
      [theme.breakpoints.up('md')]: {
        paddingLeft: theme.spacing(3),
        paddingRight: theme.spacing(3),
      },
    },
  },
  [`&.${classKeys.contentGutterY}`]: {
    '& .MuiCardContent-root': {
      paddingTop: theme.spacing(2),
      paddingBottom: theme.spacing(2),
      // '&:last-child': {paddingBottom: theme.spacing(3)},
    },
  },
  [`&.${classKeys.contentBordered}`]: {
    '& .MuiCardContent-root': {
      borderStyle: 'solid',
      borderColor: theme.palette.divider,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderLeftWidth: 0,
      borderRightWidth: 0,
    },
  },
  [`&.${classKeys.headerCentered}`]: {
    '& .MuiCardHeader-root': {
      marginBottom: theme.spacing(-1),
      alignSelf: 'center',
    },
  },
}))

export interface WidgetCardProps extends CardProps {
  contentGutterX?: boolean
  contentGutterY?: boolean
  contentBordered?: boolean
  headerCentered?: boolean
  header?: JSX.Node
  actions?: CardActionsProps
  lastchildren?: JSX.Children
  HeaderProps?: CardHeaderProps
  ContentProps?: CardContentProps
  ActionProps?: CardActionsProps
}

const WidgetCardComponent = forwardRef<any, WidgetCardProps>((props, ref) => {
  const {
    actions,
    classes,
    children,
    className,
    header,
    lastChildren,
    ActionProps,
    HeaderProps,
    ContentProps,
    contentGutterX,
    contentGutterY,
    headerCentered,
    contentBordered,
    ...rest
  } = props

  const cardClassName = clsx(
    {
      [classKeys.contentGutterX]: Boolean(contentGutterX),
      [classKeys.contentGutterY]: Boolean(contentGutterY),
      [classKeys.contentBordered]: Boolean(contentBordered),
      [classKeys.headerCentered]: Boolean(
        HeaderProps?.subheader || headerCentered,
      ),
    },
    className,
  )

  return (
    <Card ref={ref} className={cardClassName} {...rest}>
      <ErrorBoundaryComponent>
        {header || HeaderProps ? (
          <MuiCardHeader
            title={header}
            titleTypographyProps={{ variant: 'h6' }}
            {...HeaderProps}
          />
        ) : null}
        {children || ContentProps ? (
          <MuiCardContent children={children} {...ContentProps} />
        ) : null}
        {actions || ActionProps ? (
          <MuiCardActions children={actions} {...ActionProps} />
        ) : null}
        {lastChildren}
      </ErrorBoundaryComponent>
    </Card>
  )
})

WidgetCardComponent.displayName = 'WidgetCardComponent'
WidgetCardComponent.aglyn = true

export { WidgetCardComponent }
export default WidgetCardComponent
