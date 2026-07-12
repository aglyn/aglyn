---
sidebar_position: 2
title: "Guide: console extensions & site surfaces"
description: Task-ordered recipes for nav/pages/widgets/providers and canvas components/site runtimes.
---

# Console extensions & site surfaces

Task-ordered recipes; the deep semantics live in
[Building feature plugins](../building-feature-plugins.md) and the
[API reference](../reference/plugin-manager-api.md).

## Add a console page

1. Export a `register*Console()` that calls `registerConsoleExtension`
   with a `navItems` entry carrying a lazy `Component`.
2. The shell serves it at `/[hostId]/<href>`, wires breadcrumbs/header,
   resolves the `featureFlag` entitlement, and passes
   `ConsolePluginPageProps { hostId, entitled, tenant, permissions }`.
3. Need data? Use `@aglyn/tenant-feature-instance` hooks
   (`useFirestoreCollection`, `usePluginConfig`, …) — never console-app
   hooks.
4. First-party: add the register fn to your `plugins.config.json` entry
   under `console` and re-run the manifest codegen (the scaffolder did
   both if you used it).

## Add a widget to a shell zone

Pick a zone from the [catalog](../reference/injection-zones.md), then:

```ts
registerConsoleExtension({
  pluginId: BUNDLE_ID,
  displayName: 'My plugin',
  widgets: [{ slot: 'dashboardFooter', widgetId: 'my-card', Component: MyCard }],
})
```

Your component receives the zone's documented props. Multiple plugins can
target one zone; the shell renders all of them.

## Wrap every console page (providers)

`providers: [MyProvider]` mounts around every console page once the
registry is populated — the community plugin's AI-assist provider is the
reference. Providers receive the org billing doc as `tenant`.

## Add a canvas component (Besigner + published sites)

Use `defineUiFeatureBundle` on your `site` surface — components get
schemas + presets and appear in the Besigner drawer. **Component ids are
persisted in screen documents; never rename them.** The editor and the
published site both suspend until your `site` surface registers, so the
canvas never renders unregistered components.

## Add a site runtime

A runtime renders on **every** published page of workspaces that enable
your plugin — overlay engines, analytics beacons, experiment runners:

```ts
registerSiteRuntime({ runtimeId: 'my-plugin', Component: MySiteRuntime })
```

Pair it with a server **enricher** (`registerSitePageEnricher`, `/server`)
that writes the props slice your runtime reads back from `page`. Enricher
errors are isolated — your slice drops, the page survives. Cross-plugin
wiring belongs in `bootstrap<Surface>()`, which runs after every plugin in
the batch has registered.

## Troubleshooting

- **Nav item missing**: the plugin isn't enabled/released for the
  workspace, or the register fn name in `plugins.config.json` drifted
  (the loader logs `missing register fn`).
- **Widget renders nowhere**: check the slot name against the catalog —
  unknown slots render only where an app mounts a custom
  `PluginWidgetSlot`.
- **Canvas blank in the editor**: your component registered on the
  `console` surface instead of `site` — the editor gates load `site`.
