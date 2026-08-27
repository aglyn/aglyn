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
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  type ReactNode,
  type SyntheticEvent,
  useCallback,
  useMemo,
  useState,
} from 'react'

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
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { tabsProps } = useRailLayout()
  const requestedTab = searchParams?.get('tab')
  const initialTab = tabs.some((item) => item.id === requestedTab)
    ? (requestedTab as string)
    : (tabs[0]?.id ?? '')
  const [tab, setTab] = useState(initialTab)
  // Which tabs have ever been active — the mount set when `lazy`. Seeded with
  // the initial tab so it (and only it) mounts on first paint.
  const [activated, setActivated] = useState<Set<string>>(
    () => new Set(initialTab ? [initialTab] : []),
  )

  const handleChange = useCallback(
    (event: SyntheticEvent, value: string) => {
      setTab(value)
      setActivated((prev) =>
        prev.has(value) ? prev : new Set(prev).add(value),
      )
      // App Router has no shallow `router.replace({ query })`: rebuild the
      // query string off the current params, set `tab`, and replace without
      // scrolling so the hub view still deep-links and survives back/forward.
      const nextParams = new URLSearchParams(searchParams?.toString())
      nextParams.set('tab', value)
      void router.replace(`${pathname}?${nextParams.toString()}`, {
        scroll: false,
      })
    },
    [router, pathname, searchParams],
  )

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
                    {!lazy || activated.has(item.id) ? item.content : null}
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
