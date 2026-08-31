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
      /*
       * A tab stays active on its own SUB-ROUTES (AGL-2501).
       *
       * This matched the pathname exactly, which is correct only while every
       * tab is a leaf. It is not: a tabbed section that becomes real routes —
       * `/settings` → `/settings/profile` — leaves the bar with nothing
       * selected the moment a reader opens a section, so the indicator
       * vanishes and the scroller has nothing to bring into view. The reader
       * is not "nowhere"; they are one level inside a tab that is right there.
       *
       * LONGEST prefix wins, so a nested tab beats its own parent — `/hosts`
       * and `/hosts/x/admin` can both be tabs and the deeper one is chosen.
       * The boundary check is what stops `/settings` claiming
       * `/settings-export`: a prefix is only a prefix at a path separator.
       */
      const onPath = (href: string | undefined) => {
        if (!href) return false
        if (pathname === href) return true
        return pathname.startsWith(href === '/' ? href : `${href}/`)
      }
      const byPathname = items
        .filter((i) => onPath(i?.href) || onPath(i?.id))
        .sort(
          (a, b) => (b?.href ?? b?.id ?? '').length - (a?.href ?? a?.id ?? '').length,
        )[0]
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

      // Effects run after the DOM is written and before paint, so what
      // `align` measures here is already the geometry about to be painted.
      // This call, and the visibility listener below, are what make the bar
      // work AT ALL in a tab that is not in front.
      //
      // `requestAnimationFrame` and `ResizeObserver` are both driven by the
      // rendering pipeline, and a background tab does not run one. That is
      // easy to read as "delayed" and is not: measured on the host bar, the
      // effect ran seven times, every frame callback was cancelled by the
      // next re-render before it could fire, and the scroller's width went
      // from 1652 to 1599 with the observer delivering ZERO callbacks. A
      // console opened with a middle-click or restored with the window
      // therefore never aligned once, and switching to it did not help —
      // nothing resizes at that point, so the observer has nothing to report
      // and the bar stays parked wherever it mounted.
      align()

      // The frame callback still earns its place in front, where a paint can
      // move things after the effect: MUI does its own one-shot scroll in
      // this commit, and the plugin-contributed tabs and their icons keep
      // changing widths for several frames afterwards.
      const frame = requestAnimationFrame(align)
      const observer = new ResizeObserver(align)
      observer.observe(strip)
      observer.observe(scroller)

      // Coming to the front is a layout event in its own right: it is the
      // first moment a tab that mounted hidden has a settled strip AND a
      // rendering pipeline to measure it against.
      const doc = root?.ownerDocument
      doc?.addEventListener('visibilitychange', align)

      return () => {
        cancelAnimationFrame(frame)
        observer.disconnect()
        doc?.removeEventListener('visibilitychange', align)
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
