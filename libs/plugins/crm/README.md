# @aglyn/plugins-crm

The CRM plugin for Aglyn: leads, contacts, companies, deals, tasks and reports, managed in the Aglyn console. Install it if you are running or building on the Aglyn platform and want its CRM.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/plugins-crm@beta

Peer dependencies:

- `@mui/material`
- `@mui/x-data-grid`
- `firebase`
- `firebase-admin`
- `next`
- `react`

None is optional. `firebase-admin` and `next` are used by the server half (`@aglyn/plugins-crm/server`).

## What's in it

This package is a first-party Aglyn plugin. It is loaded through Aglyn's plugin manager: the apps read its entry in the monorepo's `plugins.config.json`, import the module each surface names, and call the registrar declared for that surface. It is not a standalone library; installing it on its own loads nothing.

The CRM is console-only. Its records live in Firestore and it has no canvas component, so it adds nothing to a published page and declares no `site` registrar.

### In the console

`registerCrmConsole()` registers:

- A **CRM** nav item and hub at `/crm`, with the sections Contacts, Leads, Companies, Deals, Tasks, Reports, Fields and Settings as routes beneath it. The old `/contacts` address redirects to the hub. The hub is code-split, requires the `data.manage` permission, and sits behind the `crm` feature flag.
- Dashboard widgets "Tasks due" and "CRM at a glance" in both the `hostDashboard` (one site) and `orgDashboard` (whole organization) slots.
- A "Saves to contact fields" widget in the `formContactFields` slot, a zone the forms plugin hosts on a form's page.
- Two zones the CRM hosts for other plugins to draw in: one for booking a meeting from a record, and one that says which campaign or link a record came from.
- The CRM's record routes, so other surfaces can link to a record.

### On the server

`registerCrmConsoleApi()` from `@aglyn/plugins-crm/server` (the `consoleApi` surface) registers routes under the `crm` prefix for contact stage and field updates, contact creation and merge, lead conversion, deal stages, tasks, CSV imports of contacts, companies, deals, tasks and leads, one-to-one email and a contact's email history, erasing a person, organization-level activity, recipes, and the workspace's inbound email capture address. It also registers the CRM on two core seams, so another plugin can read a record's facts or file an item on a record's timeline without importing this package.

### Entry points

| import | contents |
| -- | -- |
| `@aglyn/plugins-crm` | `BUNDLE_ID`, `registerCrmConsole`, `CRM_CONSOLE_SECTIONS`, `crmRoutes(basePath)` for building links into the hub, and the `useContactFieldDefinitions` hook |
| `@aglyn/plugins-crm/server` | `registerCrmConsoleApi` and the route handlers |
| `@aglyn/plugins-crm/*` | any module under `src/lib/` |

## Usage

The registrars are normally called by Aglyn's generated plugin loaders. Called directly:

```ts
// Console app
import { registerCrmConsole } from '@aglyn/plugins-crm'
registerCrmConsole()

// Server-only API dispatcher
import { registerCrmConsoleApi } from '@aglyn/plugins-crm/server'
registerCrmConsoleApi()
```

## How it fits

A plugin may import the tenant runtime, the renderer, the Besigner logic, the core and the shared packages. It never imports another plugin, and the core never imports a plugin. The CRM depends on `@aglyn/aglyn`, the tenant packages (`@aglyn/tenant-runtime`, `@aglyn/tenant-data-admin`, `@aglyn/tenant-feature-instance`) and several `@aglyn/shared-*` packages. Where it meets bookings, forms or campaigns it does so through zones and core seams: one plugin hosts a zone, another registers a widget in it, and the core carries the contract.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/plugins/crm
