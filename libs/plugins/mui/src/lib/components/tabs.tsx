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
import Box from '@mui/material/Box'
import MuiTab from '@mui/material/Tab'
import MuiTabs from '@mui/material/Tabs'
import Typography from '@mui/material/Typography'
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

export interface TabsElementProps {
  /** Tab labels, one per line (commas also accepted). */
  labels?: string
  orientation?: 'horizontal' | 'vertical'
  variant?: 'standard' | 'scrollable' | 'fullWidth'
  /** Centres a standard strip; MUI ignores it when scrollable. */
  centered?: boolean
  textColor?: 'primary' | 'secondary' | 'inherit'
  indicatorColor?: 'primary' | 'secondary'
  /**
   * Render only the selected panel, mounting the others the first time they
   * are opened (AGL-1283). Off by default, because a hidden panel's content
   * is normally worth having in the SSR output — it is indexable and
   * findable, and most tab sets are small enough that the cost is noise.
   *
   * Turn it on when the panels are LARGE and REPETITIVE. `/pricing` renders
   * a 50-row feature table per plan across eight plans; shipping all eight
   * doubled the page, and every desktop visitor downloaded all of it to
   * display none of it. The content is not lost to crawlers there because
   * the same figures appear in the wide table that desktop actually shows —
   * check that a page has that property before switching this on.
   */
  lazyPanels?: boolean
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
   * Declared here only so it can be destructured off the prop bag. It is not
   * a DOM attribute, and everything else on this element is spread straight
   * onto a `Box`; leaving it in produced a React "does not recognize the prop"
   * warning for every deferred panel on the page. The panel needs no other
   * behaviour from it — a withheld subtree renders as nothing because it has
   * no children, which is already the right answer.
   */
  aglynDeferred?: boolean
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
 */
const TabsElement = forwardRef<HTMLDivElement, TabsElementProps>(
  (props, ref) => {
    const {
      labels,
      orientation,
      variant,
      centered,
      textColor,
      indicatorColor,
      lazyPanels,
      children,
      ...rest
    } = props
    const { editorInert } = Aglyn.useScreenLink(undefined)
    const parsed = parseLabels(labels)
    const [active, setActive] = useState(0)
    // Once a lazy panel has been opened it stays mounted: re-tabbing between
    // two plans should not re-render 50 rows each time, and anything the
    // reader typed or scrolled inside a panel survives a round trip.
    //
    // Seeded with the FIRST label, because that panel is open from the start
    // without anyone clicking it. Leaving it out unmounted the landing panel
    // the moment the reader moved away — visibly inconsistent with every
    // other panel they had visited, and caught by the round-trip test.
    const [opened, setOpened] = useState<ReadonlySet<string>>(() => {
      const first = parseLabels(labels)[0]
      return new Set<string>(first === undefined ? [] : [first])
    })
    // A label removed from the list must not leave the strip pointing at
    // a tab that no longer exists — MUI warns and drops the indicator.
    const activeIndex = active < parsed.length ? active : 0
    const resolvedVariant = variant || 'standard'
    const vertical = orientation === 'vertical'

    const strip = (
      <MuiTabs
        value={parsed.length ? activeIndex : false}
        onChange={
          editorInert
            ? undefined
            : (_event, next: number) => {
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
        aria-label="Tabs"
      >
        {parsed.map((label, index) => (
          <MuiTab
            key={`${labelSlug(label)}-${index}`}
            label={label}
            id={`tab-${labelSlug(label)}`}
            aria-controls={`tabpanel-${labelSlug(label)}`}
          />
        ))}
      </MuiTabs>
    )

    return (
      <TabsContext.Provider
        value={{
          activeLabel: parsed[activeIndex] ?? '',
          // Every panel at once on the canvas: a hidden panel cannot be
          // selected or styled, the same reason Accordion force-expands.
          showAll: !!editorInert,
          lazyPanels: !!lazyPanels,
          opened,
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
  // `aglynDeferred` is pulled out and discarded — see its doc comment.
  const { label, aglynDeferred: _deferred, children, ...rest } = props
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

  return (
    <Box
      ref={ref}
      role="tabpanel"
      hidden={!visible}
      id={`tabpanel-${labelSlug(String(label ?? ''))}`}
      aria-labelledby={`tab-${labelSlug(String(label ?? ''))}`}
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
      {mounted ? children : null}
    </Box>
  )
})
TabPanelElement.displayName = 'AglynTabPanel'

/** `centered` is a standard-strip-only prop; MUI warns when scrollable. */
const STANDARD_ONLY = { when: 'variant', is: 'scrollable', notMatch: true }

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
      name: 'lazyPanels',
      label: 'Load panels on demand',
      description:
        'Only builds a panel the first time its tab is opened. Makes the ' +
        'page much lighter when the panels are large, but their content is ' +
        'then not in the page source — leave this off unless the same ' +
        'information appears elsewhere on the page.',
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
