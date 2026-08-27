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
import { List, ListItemButton, ListItemText } from '@mui/material'
import { usePathname } from 'next/navigation'
import { useMemo, type ReactNode } from 'react'

/**
 * ONE vertical section nav, for every page that has sections (AGL-693).
 *
 * ## Why this is links and routes rather than tabs and panels
 *
 * The pages that have sections built them with `TabContext`/`TabPanel`: one
 * route, one component, five panels. `TabPanel` does unmount the panels a
 * reader has not opened, so the DATA of an unvisited section is not read —
 * but its CODE still ships. `settings/page.tsx` statically imports every
 * section's cards, none of them lazily, so opening "General" downloads the
 * SSO card, the API-keys card, the data-export card and the delete-org
 * dialog, and a reader who only ever renames their workspace pays for all of
 * it on every visit.
 *
 * Sections as ROUTES fix that at the framework level rather than by hand:
 * Next code-splits per route, so a section's bundle arrives when a reader
 * opens it and never before. Three things come free with it, all of which the
 * tab version had to fake or do without — a section is linkable, the back
 * button walks sections, and the active state is a fact about the URL rather
 * than a piece of state that has to be kept in sync with it.
 *
 * ## Active state
 *
 * From the pathname, and by PREFIX so a section stays lit on its own deeper
 * routes. The boundary check is what stops `/settings` claiming
 * `/settings-export`: a prefix is only a prefix at a path separator. Longest
 * match wins, so a nested item beats its parent.
 *
 * `aria-current="page"` alongside the visual state — a nav where only colour
 * says "you are here" says nothing to a screen reader.
 */
export interface SectionNavItem {
  /** Route this section lives at. */
  href: string
  label: string
  /** Hidden entirely when false — an entitlement or a role gate. */
  visible?: boolean
}

export interface SectionNavLayoutProps {
  items: readonly SectionNavItem[]
  children: ReactNode
  /** The nav card's header. */
  header?: string
  /** Columns the nav occupies at `sm` and up. Content takes the rest. */
  navSize?: number
}

export function SectionNavLayout(props: SectionNavLayoutProps) {
  const { items, children, header = 'Navigation', navSize = 3 } = props
  const pathname = usePathname()
  const shown = useMemo(
    () => items.filter((item) => item.visible !== false),
    [items],
  )

  const activeHref = useMemo(() => {
    const onPath = (href: string) =>
      pathname === href || pathname.startsWith(`${href}/`)
    return (
      [...shown]
        .filter((item) => onPath(item.href))
        .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null
    )
  }, [pathname, shown])

  return (
    <GridItems
      spacing={3}
      items={[
        {
          size: { xs: 12, sm: navSize },
          children: (
            <CardDisplay header={header}>
              {/* `disablePadding` because `CardDisplay` already insets its
                  content; without it the list sits a step further in than
                  every other card's body on the page. */}
              <List disablePadding>
                {shown.map((item) => {
                  const selected = item.href === activeHref
                  return (
                    <ListItemButton
                      key={item.href}
                      component={AppLink}
                      href={item.href}
                      selected={selected}
                      aria-current={selected ? 'page' : undefined}
                      // A nav item is not body copy: the link colour would
                      // make the whole list read as five actions of equal
                      // weight, which is what `selected` exists to break.
                      sx={{ color: 'inherit' }}
                    >
                      <ListItemText
                        primary={item.label}
                        slotProps={{
                          primary: {
                            variant: 'body2',
                            sx: selected ? { fontWeight: 'bold' } : undefined,
                          },
                        }}
                      />
                    </ListItemButton>
                  )
                })}
              </List>
            </CardDisplay>
          ),
        },
        {
          size: { xs: 12, sm: 12 - navSize },
          children,
        },
      ]}
    />
  )
}
SectionNavLayout.displayName = 'SectionNavLayout'

export default SectionNavLayout
