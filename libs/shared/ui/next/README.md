# @aglyn/shared-ui-next

React components and hooks that depend on Next.js: a two-column tab hub whose active tab lives in the URL, a route-based section rail, a `next/image` wrapper with a shimmer placeholder, and a page title provider. The Aglyn console and the console pages that plugins ship are built with it. It assumes the App Router (`next/navigation`).

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/shared-ui-next@beta

Peer dependencies: `react`, `next`, `@mui/material` and `@mui/lab` (the tab components use `TabContext`, `TabList` and `TabPanel` from `@mui/lab`).

## What's in it

From the root entry:

- `HubTabs` — a navigation card with vertical tabs on the left and the active panel on the right, collapsing to horizontal tabs on small screens. Takes `tabs: { id, label, content }[]`, an optional `navHeader`, and `lazy` to defer mounting a panel until it is first opened. The active tab is mirrored into the `?tab=` query parameter, so a tab can be linked to and survives back and forward. Panels stay mounted once shown.
- `HubSections` — the same rail, choosing a section by route instead of by panel. Takes `sections: { href, label, visible?, locked? }[]` and renders `children` (the current route's page) beside the rail. Use it when each section should be its own code-split route. Pass `wide` for a page that needs the whole row, such as a wide table or a record's detail: the rail is then drawn above it as a horizontal strip.
- `useActiveSection(sections)` — the section the current pathname is inside, matched by longest `href` prefix on a path-separator boundary, or `null`. Useful for a breadcrumb that must agree with the rail.
- `Image` — `next/image` wrapped as an Emotion styled component, with an animated SVG shimmer as the blur placeholder. `width` and `height` default to 100; pass `disableShimmer` to turn the placeholder off.
- `NextPageTitleProvider`, `NextPageTitle`, `useNextPageTitle`, `useNextPageTitleContext` — compose a document title from parts and render it through `next/head`.
- `PageDecorated` and the `NextPageWithLayout` types — render a page inside the layout the page itself declares.

By subpath:

- `@aglyn/shared-ui-next/hooks/use-tab-param` — `useTabParam({ ids, param?, fallback?, onChange? })` returns `{ tab, onTabChange }`, the URL-backed tab state `HubTabs` is built on. `onTabChange` is a drop-in for a Material UI `TabList`'s `onChange`.

## Usage

```tsx
'use client'

import { HubTabs } from '@aglyn/shared-ui-next'

export function SettingsHub() {
  return (
    <HubTabs
      navHeader="Settings"
      tabs={[
        { id: 'general', label: 'General', content: <p>General settings</p> },
        { id: 'members', label: 'Members', content: <p>Members</p> },
      ]}
    />
  )
}
```

`/settings?tab=members` opens the second tab.

## How it fits

A `shared` UI package. It depends on `@aglyn/shared-ui-jsx`, `@aglyn/shared-ui-theme`, `@aglyn/shared-data-enums`, `@aglyn/shared-util-dom` and `@aglyn/shared-util-tools`; the feature plugins depend on it for their console pages. Shared packages are generic: they import only other shared packages and hold no plugin's domain.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/shared/ui/next
