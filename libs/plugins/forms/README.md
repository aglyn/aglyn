# @aglyn/plugins-forms

The Forms plugin for Aglyn: the `form` and `formField` elements that draw a form on a site, and the console section that holds a workspace's form catalog. Install it if you render Aglyn documents that place forms, or run the Aglyn console; it is a first-party plugin, not a standalone library.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/plugins-forms@beta

Peer dependencies: `react`, `next`, `@mui/material`, `@mui/x-data-grid`, `firebase`.

## What's in it

The plugin declares two registrars in `plugins.config.json`, plus a `site` module so a published page can load the canvas half alone.

**On a published site** (`registerFormsPlugin`, the `site` registrar, exported from `@aglyn/plugins-forms/site`). It adds the `forms` feature bundle to the plugin manager with two elements:

- `form`: the form itself, with what happens after a submit (a message, a redirect or a reveal).
- `formField`: a field inside a form. It ships with the form rather than with the generic elements because it reports its name and dataset mapping to the enclosing form; a field with no form around it submits nowhere.

Presets for both, including a composed contact section, appear in the Besigner's element picker. `FORMS_BUNDLE` is the list of entries the bundle registers.

**Console** (`registerFormsConsole`, the `console` registrar):

- A `Forms` nav item at `/forms`: the form catalog and one form's own page (declaration, metrics, versions, promotion, design preview). The nav item owns its subtree, because a form's URL names a document id. The page is code-split and loads when opened.
- Two zones the plugin hosts on a form's page for other plugins to fill, registered with `registerPluginZone`: `formSubmissions`, where a reader of that form's submissions is drawn, and a zone for mapping a form's fields onto a person's fields.

**Ids are persisted.** `componentId` (`form`, `formField`) is stored in every screen document and does not change. `pluginId` is stored beside it and is `forms` (`BUNDLE_ID`); the renderer reads it to decide which bundles must register before first paint, so a page with no form on it does not wait for this package.

**What is not here.** The plugin has no server entry. The form model and the publish-time contract check live in `@aglyn/aglyn`, and the submit endpoint belongs to the tenant app, which resolves a form through `@aglyn/tenant-runtime`. They sit on the core side because the core may not import a plugin. Switching Forms off for a site is therefore not a property of this bundle: every half, including the submit route and the publish check, asks the site's plugin set about the `forms` id. Submissions are read through the zone above by whichever plugin registers a reader there.

## Usage

The plugin is loaded through Aglyn's plugin manager: the generated loader manifests import the package and call the registrars named in `plugins.config.json`. An app that wires plugins by hand calls them once at startup:

```ts
// published site or editor canvas: the elements alone
import { registerFormsPlugin } from '@aglyn/plugins-forms/site'
registerFormsPlugin()

// console
import { registerFormsConsole } from '@aglyn/plugins-forms'
registerFormsConsole()
```

Import the canvas half from `./site`, not from the root: the root entry also carries the console registrar and its page. The feature bundle depends on the `mui` bundle, so `@aglyn/plugins-mui` must be registered for the elements to load.

## How it fits

A plugin package (`scope:plugin`). It depends on the core (`@aglyn/aglyn`), the tenant client hooks (`@aglyn/tenant-feature-instance`) and generic `@aglyn/shared-*` packages. It imports no other plugin: it names the `mui` bundle by the id the core exports, and the plugins that read submissions or map fields onto a contact meet it through console zones. The core never imports this package.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/plugins/forms
