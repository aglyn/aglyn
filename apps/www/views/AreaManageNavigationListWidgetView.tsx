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
import WidgetCard, { Props as WidgetCardProps } from '../components/WidgetCard'
import { withAggregatedPageMeta } from '../lib/app-pages'
import { Collapse, IconButton, List, ListItem, ListItemText, ListSubheader } from '@material-ui/core'
import { makeStyles, Theme, createStyles } from '@material-ui/core/styles'
import SvgPathIcon from '@aglyn/common/components/SvgPathIcon'
import Link from 'components/Link'
import clsx from 'clsx'


const useStyles = makeStyles<Theme, Props>((theme) => createStyles({
  subheader: {fontWeight: theme.typography.fontWeightMedium},
  listItem: {
    position: 'relative',
    '&$active': {
      '&:before': {
        content: '" "',
        display: 'block',
        position: 'absolute',
        width: 5,
        height: 5,
        borderRadius: '50%',
        left: theme.spacing(0.75),
        top: 'calc(50% - 2.5px)',
        background: theme.palette.secondary.main
      },
    },
    '&$childActive': {
      '&:after': {
        content: '" "',
        display: 'block',
        position: 'absolute',
        width: 3,
        height: '100%',
        borderRadius: '3px 0 0 3px',
        right: 0,
        top: 0,
        background: theme.palette.secondary.main
      },
    },
    '&$nested': {paddingLeft: theme.spacing(4)},
  },
  collapse: {},
  primary: {},
  preTitle: {
    display: 'block',
    lineHeight: 1,
    marginBottom: theme.spacing(1.5)
  },
  active: {},
  childActive: {},
  nested: {},
  open: {},
}))

export type Props = Partial<WidgetCardProps> & {

}

export default withAggregatedPageMeta<Props>(
  function AreaManageNavigationListWidgetView(props) {
    const classes = useStyles(props)
    const { aggregatedPageMeta, ...rest } = props
    const {
      pathname,
      pageMeta,
      overrideMeta,
      pageAncestors: [, , subArea],
      denormalizedAreaPages,
    } = aggregatedPageMeta
    const [activeCollapse, setActiveCollapse] = React.useState(
      subArea?.id ?? pageMeta?.dynamic ? pageMeta?.parent : pageMeta?.id
    )
    const openAreaCollapse = (id) => (e) => {
      e.preventDefault()
      e.stopPropagation()
      setActiveCollapse(
        prev => prev === id ? null : id
      )
    }
    const isOpen = React.useCallback((item) => {
      return Boolean(activeCollapse === item?.id)
    }, [activeCollapse])

    const isActive = React.useCallback((item) => {
      const path = pageMeta.dynamic ? pageMeta.parent : pathname
      return Boolean(path === item?.id)
    }, [pathname, pageMeta])

    const isChildActive = React.useCallback((item) => {
      const path = pageMeta.dynamic ? pageMeta.parent : pathname
      return Boolean(item.pages?.some(i => path === i?.id))
    }, [pathname, pageMeta])

    const getClass = (itemClass, item, topLvl = true) => clsx(itemClass, {
      [classes.active]: isActive(item),
      [classes.open]: isOpen(item),
      [classes.childActive]: isChildActive(item) && topLvl,
      [classes.nested]: !topLvl,
    })

    return (
      <WidgetCard {...rest}>
        <List
          subheader={(
            <ListSubheader
              children={'Manage Navigation'}
              className={classes.subheader}
            />
          )}
          disablePadding
        >
          {denormalizedAreaPages.map((item, key, arr) => (
            <React.Fragment key={key}>
              <ListItem
                className={getClass(classes.listItem, item)}
                color="inherit"
                component={Link}
                href={item?.id}
                selected={isActive(item)}
                button
                dense
              >
                <ListItemText
                  children={item?.name.long}
                  classes={{ primary: classes.primary }}
                />
                {item?.pages?.length ? (
                  <IconButton
                    disabled={
                      isActive(item) || isChildActive(item)
                    }
                    size={'small'}
                    title={
                      isOpen(item) || isActive(item) || isChildActive(item)
                        ? 'collapse'
                        : 'expand'
                    }
                    onClick={openAreaCollapse(item?.id)}
                  >
                    <SvgPathIcon
                      iconId={
                        isOpen(item) || isActive(item) || isChildActive(item)
                          ? 'chevron-up'
                          : 'chevron-down'
                      }
                    />
                  </IconButton>
                ) : null}
              </ListItem>
              {item?.pages?.length ? (
                <Collapse
                  className={getClass(classes.collapse, item)}
                  in={isOpen(item) || isActive(item) || isChildActive(item)}
                  timeout="auto"
                  unmountOnExit
                >
                  <List component="div" disablePadding>
                    {item.pages.map((item, key, arr) => (
                      <ListItem
                        key={key}
                        className={getClass(classes.listItem, item, false)}
                        color="inherit"
                        component={Link}
                        href={item?.id}
                        selected={isActive(item)}
                        button
                        dense
                      >
                        <ListItemText primary={item?.name.long} />
                      </ListItem>
                    ))}
                  </List>
                </Collapse>
              ) : null}
            </React.Fragment>
          ))}
        </List>
      </WidgetCard>
    )
  }
)
