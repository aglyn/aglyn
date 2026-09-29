# @aglyn/plugins-mui

The component palette for Aglyn sites, built on Material UI. It is the base element library every Aglyn site is drawn with: layout, text, navigation, media, content collections and more, each registered with the core component registry together with its schema and presets. Install it if you render Aglyn documents or run the Besigner; it is a first-party plugin, loaded through Aglyn's plugin manager.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/plugins-mui@beta

Peer dependencies: `react`, `@mui/material`, `@mui/utils`.

## What's in it

The plugin has one registrar, `registerMuiPlugin` (the `site` registrar in `plugins.config.json`), and is marked always-on: it has no console page, no nav item and no API routes. Feature bundles from other plugins declare a dependency on it and wait until it is in the plugin manager.

**Elements.** The component ids the plugin registers are listed under `contributes.site.components` in `plugins.config.json` and as the keys of `MUI_COMPONENT_SOURCES`. By group:

- Layout: `section`, `muiContainer`, `muiStack`, `muiBox`, `muiGrid`, `muiPaper`, `layoutSlot`.
- Text and actions: `muiTypography`, `muiInlineText`, `muiButton`, `markdown`, `tableOfContents`, `icon`.
- Navigation: `muiAppBar`, `muiToolbar`, `muiNavMenu`, `muiMegaMenu`, `muiDrawer`, `muiDrawerToggle`, `muiScreenLink`, `muiLinkBox`, `muiBreadcrumbs`, `muiPagination`, `searchBox`, `languageSwitcher`, `themeModeSwitcher`.
- Surfaces: `muiCard` and its header, content and actions, `muiAccordion` and its summary and details, `muiTabs`, `muiTabPanel`, `muiList`, `muiListItem`, `muiListItemText`.
- Media: `image`, `video`, `videoEmbed`, `muiImageList`, `muiImageListItem`, `socialLinks`.
- Data and content: `dataTable`, `collectionEntries`, `collectionEntryBody`, `collectionEntryMeta`, `collectionEntryAuthor`, `collectionRelated`, `collectionShare`, `collectionCategories`, `collectionSearch`, `contentAuthorProfile`, `product`.
- Functions: `functionWidget`, `functionScope`, `functionInput`, `functionOutput`, `functionShow`.
- Other: `reusableInstance`, `custom-html`, `marketplacePlugin`, and `div`, the root of a document.

**Component ids are persisted.** Every node in a saved screen document stores its `componentId` beside `pluginId: 'mui'`, so the ids above, including the legacy `mui`-prefixed ones, do not change without a document migration.

**Per-component loading.** Each element lives in its own module behind a dynamic import. `registerMuiPlugin(use)` accepts a `PluginUse` from `@aglyn/aglyn`; when `use.componentIds` names the elements a page places, only those modules are fetched. Called with no argument it registers the whole library, which is what the console and the Besigner need for their palette. Calling it again with further ids adds to what is already registered.

**Exports from `.`**

- `registerMuiPlugin`, `loadMuiBundle`, `MUI_COMPONENT_SOURCES`, the `MuiBundleEntry` and `MuiComponentSource` types, and `BUNDLE_ID` (`'mui'`).
- `PluginFrame` and `PluginFrameProps`: the host side of the sandbox an installed marketplace plugin runs in. It renders the plugin in a cross-origin sandboxed iframe and talks to it only over a capability-scoped `postMessage` bridge, and shows a placeholder instead whenever the plugin cannot run safely.
- `muiPluginInstallToPreset`, `PluginInstallLike`, `PLUGIN_DRAWER_CATEGORY`: how an installed marketplace plugin becomes a palette entry that places a `marketplacePlugin` node.
- `sanitizeCustomHtml`: the sanitizer the `custom-html` element applies to authored markup.

## Usage

```ts
import { registerMuiPlugin } from '@aglyn/plugins-mui'

// An editor or console: the whole palette.
await registerMuiPlugin()

// A published page: only the elements this page places.
await registerMuiPlugin({ componentIds: ['section', 'muiTypography', 'muiButton'] })
```

In an Aglyn app you do not call this yourself: the generated loader manifest calls the registrar and passes the component ids it read from the page's document. An element whose component was never registered renders nothing, so a surface that cannot say what it places should register the whole library.

## How it fits

A plugin package (`scope:plugin`). It depends on the core (`@aglyn/aglyn`) and on generic shared packages (`@aglyn/shared-ui-jsx`, `@aglyn/shared-ui-theme`, `@aglyn/shared-data-enums`, `@aglyn/shared-data-mdi`, `@aglyn/shared-util-vendor`), and uses `mobx` to batch registration. It imports no other plugin and none of the designer UI. No other plugin imports it either: a feature bundle names `mui` as a dependency id in the plugin manager rather than importing the package, and the form elements that once lived here are in `@aglyn/plugins-forms`.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/plugins/mui
