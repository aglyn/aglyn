# @aglyn/plugins-events-calendar

The Events Calendar plugin for Aglyn: events managed in the console and listed on a published site. Install it if you are running or building on the Aglyn platform and want its events feature.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/plugins-events-calendar@beta

Peer dependencies:

- `@mui/material`
- `firebase`
- `react`

None is optional. The server half additionally relies on `firebase-admin` through `@aglyn/tenant-data-admin`.

## What's in it

This package is a first-party Aglyn plugin. It is loaded through Aglyn's plugin manager: the apps read its entry in the monorepo's `plugins.config.json`, import the module each surface names, and call the registrar declared for that surface. It is not a standalone library; installing it on its own loads nothing.

### On a published site

- One canvas component, `eventList`: a list of the site's published events, each rendered with `schema.org/Event` JSON-LD. Registered by `registerEventsCalendarPlugin()`.

### In the console

`registerEventsCalendarConsole()` registers an **Events** nav item and page at `/events`, behind the `eventCalendar` feature flag, and an "Upcoming events" dashboard card. The page is code-split and loads when opened.

### On the server

`registerEventsCalendarApi()` from `@aglyn/plugins-events-calendar/server` (the `tenantApi` surface) registers two site-facing routes:

- `events/list`: published events for the Event List component, sorted by start, with a `mode=past` option. Drafts never leave the server.
- `events/dispatch`: receives a site event whose client-side trigger fired on the page, so that the action's server steps run.

Routes are served by the host app's API dispatcher under `/api/`, for example `/api/events/list`. There is no `consoleApi` registrar.

### Entry points

| import | contents |
| -- | -- |
| `@aglyn/plugins-events-calendar` | `BUNDLE_ID`, `registerEventsCalendarConsole`, and the site half |
| `@aglyn/plugins-events-calendar/site` | `registerEventsCalendarPlugin` and `EVENTS_CALENDAR_BUNDLE` only, with no console code |
| `@aglyn/plugins-events-calendar/server` | `registerEventsCalendarApi` |
| `@aglyn/plugins-events-calendar/*` | any module under `src/lib/` |

## Usage

The registrars are normally called by Aglyn's generated plugin loaders. Called directly:

```ts
// Published site (canvas half only)
import { registerEventsCalendarPlugin } from '@aglyn/plugins-events-calendar/site'
registerEventsCalendarPlugin()

// Console app
import { registerEventsCalendarConsole } from '@aglyn/plugins-events-calendar'
registerEventsCalendarConsole()

// Server-only API dispatcher
import { registerEventsCalendarApi } from '@aglyn/plugins-events-calendar/server'
registerEventsCalendarApi()
```

## How it fits

A plugin may import the tenant runtime, the renderer, the Besigner logic, the core and the shared packages. It never imports another plugin, and the core never imports a plugin. Events Calendar depends on `@aglyn/aglyn`, `@aglyn/tenant-runtime`, `@aglyn/tenant-data-admin`, `@aglyn/tenant-feature-instance` and a few `@aglyn/shared-*` packages. It is the smallest plugin with all three halves (site, console, server) and is a reasonable one to read first.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/plugins/events-calendar
