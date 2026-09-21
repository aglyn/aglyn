# @aglyn/plugins-bookings

The Bookings plugin for Aglyn: bookable services, open time slots, and free or paid appointments taken on a published site and managed in the console. Install it if you are running or building on the Aglyn platform and want its booking feature.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/plugins-bookings@beta

Peer dependencies:

- `@mui/material`
- `firebase`
- `firebase-admin`
- `next`
- `react`

None is optional. `firebase-admin` and `next` are used by the server half (`@aglyn/plugins-bookings/server`).

## What's in it

This package is a first-party Aglyn plugin. It is loaded through Aglyn's plugin manager: the apps read its entry in the monorepo's `plugins.config.json`, import the module each surface names, and call the registrar declared for that surface. It is not a standalone library; installing it on its own loads nothing.

### On a published site

- One canvas component, `booking`: a service and time picker that books an appointment. It is placed in Besigner like any other element and registered by `registerBookingsPlugin()`.

### In the console

`registerBookingsConsole()` registers:

- A **Bookings** nav item and page at `/bookings`, behind the `bookings` feature flag. The page is code-split and loads when opened.
- A "Book a meeting" widget in the `crmRecordBooking` slot. The CRM plugin hosts that zone on a record; this plugin draws the control in it, so neither package imports the other.
- A plugin config schema (`BOOKINGS_CONFIG_SCHEMA`) with two settings: `maxDaysAhead` (the booking horizon in days) and `bookingPath` (the page on the site that holds the Booking block, used to build booking links).

### On the server

`@aglyn/plugins-bookings/server` imports `firebase-admin` and is kept out of the client entry point.

- `registerBookingsApi()` (the `tenantApi` surface) registers the site-facing routes `bookings/slots` (open slots for a service) and `bookings/book` (take a booking; a paid service goes through Stripe Checkout).
- `registerBookingsConsoleApi()` (the `consoleApi` surface) registers `bookings/reminders`, `bookings/refund` and `bookings/booking-analytics`, a handler on the platform billing webhook that confirms paid bookings, and a bookings-by-service figure reader.
- Loading the module registers two scheduled plugin jobs: `expire-stale-holds` and `booking-reminders` (a reminder email about a day before a confirmed booking). This is why `package.json` lists `./src/lib/server.*` under `sideEffects`.

Routes are served by the host app's API dispatcher under `/api/`, for example `/api/bookings/slots`.

### Entry points

| import | contents |
| -- | -- |
| `@aglyn/plugins-bookings` | `BUNDLE_ID`, `registerBookingsConsole`, the site half, and the pure model (`computeOpenSlots`, `isSlotOpen`, `bookingLinkFor`, `normalizeBookingPath`, the `HostBookingService` and `BookingSlot` types) |
| `@aglyn/plugins-bookings/site` | `registerBookingsPlugin` and `BOOKINGS_BUNDLE` only. This is what a published page loads, so it carries no console code |
| `@aglyn/plugins-bookings/server` | `registerBookingsApi`, `registerBookingsConsoleApi`, `slotsHandler`, `bookHandler`, `scanBookingReminders` |
| `@aglyn/plugins-bookings/*` | any module under `src/lib/` |

## Usage

The registrars are normally called by Aglyn's generated plugin loaders, not by hand. Called directly they look like this:

```ts
// Published site (canvas half only)
import { registerBookingsPlugin } from '@aglyn/plugins-bookings/site'
registerBookingsPlugin()

// Console app
import { registerBookingsConsole } from '@aglyn/plugins-bookings'
registerBookingsConsole()

// Server-only API dispatcher
import {
  registerBookingsApi,
  registerBookingsConsoleApi,
} from '@aglyn/plugins-bookings/server'
registerBookingsApi()
```

## How it fits

A plugin may import the tenant runtime, the renderer, the Besigner logic, the core and the shared packages. It never imports another plugin, and the core never imports a plugin. Bookings depends on `@aglyn/aglyn` (the core and its plugin-manager seams), `@aglyn/tenant-runtime`, `@aglyn/tenant-data-admin`, `@aglyn/tenant-feature-instance` and several `@aglyn/shared-*` packages. What it shares with other plugins goes through core seams: tax on a paid booking is asked of the core's plugin tax profile, and the CRM control is drawn in a zone the CRM hosts.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/plugins/bookings
