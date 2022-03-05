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

import {styled} from '@aglyn/shared-feature-themes'
import {_isEqualitySameType} from '@aglyn/shared-util-guards'
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
import {forwardRef, type ReactNode} from 'react'
import ErrorBoundaryComponent from './error-boundary.component'


const Card = styled(MuiCard, {
  name: 'AglynWidgetCard',
  shouldForwardProp(propName) {
    return !_isEqualitySameType(
      propName,
      'contentGutterX',
      'contentGutterY',
      'headerCentered',
      'contentBordered',
    )
  },
})<WidgetCardProps>(({
  theme,
  contentGutterX,
  contentGutterY,
  headerCentered,
  contentBordered,
}) => ({
  ['& .MuiCardContent-root']: {
    padding: 0,
    ...(!contentGutterX ? {} : {
      paddingLeft: theme.spacing(2),
      paddingRight: theme.spacing(2),
      [theme.breakpoints.up('md')]: {
        paddingTop: theme.spacing(3),
        paddingBottom: theme.spacing(3),
      },
    }),
    ...(!contentGutterY ? {} : {
      paddingTop: theme.spacing(2),
      paddingBottom: theme.spacing(2),
      '&:last-child': {paddingBottom: theme.spacing(3)},
    }),
    ...(!contentBordered ? {} : {
      borderStyle: 'solid',
      borderColor: theme.palette.divider,
      borderTopWidth: 1,
      borderBottomWidth: 1,
    }),
  },
  ['& .MuiCardHeader-root']: {
    fontWeight: theme.typography.fontWeightBold,
    ...(!headerCentered ? {} : {
      marginBottom: theme.spacing(-1),
      alignSelf: 'center',
    }),
  },
}))

export interface WidgetCardProps extends CardProps {
  contentGutterX?: boolean
  contentGutterY?: boolean
  contentBordered?: boolean
  headerCentered?: boolean
  header?: ReactNode
  actions?: CardActionsProps
  after?: ReactNode
  HeaderProps?: CardHeaderProps
  ContentProps?: CardContentProps
  ActionProps?: CardActionsProps
}

const WidgetCardComponent = forwardRef<any, WidgetCardProps>(
  function RefRenderFn(props, ref) {
    const {
      actions,
      classes,
      children,
      className,
      header,
      after,
      ActionProps,
      HeaderProps,
      ContentProps,
      ...rest
    } = props

    return (
      <Card
        ref={ref}
        headerCentered={Boolean(HeaderProps?.subheader)}
        {...rest}
      >
        <ErrorBoundaryComponent>
          {header || HeaderProps ? (
            <MuiCardHeader
              title={header}
              titleTypographyProps={{variant: 'h6'}}
              {...HeaderProps}
            />
          ) : null}
          {children || ContentProps ? (
            <MuiCardContent
              children={children}
              {...ContentProps}
            />
          ) : null}
          {actions || ActionProps ? (
            <MuiCardActions
              children={actions}
              {...ActionProps}
            />
          ) : null}
          {after}
        </ErrorBoundaryComponent>
      </Card>
    )
  },
)

WidgetCardComponent.displayName = 'AglynWidgetCard'

export {WidgetCardComponent}
export default WidgetCardComponent
