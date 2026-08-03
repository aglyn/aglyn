/**
 * @license
 * Copyright 2026 Aglyn LLC
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
'use client'

import { AppLink, type AppLinkProps } from '@aglyn/shared-ui-jsx'
import { MdiIcon, type MdiIconProps } from '@aglyn/shared-ui-jsx'
import { mergeSxProps, styled } from '@aglyn/shared-ui-theme'
import {
  Tab as MuiTab,
  type TabProps as MuiTabProps,
  Tabs as MuiTabs,
  type TabsProps as MuiTabsProps,
} from '@mui/material'
import { usePathname } from 'next/navigation'
import { forwardRef, useCallback, useEffect, useMemo, useRef } from 'react'
import { TAB_HEIGHT } from '../constants/shared'

/** Breathing room so the tab doesn't sit flush against a scroll button. */
const SCROLL_INTO_VIEW_PADDING = 24

export interface TabItemProps
  extends MuiTabProps<any, any>,
    Omit<AppLinkProps<'naked'>, 'componentVariant'> {
  icon?: MdiIconProps
}

export const TabItem = styled(MuiTab, {
  name: 'AglynTabItem',
})<TabItemProps>({
  flexDirection: 'row',
  minHeight: TAB_HEIGHT,
  '& > *:first-of-type': {
    marginBottom: 0,
    marginRight: 1,
  },
  '& .MuiTab-labelIcon': {
    minHeight: TAB_HEIGHT - 16,
    minWidth: 'auto',
    paddingLeft: 0,
    paddingRight: 0,
    marginLeft: 4,
    '&:first-of-type': {
      marginLeft: 0,
    },
  },
})

function a11yProps(index: number) {
  return {
    id: `scrollable-auto-tab-${index}`,
    'aria-controls': `scrollable-auto-tabpanel-${index}`,
  }
}

export interface AppLinkTabsProps extends Partial<MuiTabsProps> {
  items?: TabItemProps[]
  activeTab?: string
}

export const AppLinkTabsComponent = forwardRef<any, AppLinkTabsProps>(
  (props, ref) => {
    const { children, items = [], activeTab, sx, ...rest } = props
    const pathname = usePathname()

    const tabValue = useMemo(() => {
      const byPathname = items.find(
        (i) => pathname === i?.href || pathname === i?.id,
      )
      // An explicit activeTab wins, but it must not be able to blank the bar:
      // a stale or wrongly-shaped one used to short-circuit the pathname
      // check entirely, leaving NO tab selected — so no indicator, and
      // nothing for the scroller to bring into view (AGL-649). Fall through
      // to the pathname when it matches nothing.
      if (typeof activeTab !== 'undefined') {
        const byActive = items.find(
          (i) => activeTab === i?.href || activeTab === i?.id,
        )
        return byActive?.href ?? byPathname?.href ?? false
      }
      return byPathname?.href ?? false
    }, [pathname, items, activeTab])

    // Keep the active tab on screen (AGL-649). MUI scrolls the selection into
    // view once on mount, but this bar's plugin-contributed tabs register
    // afterwards — every tab shifts and the one-shot scroll is left short, so
    // on a deep tab you land with the bar parked at the far left. Re-running
    // on the item count catches those late arrivals.
    const rootRef = useRef<HTMLDivElement | null>(null)
    const setRefs = useCallback(
      (node: HTMLDivElement | null) => {
        rootRef.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) (ref as { current: unknown }).current = node
      },
      [ref],
    )

    // Once the user scrolls the bar themselves, leave it where they put it —
    // until they navigate, which is a fresh intent to see the active tab.
    const userScrolledRef = useRef(false)
    useEffect(() => {
      userScrolledRef.current = false
    }, [tabValue])

    const itemCount = items.length
    useEffect(() => {
      if (tabValue === false) return
      const root = rootRef.current
      const scroller = root?.querySelector<HTMLElement>('.MuiTabs-scroller')
      // `.MuiTabs-list` is the current class; `.MuiTabs-flexContainer` was its
      // name before MUI v7. Fall back to the scroller so a future rename
      // degrades to observing the viewport rather than silently doing nothing.
      const strip =
        root?.querySelector<HTMLElement>('.MuiTabs-list') ??
        root?.querySelector<HTMLElement>('.MuiTabs-flexContainer') ??
        scroller
      if (!scroller || !strip) return

      const align = () => {
        if (userScrolledRef.current) return
        const selected =
          root?.querySelector<HTMLElement>('[aria-selected="true"]')
        if (!selected) return
        const view = scroller.getBoundingClientRect()
        const tab = selected.getBoundingClientRect()
        if (tab.right > view.right) {
          scroller.scrollLeft +=
            tab.right - view.right + SCROLL_INTO_VIEW_PADDING
        } else if (tab.left < view.left) {
          scroller.scrollLeft -= view.left - tab.left + SCROLL_INTO_VIEW_PADDING
        }
      }

      // Re-align whenever the strip resizes rather than after a fixed number
      // of frames: MUI does its own one-shot scroll in this commit, and the
      // plugin-contributed tabs and their icons keep changing the strip's
      // width for several frames afterwards — each shift pushes a deep tab
      // back out of view. Observing converges instead of guessing; `align`
      // is a no-op once the tab is fully visible.
      const frame = requestAnimationFrame(align)
      const observer = new ResizeObserver(align)
      observer.observe(strip)
      observer.observe(scroller)
      return () => {
        cancelAnimationFrame(frame)
        observer.disconnect()
      }
    }, [tabValue, itemCount])

    // Only genuinely user-driven gestures count — a programmatic scrollLeft
    // write also emits `scroll`, so listening for that would immediately
    // disable the very behaviour above.
    const markUserScrolled = useCallback(() => {
      userScrolledRef.current = true
    }, [])
    // The arrow buttons are the third way to scroll the bar by hand.
    const handlePointerDown = useCallback((event: { target: unknown }) => {
      const target = event.target as HTMLElement | null
      if (target?.closest?.('.MuiTabs-scrollButtons')) {
        userScrolledRef.current = true
      }
    }, [])

    return (
      <MuiTabs
        ref={setRefs}
        onWheel={markUserScrolled}
        onTouchMove={markUserScrolled}
        onPointerDown={handlePointerDown}
        aria-label="area navigation"
        indicatorColor="primary"
        scrollButtons="auto"
        textColor="inherit"
        value={tabValue}
        variant="scrollable"
        sx={mergeSxProps(
          {
            minHeight: TAB_HEIGHT,
            alignItems: 'center',
            '& .MuiTabs-flexContainer': {
              alignItems: 'center',
            },
            '& .MuiTabs-indicator': {
              height: '3px',
              backgroundColor: 'unset',
              '&:after': {
                borderRadius: '3px 3px 0 0',
                content: '" "',
                display: 'block',
                position: 'absolute',
                left: 0,
                top: 0,
                right: 0,
                mx: 'auto',
                width: 0.8,
                height: 1,
                backgroundColor: 'primary.light',
              },
            },
          },
          sx,
        )}
        {...rest}
      >
        {children}
        {items.map(({ icon, href, ...item }, key) => (
          <TabItem
            key={item.key ?? item.id ?? key}
            href={href ?? ''}
            value={href ?? item.key ?? item.id ?? key}
            icon={(icon?.path ? <MdiIcon {...icon} /> : undefined) as any}
            componentVariant="naked"
            component={AppLink}
            color="inherit"
            underline="none"
            wrapped
            {...a11yProps(key)}
            {...item}
          />
        ))}
      </MuiTabs>
    )
  },
)
AppLinkTabsComponent.displayName = 'AppLinkTabsComponent'
AppLinkTabsComponent.aglyn = true

export default AppLinkTabsComponent
