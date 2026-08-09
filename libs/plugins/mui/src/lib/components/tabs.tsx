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

import * as Aglyn from '@aglyn/aglyn'
import { mdiTab, mdiViewCarousel } from '@aglyn/shared-data-mdi'
import { AppLink } from '@aglyn/shared-ui-jsx'
import Box from '@mui/material/Box'
import MuiTab from '@mui/material/Tab'
import MuiTabs from '@mui/material/Tabs'
import Typography from '@mui/material/Typography'
import type { SxProps } from '@mui/material/styles'
import {
  createContext,
  forwardRef,
  type ReactNode,
  useContext,
  useState,
} from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const TABS_ID: Aglyn.ComponentId = 'muiTabs'
export const TAB_PANEL_ID: Aglyn.ComponentId = 'muiTabPanel'

/**
 * How many tabs in a strip can carry a screen link (AGL-1312). The strip is
 * authored as a free-form label list, so the links have to be flat props —
 * one per position — and a flat prop needs a name that exists up front.
 *
 * Eight is well past any usable navigation row (the marketing content-tabs
 * row is three) and costs nothing at render: the attributes panel only shows
 * a link picker for a tab that actually exists, so a two-tab strip shows two.
 */
export const TAB_LINK_SLOTS = 8

/** Prop name carrying the link of the 1-based `position`-th tab. */
export function tabLinkProp(position: number): string {
  return `tabLink${position}`
}

/**
 * The per-tab screen links, `tabLink1`…`tabLink8`. Declared as a mapped type
 * rather than an index signature: an index signature on the props interface
 * would force `sx`, `children` and the rest to conform to it.
 */
export type TabLinkProps = Partial<
  Record<
    | 'tabLink1'
    | 'tabLink2'
    | 'tabLink3'
    | 'tabLink4'
    | 'tabLink5'
    | 'tabLink6'
    | 'tabLink7'
    | 'tabLink8',
    string
  >
>

export interface TabsElementProps extends TabLinkProps {
  /** Tab labels, one per line (commas also accepted). */
  labels?: string
  /** Accessible name of the strip; also names the nav landmark in link mode. */
  ariaLabel?: string
  orientation?: 'horizontal' | 'vertical'
  variant?: 'standard' | 'scrollable' | 'fullWidth'
  /** Centres a standard strip; MUI ignores it when scrollable. */
  centered?: boolean
  textColor?: 'primary' | 'secondary' | 'inherit'
  indicatorColor?: 'primary' | 'secondary'
  /**
   * Render every panel into the SSR output up front instead of building each
   * panel the first time its tab is opened (AGL-1283 option 3).
   *
   * Mount-on-first-selection is the DEFAULT: `/pricing` shipped eight copies
   * of a 50-row table so desktop visitors could see none of them, and any
   * large tab set pays the same tax silently. The trade is that an unopened
   * panel's content is then not in the page source — not indexable, not
   * findable — so this switch exists for the panels where that matters:
   * content that appears nowhere else on the page and must reach crawlers.
   */
  ssrPanels?: boolean
  /**
   * Legacy opt-in from when eager panels were the default (AGL-1283).
   * Lazy mounting is now the default, so this is accepted from existing
   * documents but no longer consulted — `ssrPanels` is the one switch.
   * Still destructured so an authored value never leaks onto the DOM.
   */
  lazyPanels?: boolean
  /**
   * Authored node styles, handed over by the renderer rather than typed into
   * an attribute — the merge below reads it, so it belongs on the public
   * interface. Leaving it undeclared (AGL-1284 added the reads, not the
   * declaration) meant no typed caller could pass one, including the specs
   * that exist to prove an authored `sx` survives (AGL-1323).
   */
  sx?: SxProps
  children?: ReactNode
}

export interface TabPanelElementProps {
  /** Which tab reveals this panel; must match one of the Tabs labels. */
  label?: string
  /**
   * Set by the server when this panel's children were withheld from the page
   * payload (AGL-1285, `deferLazyPanelNodes`) — never authored, and there is
   * deliberately no attribute for it.
   *
   * It must be destructured off the prop bag either way: everything else on
   * this element is spread straight onto a `Box`, so leaving it in produced a
   * React "does not recognize the prop" warning for every deferred panel.
   *
   * It also drives the loading state. A withheld panel that the reader has
   * just opened has no children yet and is indistinguishable from a panel that
   * is genuinely empty, and the fetch behind it is a full server compose —
   * 3.8s cold when measured. This flag is what lets the panel say so.
   *
   * It clears itself: the patch from `/api/screen/nodes` carries the ORIGINAL
   * panel nodes, which never had the marker, so the moment the real children
   * arrive this is gone and the placeholder with it (AGL-1287).
   */
  aglynDeferred?: boolean
  /** Authored node styles, merged over the panel's own — see Tabs' `sx`. */
  sx?: SxProps
  children?: ReactNode
}

/**
 * Splits the authored label list. Newline-separated is the documented
 * form; commas are accepted because a one-line "A, B, C" is what people
 * type first.
 */
export function parseLabels(value: unknown): string[] {
  if (value == null) return []
  return String(value)
    .split(/[\n,]/)
    .map((label) => label.trim())
    .filter(Boolean)
}

/** Stable DOM id fragment for the tab ⇄ panel aria wiring. */
export function labelSlug(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'tab'
  )
}

/** Case/whitespace-insensitive: authors don't retype labels exactly. */
export function labelsMatch(a: unknown, b: unknown): boolean {
  return (
    String(a ?? '').trim().toLowerCase() ===
    String(b ?? '').trim().toLowerCase()
  )
}

interface TabsContextValue {
  activeLabel: string
  /** True on the besigner canvas, where every panel is shown at once. */
  showAll: boolean
  /** Panels render nothing until first selected (AGL-1283). */
  lazyPanels: boolean
  /** Labels opened at least once — a lazily mounted panel stays mounted. */
  opened: ReadonlySet<string>
  /**
   * True when at least one tab carries a screen link (AGL-1312), which makes
   * the whole row navigation rather than a tab list — see the a11y note on
   * `TabsElement`. Panels drop `role="tabpanel"` in that mode: a tabpanel
   * with no tablist to belong to is orphaned ARIA.
   */
  navMode: boolean
}

export const TabsContext = createContext<TabsContextValue | undefined>(
  undefined,
)

/**
 * Tabs (https://mui.com/material-ui/react-tabs/).
 *
 * The strip is authored on the container as a label list, and each Tab
 * Panel child names the label it belongs to. It does **not** slice its
 * React children by index: the node renderer hands every component a
 * single `Branch` fragment rather than one element per child node
 * (`libs/aglyn-node-renderer`), so an index-based split would silently
 * put all the content behind the first tab. Matching by label also
 * survives reordering panels in the hierarchy.
 *
 * The strip renders from the author's own list, so it is complete in the
 * SSR output — no registration pass, no empty-then-filled flash, and it
 * still reads as a tab list with JavaScript disabled.
 *
 * ## Link mode (AGL-1312)
 *
 * Any tab may carry a screen link (`tabLink1`…`tabLink8`, by position). A
 * tab that has one renders as a real anchor — navigable, crawlable,
 * middle-clickable — because the row it exists for (Blog | Changelog |
 * Newsroom) is navigation ACROSS screens, which a panel switcher can only
 * fake with empty panels or a hand-styled row of buttons. The anchor is an
 * `AppLink`, never a bare `href`: a raw href full-reloads the SPA.
 *
 * A tab WITHOUT a link keeps today's behavior exactly, and mixed rows work
 * — the marketing pattern IS a mixed row, since the tab for the page you
 * are already on must not link to itself. That unlinked tab is also how the
 * author says which page this copy of the row is on: the strip lands on it,
 * so the same three-tab row placed on three screens shows the indicator in
 * the right place on each, with no "selected tab" attribute to keep in sync.
 *
 * **Accessibility.** The row is a `tablist` only while NOTHING in it
 * navigates. As soon as one tab carries a link the whole strip is marked up
 * as navigation: a `nav` landmark, no `role="tab"`, no `aria-selected`, and
 * no roving tab stop (every link is its own tab stop, as in any nav). The
 * alternative — an `<a href>` wearing `role="tab"` — tells assistive tech
 * the activation will reveal a panel when it actually loads a page, and a
 * tablist whose children are not tabs is invalid either way. The tab for
 * the current screen is marked `aria-current="page"`; tabs that still
 * switch panels stay buttons and keep their `aria-controls`, which is an
 * accurate disclosure relationship on its own. The half-applied version of
 * this — links inside a tablist, or panels still claiming `role="tabpanel"`
 * with no tablist above them — is what this deliberately avoids.
 */
const TabsElement = forwardRef<HTMLDivElement, TabsElementProps>(
  (props, ref) => {
    const {
      labels,
      ariaLabel,
      orientation,
      variant,
      centered,
      textColor,
      indicatorColor,
      ssrPanels,
      lazyPanels,
      children,
      ...rest
    } = props
    const { editorInert, suppressNavigation } = Aglyn.useScreenLink(undefined)
    // Read the routing map directly rather than calling `useScreenLink` per
    // tab: the number of tabs changes with the label list, and a hook per
    // list item is a rules-of-hooks violation waiting for the author to add
    // a fourth tab.
    const { screens } = useContext(Aglyn.ScreenLinkContext)
    // Screen ids by tab position, lifted out of `rest` so they can never
    // reach the DOM as unknown attributes (the nav-menu does the same with
    // its legacy trigger prop).
    const linkIds: (string | undefined)[] = []
    for (let slot = 1; slot <= TAB_LINK_SLOTS; slot += 1) {
      const key = tabLinkProp(slot)
      const value = (rest as Record<string, unknown>)[key]
      linkIds.push(typeof value === 'string' && value ? value : undefined)
      delete (rest as Record<string, unknown>)[key]
    }
    const parsed = parseLabels(labels)
    // Authored links decide the mode, NOT resolved hrefs: the canvas and
    // preview suppress navigation, and they must still show the element the
    // page will actually ship (the same rule Screen Link follows).
    const navMode = parsed.some((_label, index) => !!linkIds[index])
    /**
     * The tab a navigation row LANDS on is the one with no link: the row is
     * placed on every screen it names, and on each of those the tab for that
     * screen is left unlinked, because a page that links to itself helps
     * nobody. So "first tab with no link" is how the author says "this is
     * the page you are on" — without a second attribute, and without this
     * element having to know the current route.
     *
     * `-1` means every tab navigates: nothing is current, and the strip
     * shows no indicator rather than inventing one under the first tab.
     * With no links at all this is 0, i.e. exactly today's behavior.
     */
    const landing = parsed.findIndex((_label, index) => !linkIds[index])
    const [active, setActive] = useState(landing < 0 ? 0 : landing)
    // Once a lazy panel has been opened it stays mounted: re-tabbing between
    // two plans should not re-render 50 rows each time, and anything the
    // reader typed or scrolled inside a panel survives a round trip.
    //
    // Seeded with the LANDING label, because that panel is open from the
    // start without anyone clicking it. Leaving it out unmounted the landing
    // panel the moment the reader moved away — visibly inconsistent with
    // every other panel they had visited, and caught by the round-trip test.
    const [opened, setOpened] = useState<ReadonlySet<string>>(() => {
      const first = parsed[landing < 0 ? 0 : landing]
      return new Set<string>(first === undefined ? [] : [first])
    })
    // A label removed from the list must not leave the strip pointing at
    // a tab that no longer exists — MUI warns and drops the indicator.
    const chosen = active < parsed.length ? active : 0
    // A tab that navigates is never the selected one; if the author has just
    // given the open tab a link, fall back to one that still has a panel.
    const activeIndex = linkIds[chosen] && landing >= 0 ? landing : chosen
    const resolvedVariant = variant || 'standard'
    const vertical = orientation === 'vertical'
    const stripLabel = ariaLabel || 'Tabs'

    const strip = (
      <MuiTabs
        // No indicator when every tab navigates: there is no selection to
        // show, and marking one anyway would point at the wrong page.
        value={parsed.length && landing >= 0 ? activeIndex : false}
        onChange={
          editorInert
            ? undefined
            : (_event, next: number) => {
                // A navigating tab must not move the selection on its way
                // out: the indicator would jump to a tab whose panel is
                // empty while the next page is still loading.
                if (linkIds[next]) return
                setActive(next)
                const label = parsed[next]
                if (label !== undefined) {
                  setOpened((prev) =>
                    prev.has(label) ? prev : new Set(prev).add(label),
                  )
                }
              }
        }
        orientation={vertical ? 'vertical' : 'horizontal'}
        variant={resolvedVariant}
        // MUI ignores `centered` on a scrollable strip and warns in dev.
        centered={resolvedVariant === 'standard' ? !!centered : undefined}
        textColor={textColor || 'primary'}
        indicatorColor={indicatorColor || 'primary'}
        // Link mode is navigation, so the root becomes the `nav` landmark
        // and the inner flex row gives up `role="tablist"`. The accessible
        // name moves with it: MUI puts `aria-label` on the list, which in
        // this mode is a plain div and cannot carry the landmark's name.
        {...(navMode
          ? {
              component: 'nav',
              slotProps: {
                root: { 'aria-label': stripLabel },
                list: { role: undefined },
              },
            }
          : { 'aria-label': stripLabel })}
      >
        {parsed.map((label, index) => {
          const slug = labelSlug(label)
          const key = `${slug}-${index}`
          if (!navMode) {
            return (
              <MuiTab
                key={key}
                label={label}
                id={`tab-${slug}`}
                aria-controls={`tabpanel-${slug}`}
              />
            )
          }
          // Suppressed navigation (canvas, preview) keeps the item in the
          // row but without an href, so a click cannot leave the editor.
          const href = suppressNavigation
            ? undefined
            : Aglyn.resolveScreenHref(screens, linkIds[index])
          return (
            <MuiTab
              key={key}
              label={label}
              id={`tab-${slug}`}
              // Only a tab that still reveals a panel controls anything.
              aria-controls={linkIds[index] ? undefined : `tabpanel-${slug}`}
              {...(href
                ? { component: AppLink, componentVariant: 'naked', href }
                : null)}
              // MUI writes these before spreading the rest, so passing them
              // undefined is what removes them (see the a11y note above).
              role={undefined}
              aria-selected={undefined}
              aria-current={
                landing >= 0 && index === activeIndex ? 'page' : undefined
              }
              // Undo the roving tab stop: in a nav every item is reachable
              // with Tab, and MUI's arrow-key handler already stands down
              // because it only moves between `role="tab"` siblings.
              tabIndex={undefined}
            />
          )
        })}
      </MuiTabs>
    )

    return (
      <TabsContext.Provider
        value={{
          activeLabel: parsed[activeIndex] ?? '',
          // Every panel at once on the canvas: a hidden panel cannot be
          // selected or styled, the same reason Accordion force-expands.
          showAll: !!editorInert,
          // Lazy is the default (AGL-1283 option 3); `ssrPanels` is the SEO
          // escape hatch. The legacy `lazyPanels` opt-in is subsumed: `true`
          // now means what the default means, and a stored `false` was only
          // ever the old default, never an author's intent.
          lazyPanels: !ssrPanels,
          opened,
          navMode,
        }}
      >
        <Box
          ref={ref}
          {...rest}
          // MERGE, never replace. `sx` written after `{...rest}` silently
          // discarded whatever the author set on the node — every Tabs on
          // every site rendered with default MUI styling and no way to
          // change it, with nothing in the editor to suggest the value had
          // been dropped (AGL-1284). Vertical orientation still needs the
          // flex row, so it goes first and the author can override it.
          sx={[
            { display: vertical ? 'flex' : undefined },
            ...(Array.isArray(rest.sx) ? rest.sx : [rest.sx]),
          ]}
        >
          {strip}
          {children}
        </Box>
      </TabsContext.Provider>
    )
  },
)
TabsElement.displayName = 'AglynTabs'

/**
 * One tab's content. Outside a Tabs container it renders plainly rather
 * than disappearing — a panel dragged out of its tabs would otherwise
 * vanish from the canvas with no explanation.
 */
export const TabPanelElement = forwardRef<
  HTMLDivElement,
  TabPanelElementProps
>((props, ref) => {
  const { label, aglynDeferred, children, ...rest } = props
  const context = useContext(TabsContext)
  const selected = !context || labelsMatch(label, context.activeLabel)
  const visible = selected || !!context?.showAll
  /**
   * With `lazyPanels`, an unopened panel renders its wrapper but not its
   * children — the wrapper stays so the `aria-controls` target and the
   * tab ⇄ panel wiring still resolve, and so nothing about the accessible
   * structure depends on whether the reader has clicked yet.
   *
   * `opened` is checked as well as `selected` because a panel that has been
   * visited stays mounted; only the never-opened ones are skipped.
   */
  const mounted =
    !context ||
    !context.lazyPanels ||
    context.showAll ||
    selected ||
    context.opened.has(String(label ?? ''))

  /**
   * In link mode the strip is a nav, not a tablist (AGL-1312), so a panel
   * has no tablist to belong to and drops the tab-pattern ARIA rather than
   * claiming half of it. The id stays — the button that still reveals this
   * panel points `aria-controls` at it, which is a valid relationship on
   * its own — and an orphan panel (dragged out of its Tabs, no context)
   * keeps today's markup untouched.
   */
  const navMode = !!context?.navMode

  return (
    <Box
      ref={ref}
      role={navMode ? undefined : 'tabpanel'}
      hidden={!visible}
      id={`tabpanel-${labelSlug(String(label ?? ''))}`}
      aria-labelledby={
        navMode ? undefined : `tab-${labelSlug(String(label ?? ''))}`
      }
      {...rest}
      // Same merge bug as the Tabs container (AGL-1284): the author's `sx`
      // was dropped, so a panel could not even have its padding changed.
      // Order matters — the default padding is first so the author can
      // override it, and the hide rule is LAST so an authored `display`
      // can never force a deselected panel back on screen.
      sx={[
        { p: 2 },
        ...(Array.isArray(rest.sx) ? rest.sx : [rest.sx]),
        ...(visible ? [] : [{ display: 'none' }]),
      ]}
    >
      {context?.showAll && !selected ? (
        // Canvas only: says which tab this content belongs to, so a
        // stack of panels is readable and a label typo is obvious.
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mb: 0.5 }}
        >
          {label ? `Tab: ${label}` : 'Tab: (no label set)'}
        </Typography>
      ) : null}
      {mounted ? (
        aglynDeferred && visible ? (
          // Opened, but its nodes are still in flight (AGL-1287). Only while
          // VISIBLE — a deferred panel nobody has opened must stay silent, or
          // every unopened tab would render a spinner into the page.
          //
          // Deliberately not a skeleton of the content: a withheld subtree can
          // be a 50-row table or a paragraph, and this component has no way to
          // know which, so a shaped skeleton would be a guess that flashes
          // wrong. `role="status"` announces it to a screen reader, which
          // otherwise gets a panel that is silently empty for seconds.
          <Typography
            role="status"
            variant="body2"
            color="text.secondary"
            sx={{ display: 'block', py: 2 }}
          >
            {'Loading…'}
          </Typography>
        ) : (
          children
        )
      ) : null}
    </Box>
  )
})
TabPanelElement.displayName = 'AglynTabPanel'

/** `centered` is a standard-strip-only prop; MUI warns when scrollable. */
const STANDARD_ONLY = { when: 'variant', is: 'scrollable', notMatch: true }

/**
 * Shows a per-tab link picker only once the label list has that many tabs,
 * so a three-tab strip offers three pickers rather than eight.
 *
 * Expressed as a serialisable `pattern` rather than an `is` predicate:
 * conditions travel with the component schema, and a function in there is a
 * live grenade the day a schema is cloned or sent across a boundary. An
 * "item" is a run without a separator that holds something visible, and a
 * separator run swallows blank lines, so it counts exactly what
 * `parseLabels` counts.
 */
export function atLeastLabels(count: number): Record<string, unknown> {
  if (count <= 1) return { when: 'labels', isNotEmpty: true }
  const item = '[^\\n,]*\\S[^\\n,]*'
  const separator = '[\\n,][\\s,]*'
  return {
    when: 'labels',
    pattern: `(?:${item}${separator}){${count - 1}}${item}`,
  }
}

/** "1st", "2nd", "3rd", … for the link fields' own descriptions. */
function ordinal(position: number): string {
  const suffix =
    position % 10 === 1 && position !== 11
      ? 'st'
      : position % 10 === 2 && position !== 12
        ? 'nd'
        : position % 10 === 3 && position !== 13
          ? 'rd'
          : 'th'
  return `${position}${suffix}`
}

/**
 * One Screen picker per tab position (AGL-1312), the same field the Screen
 * Link element uses — so a tab's target is chosen from the host's screens
 * and survives a slug rename, and the attributes panel needs no new UI.
 *
 * Deliberately NOT paired with a "link mode" switch: a mode select would
 * need its default to persist, and an `''` option value cannot (AGL-1191 —
 * the form strips it before save). Carrying a link IS the mode, per tab,
 * which is also what makes a mixed row expressible at all.
 */
const TAB_LINK_FIELDS: Aglyn.AglynAttributeSchema[] = Array.from(
  { length: TAB_LINK_SLOTS },
  (_unused, index) => {
    const position = index + 1
    return {
      name: tabLinkProp(position),
      label: `Tab ${position} link`,
      description:
        `Screen the ${ordinal(position)} tab navigates to. A tab with a ` +
        'link is a real link — it can be opened in a new tab and search ' +
        'engines follow it — and it no longer switches panels. Leave it ' +
        'unset for a tab that just reveals its own panel, including the ' +
        'tab for the page this row is already on.',
      component: Aglyn.FieldComponentType.SCREEN_SELECT,
      condition: atLeastLabels(position),
    }
  },
)

export const tabsSchema: Aglyn.ComponentSchema<TabsElementProps> = {
  $id: TABS_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Tabs',
  description:
    'Tab strip whose Tab Panel children each name the tab that reveals ' +
    'them.',
  category: Aglyn.ComponentCategory.NAVIGATION,
  icon: { path: mdiTab.path, sx: { color: '#2196f3' } },
  restrictChildren: [
    Aglyn.LinealDirectiveFlag.LIMIT_TO,
    { components: [TAB_PANEL_ID] },
  ],
  attributes: [
    {
      name: 'labels',
      label: 'Tabs',
      description:
        'One tab label per line. Each Tab Panel below shows under the ' +
        'tab whose label it names.',
      component: Aglyn.FieldComponentType.TEXTAREA,
    },
    ...TAB_LINK_FIELDS,
    {
      name: 'orientation',
      label: 'Orientation',
      description:
        'Vertical puts the strip beside the panels instead of above them.',
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { value: '', label: 'Horizontal (default)' },
        { value: 'vertical', label: 'Vertical' },
      ],
    },
    {
      name: 'variant',
      label: 'Variant',
      description:
        'Scrollable keeps long strips usable on small screens; full width ' +
        'divides the available space evenly.',
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { value: '', label: 'Standard (default)' },
        { value: 'scrollable', label: 'Scrollable' },
        { value: 'fullWidth', label: 'Full width' },
      ],
    },
    {
      name: 'ssrPanels',
      label: 'Keep every panel in the page source',
      description:
        'Panels are normally built the first time their tab is opened, ' +
        'which keeps big tab sets light. Turn this on when panel content ' +
        'appears nowhere else on the page and search engines must be able ' +
        'to read it — every panel is then rendered into the page source ' +
        'up front, which can make a large tab set much heavier.',
      component: Aglyn.FieldComponentType.SWITCH,
    },
    {
      name: 'centered',
      label: 'Centered?',
      description: 'Centres the tabs in the strip.',
      component: Aglyn.FieldComponentType.SWITCH,
      // MUI ignores centered on a scrollable strip and warns in dev.
      condition: STANDARD_ONLY,
    },
    {
      name: 'textColor',
      label: 'Text color',
      description: 'Theme color of the tab labels.',
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { value: '', label: 'Primary (default)' },
        { value: 'secondary', label: 'Secondary' },
        { value: 'inherit', label: 'Inherit' },
      ],
    },
    {
      name: 'indicatorColor',
      label: 'Indicator color',
      description: 'Theme color of the underline marking the active tab.',
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { value: '', label: 'Primary (default)' },
        { value: 'secondary', label: 'Secondary' },
      ],
    },
    {
      name: 'ariaLabel',
      label: 'Accessible label',
      description:
        'Names the row for screen readers. Default "Tabs". Give a row ' +
        'whose tabs link to other screens its own name — it becomes a ' +
        'navigation landmark, and two landmarks called the same thing are ' +
        'no help to anyone.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
  ],
}

export const tabPanelSchema: Aglyn.ComponentSchema<TabPanelElementProps> = {
  $id: TAB_PANEL_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Tab Panel',
  description: 'The content shown under one tab.',
  category: Aglyn.ComponentCategory.NAVIGATION,
  icon: { path: mdiViewCarousel.path, sx: { color: '#2196f3' } },
  attributes: [
    {
      name: 'label',
      label: 'Shows under tab',
      description:
        "The tab label this panel belongs to — type it exactly as it " +
        'appears in the Tabs list above (capitalisation is ignored).',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
  ],
}

const tabPanel = (label: string, body: string) => ({
  $id: null,
  componentId: TAB_PANEL_ID,
  pluginId: BUNDLE_ID,
  props: { label },
  nodes: [
    {
      $id: null,
      componentId: 'muiTypography',
      pluginId: BUNDLE_ID,
      props: { variant: 'body2', children: body },
    },
  ],
})

export const tabsPresets: Aglyn.PresetSchema[] = [
  {
    // Labels and panels ship already matched: the one place this element
    // can be misconfigured is never hit on the common path.
    $id: generatePresetId(TABS_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Tabs',
    pluginId: BUNDLE_ID,
    description: 'Three tabs with matching panels, ready to edit',
    category: Aglyn.ComponentCategory.NAVIGATION,
    icon: tabsSchema.icon,
    data: {
      $id: null,
      componentId: TABS_ID,
      pluginId: BUNDLE_ID,
      props: { labels: 'Overview\nDetails\nFAQ' },
      nodes: [
        tabPanel('Overview', 'What this is, in a sentence or two.'),
        tabPanel('Details', 'The specifics that back up the overview.'),
        tabPanel('FAQ', 'The questions people actually ask.'),
      ],
    },
  },
  {
    $id: generatePresetId(TAB_PANEL_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Tab Panel',
    pluginId: BUNDLE_ID,
    description: 'One more panel to add to an existing Tabs element',
    category: Aglyn.ComponentCategory.NAVIGATION,
    icon: tabPanelSchema.icon,
    data: tabPanel('', 'Name the tab this panel belongs to.'),
  },
]

export default TabsElement
