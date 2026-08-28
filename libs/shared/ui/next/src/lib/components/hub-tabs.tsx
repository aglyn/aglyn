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

import { AppLink, CardDisplay, GridItems } from '@aglyn/shared-ui-jsx'
import { TabContext, TabList, TabPanel } from '@mui/lab'
import { Tab, Tabs, useMediaQuery, useTheme } from '@mui/material'
import { usePathname } from 'next/navigation'
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useTabParam } from '../hooks/use-tab-param'

/**
 * The rail's own shape, shared by BOTH modes below (AGL-693).
 *
 * `HubTabs` and `HubSections` are two ways of choosing a section and one way
 * of DRAWING that choice. Duplicating the card, the orientation switch and the
 * tab `sx` is how they drift into looking like two different products, which
 * is exactly what happened the first time this rail was rebuilt by hand.
 */
function useRailLayout() {
  const theme = useTheme()
  const stacked = useMediaQuery(theme.breakpoints.down('sm'))
  return {
    stacked,
    /** Props every rail passes to its `Tabs`/`TabList`. */
    tabsProps: {
      orientation: stacked ? ('horizontal' as const) : ('vertical' as const),
      variant: stacked ? ('scrollable' as const) : ('standard' as const),
      allowScrollButtonsMobile: true,
      textColor: 'primary' as const,
      indicatorColor: 'primary' as const,
      sx: {
        ['.MuiTab-root']: {
          alignItems: stacked ? 'center' : 'start',
          maxWidth: 'unset',
          textTransform: 'none',
        },
      },
    },
  }
}

export interface HubTab {
  id: string
  label: string
  content: ReactNode
}

export interface HubTabsProps {
  tabs: HubTab[]
  /** Left nav card header (defaults to "Navigation"). */
  navHeader?: string
  /**
   * Defer mounting a panel's content until its tab is first activated, then
   * keep it mounted (AGL-785). Off by default so the standard behavior —
   * every panel mounted up front, subscriptions always live — is unchanged.
   * Opt in when the tabs host several data-heavy panels whose subscriptions
   * would otherwise all settle at once on load: mounting only the active
   * panel keeps that first-paint re-render burst small enough not to trip
   * React's nested-update limit. Panels stay mounted once visited, so
   * switching back is still instant.
   */
  lazy?: boolean
}

/**
 * Hub tab strip (AGL-354/382): the host-setup two-column pattern as a
 * shared component — a left "Navigation" CardDisplay with a vertical
 * TabList, content on the right. Collapses to horizontal tabs on small
 * screens. The active tab mirrors into the `?tab=` query param (shallow
 * replace) so hub views deep-link and survive back/forward; panels are
 * kept mounted so content and its data subscriptions are always present
 * (unless `lazy`, which defers un-visited panels — see the prop).
 */
export function HubTabs(props: HubTabsProps) {
  const { tabs, navHeader = 'Navigation', lazy = false } = props
  const { tabsProps } = useRailLayout()
  /*
   * The SHARED resolver, not a second reading of the same parameter
   * (AGL-2486). This rail used to hold the incoming id in `useState`, which
   * reads it once and then stops: back and forward are navigations between
   * two states of one mounted page, and a link into another section of a page
   * already open changes the parameter without remounting anything. Either
   * one left the rail on the old tab while the URL named a different one.
   *
   * `ids` is the tabs that exist right now, so an id naming a tab this hub
   * does not render falls back to the first rather than selecting a panel
   * nothing draws — which matters because several hubs build their tab list
   * from entitlements and render a different set per org.
   */
  const tabIds = useMemo(() => tabs.map((item) => item.id), [tabs])
  const { tab, onTabChange } = useTabParam({ ids: tabIds })
  // Which tabs have ever been active — the mount set when `lazy`. Seeded with
  // the tab resolved for first paint so it (and only it) mounts.
  const [activated, setActivated] = useState<Set<string>>(
    () => new Set(tab ? [tab] : []),
  )

  const handleChange = useCallback(
    (event: unknown, value: string) => {
      setActivated((prev) => (prev.has(value) ? prev : new Set(prev).add(value)))
      onTabChange(event, value)
    },
    [onTabChange],
  )

  /*
   * A panel reached by URL rather than by click has to stay in the mount set
   * too. `handleChange` is the only thing that grows the set, and it does not
   * fire when back/forward or an in-app link moves the parameter — so without
   * this, a `lazy` hub would drop such a panel again the moment the reader
   * moved on, and every return to it would remount and re-subscribe.
   *
   * The panel itself does not wait for this effect: the render below mounts
   * the ACTIVE tab unconditionally, so there is no frame in which the rail
   * shows a selected tab over an empty panel.
   */
  useEffect(() => {
    if (!lazy || !tab) return
    setActivated((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)))
  }, [lazy, tab])

  return (
    <TabContext value={tab}>
      <GridItems
        spacing={3}
        items={[
          {
            size: { xs: 12, sm: 3 },
            children: (
              <CardDisplay header={navHeader}>
                <TabList {...tabsProps} onChange={handleChange}>
                  {tabs.map((item) => (
                    <Tab key={item.id} value={item.id} label={item.label} />
                  ))}
                </TabList>
              </CardDisplay>
            ),
          },
          {
            size: { xs: 12, sm: 9 },
            children: (
              <>
                {tabs.map((item) => (
                  <TabPanel
                    key={item.id}
                    value={item.id}
                    keepMounted
                    sx={{ padding: 'unset' }}
                  >
                    {!lazy || item.id === tab || activated.has(item.id)
                      ? item.content
                      : null}
                  </TabPanel>
                ))}
              </>
            ),
          },
        ]}
      />
    </TabContext>
  )
}
HubTabs.displayName = 'HubTabs'

export default HubTabs


export interface HubSection {
  /** Route this section lives at. What the rail links to. */
  href: string
  label: string
  /** Hidden entirely when false — an entitlement or a role gate. */
  visible?: boolean
}

export interface HubSectionsProps {
  sections: readonly HubSection[]
  /** The active section's page, rendered beside the rail. */
  children: ReactNode
  /** Left nav card header (defaults to "Navigation"). */
  navHeader?: string
}

/**
 * The same rail, choosing a section by ROUTE rather than by panel (AGL-693).
 *
 * ## Why this exists beside `HubTabs`
 *
 * `HubTabs` renders every panel and keeps them mounted — `keepMounted`, and
 * `lazy` is off by default and passed by nobody. That is deliberate for a hub
 * whose panels are cheap and want live subscriptions, and it is the wrong
 * default for a settings page: opening "General" mounts the API-keys card, the
 * SSO card and the data-export card, and every one of their reads runs.
 *
 * The code is the other half. A tabbed page imports every panel's module
 * statically, so a reader who only renames their workspace still downloads the
 * delete-org dialog.
 *
 * Sections as routes fix both at the framework level rather than by hand: Next
 * mounts one page and code-splits per route, so an unopened section costs
 * neither a read nor a byte. Three things come free that the tab version faked
 * or did without — a section is linkable, the back button walks sections, and
 * the active state is a fact about the URL rather than state kept in sync with
 * it.
 *
 * ## Active state
 *
 * By PREFIX, so a section stays selected on its own deeper routes, longest
 * match first so a nested section beats its parent. The separator boundary is
 * what stops `/settings` claiming `/settings-export`.
 */
export function HubSections(props: HubSectionsProps) {
  const { sections, children, navHeader = 'Navigation' } = props
  const { tabsProps } = useRailLayout()
  const pathname = usePathname()
  const shown = useMemo(
    () => sections.filter((section) => section.visible !== false),
    [sections],
  )
  const activeHref = useMemo(() => {
    const onPath = (href: string) =>
      pathname === href || pathname.startsWith(`${href}/`)
    return (
      [...shown]
        .filter((section) => onPath(section.href))
        .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null
    )
  }, [pathname, shown])

  return (
    <GridItems
      spacing={3}
      items={[
        {
          size: { xs: 12, sm: 3 },
          children: (
            <CardDisplay header={navHeader}>
              {/*
                * `Tabs`, not `TabList`: there is no `TabContext` here because
                * there are no panels to bind to — the content is a routed
                * page. `false` when nothing matches, because a `value` MUI
                * cannot find warns on every render and parks the indicator on
                * whichever tab happens to be first.
                */}
              <Tabs {...tabsProps} value={activeHref ?? false}>
                {shown.map((section) => (
                  <Tab
                    key={section.href}
                    value={section.href}
                    label={section.label}
                    component={AppLink}
                    href={section.href}
                    aria-current={
                      section.href === activeHref ? 'page' : undefined
                    }
                  />
                ))}
              </Tabs>
            </CardDisplay>
          ),
        },
        { size: { xs: 12, sm: 9 }, children },
      ]}
    />
  )
}
HubSections.displayName = 'HubSections'
