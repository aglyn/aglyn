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

import {
  registerPluginInstallPresetMapper,
  registerPluginInstallPresetsMapper,
} from '@aglyn/aglyn'
import {
  muiPluginInstallToPreset,
  muiPluginInstallToPresets,
} from './components/plugin'
import * as Aglyn from '@aglyn/aglyn'
import { runInAction } from 'mobx'
import { BUNDLE_ID } from './constants/bundle-common'

/**
 * One thunk per component module, named here because several ids share one:
 * `collection.tsx` alone exports eight elements, and a module is imported
 * once however many of its components a surface asks for.
 */
const appBar = () => import('./components/app-bar')
const toolbar = () => import('./components/toolbar')
const typography = () => import('./components/typography')
const inlineText = () => import('./components/inline-text')
const button = () => import('./components/button')
const container = () => import('./components/container')
const layoutSlot = () => import('./components/layout-slot')
const list = () => import('./components/list')
const listItem = () => import('./components/list-item')
const listItemText = () => import('./components/list-item-text')
const blocks = () => import('./components/blocks')
const dataTable = () => import('./components/data-table')
const collection = () => import('./components/collection')
const image = () => import('./components/image')
const video = () => import('./components/video')
const icon = () => import('./components/icon')
const languageSwitcher = () => import('./components/language-switcher')
const reusableInstance = () => import('./components/reusable-instance')
const screenLink = () => import('./components/screen-link')
const linkBox = () => import('./components/link-box')
const navMenu = () => import('./components/nav-menu')
const drawer = () => import('./components/drawer')
const functionWidget = () => import('./components/function-widget')
const product = () => import('./components/product')
const plugin = () => import('./components/plugin')
const customHtml = () => import('./components/custom-html')
const searchBox = () => import('./components/search-box')
const markdown = () => import('./components/markdown')
const section = () => import('./components/section')
const stack = () => import('./components/stack')
const box = () => import('./components/box')
const documentRoot = () => import('./components/document-root')
const grid = () => import('./components/grid')
const paper = () => import('./components/paper')
const card = () => import('./components/card')
const accordion = () => import('./components/accordion')
const tabs = () => import('./components/tabs')
const imageList = () => import('./components/image-list')
const pagination = () => import('./components/pagination')
const breadcrumbs = () => import('./components/breadcrumbs')
const themeModeSwitcher = () => import('./components/theme-mode-switcher')

/** One entry of the bundle: what the registry is handed for a component. */
export interface MuiBundleEntry {
  component: any
  schema: Aglyn.ComponentSchema<any>
  presets?: Aglyn.PresetSchema[]
}

/**
 * Where a component id's code lives, and what it is called there (AGL-3141).
 *
 * An id names a module AND an export on it, never a module alone: several
 * modules export more than one element, and the registry needs the component,
 * its schema and — for the element that carries them — its presets by name.
 */
export interface MuiComponentSource {
  /** The module, as a thunk, so the bundler gives it a chunk of its own. */
  module: () => Promise<Record<string, unknown>>
  /** The component's export name on that module. */
  component: string
  /** Its schema's export name. */
  schema: string
  /** The export carrying its presets, for the element that ships them. */
  presets?: string
}

/**
 * Every component this bundle can register (AGL-140, AGL-3141).
 *
 * One entry per component keeps register/unregister symmetric — the old
 * hand-maintained lists had drifted, and several components were never
 * unregistered on destroy. It replaces a single array built from sixty static
 * imports, which put every element on every published page while the page
 * rendered about nineteen of them.
 *
 * Exported so the bundle is assertable (AGL-1201): duplicate component or
 * preset ids collapse silently inside the registry's keyed records, so they
 * can only be caught before registration.
 */
export const MUI_COMPONENT_SOURCES: Readonly<
  Record<string, MuiComponentSource>
> = {
  muiAppBar: {
    module: appBar,
    component: 'default',
    schema: 'schema',
    presets: 'presets',
  },
  muiToolbar: {
    module: toolbar,
    component: 'default',
    schema: 'schema',
    presets: 'presets',
  },
  muiTypography: {
    module: typography,
    component: 'default',
    schema: 'schema',
    presets: 'presets',
  },
  // The inline text run (AGL-1235): Typography is `textEditable` and so a
  // leaf, which left no way to emphasize a phrase inside a sentence — every
  // statement rendered as one flat color.
  muiInlineText: {
    module: inlineText,
    component: 'default',
    schema: 'schema',
    presets: 'presets',
  },
  muiButton: {
    module: button,
    component: 'default',
    schema: 'schema',
    presets: 'presets',
  },
  muiContainer: {
    module: container,
    component: 'default',
    schema: 'schema',
    presets: 'presets',
  },
  layoutSlot: {
    module: layoutSlot,
    component: 'default',
    schema: 'schema',
    presets: 'presets',
  },
  muiList: {
    module: list,
    component: 'default',
    schema: 'schema',
    presets: 'presets',
  },
  muiListItem: {
    module: listItem,
    component: 'default',
    schema: 'schema',
    presets: 'presets',
  },
  muiListItemText: {
    module: listItemText,
    component: 'default',
    schema: 'schema',
    presets: 'presets',
  },
  // form, formField moved to @aglyn/plugins-forms (AGL-395).
  videoEmbed: {
    module: blocks,
    component: 'VideoEmbed',
    schema: 'videoEmbedSchema',
    presets: 'blockPresets',
  },
  socialLinks: {
    module: blocks,
    component: 'SocialLinks',
    schema: 'socialLinksSchema',
  },
  // A real data grid (AGL-2543): the feature matrix a comparison page is
  // built around, which the palette had no element for at all.
  dataTable: {
    module: dataTable,
    component: 'default',
    schema: 'dataTableSchema',
    presets: 'dataTablePresets',
  },
  // Content collections (AGL-551/582): entries repeater, markdown entry
  // body, related posts, share bar, entry meta.
  collectionEntries: {
    module: collection,
    component: 'CollectionEntries',
    schema: 'collectionEntriesSchema',
    presets: 'collectionPresets',
  },
  collectionEntryBody: {
    module: collection,
    component: 'CollectionEntryBody',
    schema: 'collectionEntryBodySchema',
  },
  collectionRelated: {
    module: collection,
    component: 'CollectionRelated',
    schema: 'collectionRelatedSchema',
  },
  collectionShare: {
    module: collection,
    component: 'CollectionShare',
    schema: 'collectionShareSchema',
  },
  collectionEntryMeta: {
    module: collection,
    component: 'CollectionEntryMeta',
    schema: 'collectionEntryMetaSchema',
  },
  // The author card that closes an article (AGL-2486): the byline block
  // prints a name, and the record behind it also has a portrait and a bio.
  collectionEntryAuthor: {
    module: collection,
    component: 'CollectionEntryAuthor',
    schema: 'collectionEntryAuthorSchema',
  },
  // The subject of an author's own page (AGL-2518): the same person the
  // card above draws as a footnote, with the role fields it has no room for.
  contentAuthorProfile: {
    module: collection,
    component: 'ContentAuthorProfile',
    schema: 'contentAuthorProfileSchema',
  },
  // Category pills (AGL-1321): real anchors to /{collection}/category/{slug}.
  collectionCategories: {
    module: collection,
    component: 'CollectionCategories',
    schema: 'collectionCategoriesSchema',
  },
  // The toolbar search box (AGL-1516): the entries block's own field cannot
  // leave it, so the frame's pills-left / search-right row needs a block.
  collectionSearch: {
    module: collection,
    component: 'CollectionSearch',
    schema: 'collectionSearchSchema',
  },
  image: {
    module: image,
    component: 'default',
    schema: 'schema',
    presets: 'presets',
  },
  video: {
    module: video,
    component: 'default',
    schema: 'schema',
    presets: 'presets',
  },
  icon: {
    module: icon,
    component: 'default',
    schema: 'schema',
    presets: 'presets',
  },
  // booking moved to @aglyn/plugins-bookings (AGL-395).
  // eventList moved to @aglyn/plugins-events-calendar (AGL-313).
  languageSwitcher: {
    module: languageSwitcher,
    component: 'default',
    schema: 'schema',
    presets: 'presets',
  },
  reusableInstance: {
    module: reusableInstance,
    component: 'default',
    schema: 'schema',
    presets: 'presets',
  },
  muiScreenLink: {
    module: screenLink,
    component: 'default',
    schema: 'schema',
    presets: 'presets',
  },
  // The linking container (AGL-1231): every other link element is a leaf,
  // so a tile whose icon and description also belong to the target had no
  // way to be authored.
  muiLinkBox: {
    module: linkBox,
    component: 'default',
    schema: 'schema',
    presets: 'presets',
  },
  // Nav menu system (AGL-562): dropdown, mega menu, drawer + menu button.
  muiNavMenu: {
    module: navMenu,
    component: 'default',
    schema: 'navMenuSchema',
    presets: 'navMenuPresets',
  },
  muiMegaMenu: {
    module: navMenu,
    component: 'MegaMenu',
    schema: 'megaMenuSchema',
  },
  muiDrawer: {
    module: drawer,
    component: 'default',
    schema: 'drawerSchema',
    presets: 'drawerPresets',
  },
  muiDrawerToggle: {
    module: drawer,
    component: 'DrawerToggle',
    schema: 'drawerToggleSchema',
  },
  functionWidget: {
    module: functionWidget,
    component: 'default',
    schema: 'schema',
    presets: 'presets',
  },
  product: {
    module: product,
    component: 'default',
    schema: 'schema',
    presets: 'presets',
  },
  marketplacePlugin: {
    module: plugin,
    component: 'default',
    schema: 'schema',
    presets: 'presets',
  },
  'custom-html': {
    module: customHtml,
    component: 'default',
    schema: 'schema',
    presets: 'presets',
  },
  searchBox: {
    module: searchBox,
    component: 'default',
    schema: 'schema',
    presets: 'presets',
  },
  // Long-form documents (AGL-1162): one markdown element carrying the whole
  // page, and an "On this page" aside derived from its headings.
  markdown: {
    module: markdown,
    component: 'Markdown',
    schema: 'markdownSchema',
    presets: 'markdownPresets',
  },
  tableOfContents: {
    module: markdown,
    component: 'TableOfContents',
    schema: 'tableOfContentsSchema',
  },
  section: {
    module: section,
    component: 'default',
    schema: 'schema',
    presets: 'presets',
  },
  muiStack: {
    module: stack,
    component: 'default',
    schema: 'schema',
    presets: 'presets',
  },
  // Layout & surface primitives (AGL-1201).
  muiBox: {
    module: box,
    component: 'default',
    schema: 'schema',
    presets: 'presets',
  },
  // The canvas ROOT (AGL-2486): registered so the Document layer has a
  // schema — an element picker — instead of falling through to the
  // renderer's unstyled div. No preset: it is not an element anybody drops.
  div: {
    module: documentRoot,
    component: 'default',
    schema: 'schema',
  },
  muiGrid: {
    module: grid,
    component: 'default',
    schema: 'schema',
    presets: 'presets',
  },
  muiPaper: {
    module: paper,
    component: 'default',
    schema: 'schema',
    presets: 'presets',
  },
  muiCard: {
    module: card,
    component: 'default',
    schema: 'cardSchema',
    presets: 'cardPresets',
  },
  muiCardHeader: {
    module: card,
    component: 'CardHeaderElement',
    schema: 'cardHeaderSchema',
  },
  muiCardContent: {
    module: card,
    component: 'CardContentElement',
    schema: 'cardContentSchema',
  },
  muiCardActions: {
    module: card,
    component: 'CardActionsElement',
    schema: 'cardActionsSchema',
  },
  muiAccordion: {
    module: accordion,
    component: 'default',
    schema: 'accordionSchema',
    presets: 'accordionPresets',
  },
  muiAccordionSummary: {
    module: accordion,
    component: 'AccordionSummaryElement',
    schema: 'accordionSummarySchema',
  },
  muiAccordionDetails: {
    module: accordion,
    component: 'AccordionDetailsElement',
    schema: 'accordionDetailsSchema',
  },
  muiTabs: {
    module: tabs,
    component: 'default',
    schema: 'tabsSchema',
    presets: 'tabsPresets',
  },
  muiTabPanel: {
    module: tabs,
    component: 'TabPanelElement',
    schema: 'tabPanelSchema',
  },
  muiImageList: {
    module: imageList,
    component: 'default',
    schema: 'imageListSchema',
    presets: 'imageListPresets',
  },
  muiImageListItem: {
    module: imageList,
    component: 'ImageListItemElement',
    schema: 'imageListItemSchema',
  },
  muiPagination: {
    module: pagination,
    component: 'default',
    schema: 'schema',
    presets: 'presets',
  },
  muiBreadcrumbs: {
    module: breadcrumbs,
    component: 'default',
    schema: 'schema',
    presets: 'presets',
  },
  themeModeSwitcher: {
    module: themeModeSwitcher,
    component: 'default',
    schema: 'schema',
    presets: 'presets',
  },
}

/**
 * The bundle entries for `componentIds` — every component when none are
 * named, which is what the console and the besigner ask for because their
 * palette shows every element.
 *
 * Both paths go through the same map, so there is one statement of where a
 * component comes from. An id the map does not know is dropped rather than
 * resolved to an undefined component: a page whose document carries an
 * element this bundle does not own is a document for another plugin's
 * element, not a reason to register a blank.
 */
export async function loadMuiBundle(
  componentIds?: readonly string[],
): Promise<MuiBundleEntry[]> {
  const ids = (componentIds ?? Object.keys(MUI_COMPONENT_SOURCES)).filter(
    (id) => id in MUI_COMPONENT_SOURCES,
  )
  // Keyed on the THUNK, so `collection.tsx` is imported once for the eight
  // ids that name it rather than eight times.
  const pending = new Map<
    MuiComponentSource['module'],
    Promise<Record<string, unknown>>
  >()
  const modules = await Promise.all(
    ids.map((id) => {
      const source = MUI_COMPONENT_SOURCES[id] as MuiComponentSource
      let load = pending.get(source.module)
      if (!load) {
        load = source.module()
        pending.set(source.module, load)
      }
      return load
    }),
  )
  return ids.map((id, index) => {
    const source = MUI_COMPONENT_SOURCES[id] as MuiComponentSource
    const mod = modules[index] as Record<string, unknown>
    return {
      component: mod[source.component],
      schema: mod[source.schema] as Aglyn.ComponentSchema<any>,
      ...(source.presets
        ? { presets: mod[source.presets] as Aglyn.PresetSchema[] }
        : {}),
    }
  })
}

/**
 * Every component registered so far, by id.
 *
 * A second page places elements the first did not, and reaches this bundle
 * again with them; the map is what tells the two apart, and what `load` and
 * `destroy` read so a reload registers everything asked for so far and
 * unregistration stays symmetric with registration.
 */
const registeredById = new Map<string, MuiBundleEntry>()

function registerEntries(entries: readonly MuiBundleEntry[]): void {
  // One mobx transaction (AGL-371): a single observer notification
  // for the whole batch instead of one per component/preset.
  runInAction(() => {
    for (const entry of entries) {
      Aglyn.components.registerComponent(entry.component, entry.schema)
    }
    for (const entry of entries) {
      if (entry.presets?.length) {
        Aglyn.components.registerPreset(entry.presets)
      }
    }
  })
}

/**
 * Registers the core MUI component library with the `@aglyn/aglyn` global
 * plugin registry (`AglynNodeRenderer`, `Aglyn.canvas`, ...). This is the
 * platform's core component bundle; feature bundles (commerce,
 * events-calendar, email) declare a dependency on it.
 *
 * `use.componentIds` narrows it to the elements the surface places
 * (AGL-3116/AGL-3141), so a published page fetches those modules and no
 * others. A caller that names nothing gets the whole library, which is what
 * the console and the besigner need and what any surface that cannot say
 * what it places must be given: an element whose component never registered
 * renders NOTHING, silently (AGL-52).
 */
export async function registerMuiPlugin(use?: Aglyn.PluginUse): Promise<void> {
  // Install→preset mapper (AGL-419): the console's drawer registration
  // consumes it through core, never importing this plugin.
  registerPluginInstallPresetMapper(muiPluginInstallToPreset)
  // Declared canvas elements become their own palette entries (AGL-1031).
  registerPluginInstallPresetsMapper(muiPluginInstallToPresets)

  const wanted = (use?.componentIds ?? Object.keys(MUI_COMPONENT_SOURCES))
    .filter((id) => id in MUI_COMPONENT_SOURCES)
    .filter((id) => !registeredById.has(id))
  const existing = Aglyn.plugins.getDependency(BUNDLE_ID)
  if (existing && !wanted.length) return

  const entries = wanted.length ? await loadMuiBundle(wanted) : []
  for (const entry of entries) {
    registeredById.set(entry.schema.$id as string, entry)
  }

  // The dependency is added even when this page places nothing of it: a
  // feature bundle declares mui as a dependency and stays WAITING — its own
  // components never registering — until mui is in the manager.
  //
  // Re-read after the imports rather than trusting the check above: the
  // manager runs `load()` from `addDependency` synchronously, so the first
  // caller to get here creates the dependency and every later one takes the
  // branch that registers what it added into a bundle already LOADED.
  if (Aglyn.plugins.getDependency(BUNDLE_ID)) {
    if (entries.length) registerEntries(entries)
    return
  }

  Aglyn.plugins.addDependency({
    $id: BUNDLE_ID,
    displayName: 'Material UI',
    description: 'Material UI elements',
    title: 'Material UI',
    dependencies: {},
    load(): void {
      registerEntries([...registeredById.values()])
    },
    destroy(): void {
      const entries = [...registeredById.values()]
      runInAction(() => {
        for (const entry of entries) {
          if (entry.presets?.length) {
            Aglyn.components.unregisterPreset(
              entry.presets.map((preset) => preset.$id),
            )
          }
        }
        for (const entry of entries) {
          Aglyn.components.unregisterComponent(entry.schema.$id)
        }
      })
    },
  })
}
