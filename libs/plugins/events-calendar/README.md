# @aglyn/plugins-events-calendar

The Events Calendar plugin for Aglyn: events managed in the console and listed on a published site. Install it if you are running or building on the Aglyn platform and want its events feature.

> Published to npm from the Aglyn monorepo. Versions follow [semantic versioning](https://semver.org).

## Install

    npm install @aglyn/plugins-events-calendar

Peer dependencies:

- `@mui/material`
- `firebase`
- `react`

None is optional. The server half additionally relies on `firebase-admin` through `@aglyn/tenant-data-admin`.

## What's in it

This package is a first-party Aglyn plugin. It is loaded through Aglyn's plugin manager: the apps read its entry in the monorepo's `plugins.config.json`, import the module each surface names, and call the registrar declared for that surface. It is not a standalone library; installing it on its own loads nothing.

### On a published site

- `eventList`: a list of the site's published events, each rendered with `schema.org/Event` JSON-LD.
- `eventCalendar` (calendar v2): month, week and list views (a phone gets the list), category chips, search, a details window with the ticket button, Add to calendar (Google link, `.ics` file) and the next dates, a subscribe link, and `schema.org/Event` per date.
- `eventDetails` (calendar v2): the one event a page's `?event=…&on=…` names, for an event page the owner designs once.

All three are registered by `registerEventsCalendarPlugin()`. The two v2 elements draw nothing until the workspace's `release_events_calendar_v2` is on (their doors answer `enabled: false`); in Preview they say so.

### In the console

`registerEventsCalendarConsole()` registers an **Events** nav item and page at `/events`, behind the `eventCalendar` feature flag, and an "Upcoming events" dashboard card. The page is code-split and loads when opened.

### On the server

`registerEventsCalendarApi()` from `@aglyn/plugins-events-calendar/server` (the `tenantApi` surface) registers two site-facing routes:

- `events/list`: published events for the Event List component, sorted by start, with a `mode=past` option. Drafts never leave the server.
- `events/dispatch`: receives a site event whose client-side trigger fired on the page, so that the action's server steps run.
- `events/occurrences` (v2): published events in a date range, a repeating event expanded to its dates on the site's clock, with the site's categories and each date's ticket offer; `category` and `q` filter it.
- `events/event` (v2): one published event at a date, and its next dates.
- `events/ics` (v2): the site's calendar as iCalendar (series kept as rules) to subscribe to, or one date to download.

`registerEventsCalendarServerDeclarations()` (the `serverDeclarations` surface) registers the `events` source of the site's search (`core.site-search`) and the plugin's settings (`calendarPath`, `eventPagePath`).

A ticket names a record another plugin owns (`product`, `service`), and the plugin that owns the kind answers how a visitor buys or books it through core's `core.site-offers` seam (`@aglyn/aglyn/plugin-manager/plugin-site-offers`): commerce posts a product to its cart with the event's day as the use day, bookings links to its booking page. This plugin imports neither.

`registerEventsCalendarConsoleServerDeclarations()` (the `consoleServerDeclarations` surface) registers the server half of the events import and export, and the `event` draft writer with the `event` build operation an Aglyn AI build or guided site start uses to make dated events and place the Event List on a page. An event is published for a member with the publishing role (admin or editor) and kept as a draft, with a notice, for an author; a new event with no cover gets one from the stock photo picker (`core.stock-photo-picker`) when a plugin registers one.

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
