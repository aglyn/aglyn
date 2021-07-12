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

import React from 'react'
import { withStyles, WithStyles, Theme, createStyles } from '@material-ui/core/styles'
import MuiBreadcrumb, { BreadcrumbsProps as MuiBreadcrumbsProps } from '@material-ui/core/Breadcrumbs'
import Link, { LinkProps as LinkProps } from './Link'
import clsx from 'clsx'
import { SvgPathIcon, SvgPathIconProps } from '@aglyn/shared/ui/react'
import Typography from '@material-ui/core/Typography'


const styles = (theme: Theme) => createStyles({
  root: {
    display: 'flex',
    alignItems: 'center',
    minHeight: theme.spacing(4),
  },
  item: {
    display: 'flex',
    cursor: 'pointer',
  },
  disabled: { cursor: 'default' },
  last: {
    opacity: 0.68,
    textDecoration: 'none',
  },
  centered: { alignItems: 'center' },
  icon: {
    marginRight: theme.spacing(0.5),
    width: 20,
    height: 20,
  },
})

export type ItemProps = LinkProps & { icon?: SvgPathIconProps, disabled?: boolean }
export type Props = MuiBreadcrumbsProps & {
  items: ItemProps[]
  centerIcons?: boolean
}

const Breadcrumbs = React.forwardRef<any, Props & WithStyles<typeof styles>>(
  function RefRenderFn(props, ref) {
    const { classes, className, centerIcons, children, items, ...rest } = props

    const Item = React.useMemo(() => (
      React.forwardRef<any, ItemProps & { isLast: boolean }>(
        function RefRenderFn(itemProps, ref) {
          const { icon, className, isLast, disabled, ...item } = itemProps
          const itemClass = clsx(classes.item, {
            [classes.centered]: Boolean(centerIcons),
            [classes.disabled]: Boolean(disabled || isLast),
            [classes.last]: Boolean(isLast),
          }, className)

          const ItemComponent = isLast ? Typography : Link

          return (
            <ItemComponent ref={ref} className={itemClass} {...item}>
              {!icon ? undefined : <SvgPathIcon className={classes.icon} {...icon} />}
              {item.children}
            </ItemComponent>
          )
        },
      )
    ), [classes, centerIcons])

    return (
      <MuiBreadcrumb
        ref={ref}
        aria-label="breadcrumb"
        className={clsx(classes.root, className)}
        {...rest}
      >
        {items.map((item, key) => (
          <Item {...item} key={key} isLast={key === items.length - 1} />
        ))}
        {children}
      </MuiBreadcrumb>
    )
  },
)

Breadcrumbs.displayName = 'Breadcrumbs'

export default withStyles(styles, { name: 'Breadcrumbs' })(Breadcrumbs)
