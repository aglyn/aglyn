# @aglyn/plugins-inbox

The Inbox plugin for Aglyn: a console surface for reading a site's form submissions, replying to the people who sent them, and seeing the site's members and leads. Install it if you are running or building on the Aglyn platform and want its inbox.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/plugins-inbox@beta

Peer dependencies:

- `@mui/material`
- `@mui/x-data-grid`
- `firebase`
- `firebase-admin`
- `next`
- `react`

None is optional. `firebase-admin` and `next` are used by the server half (`@aglyn/plugins-inbox/server`).

## What's in it

This package is a first-party Aglyn plugin. It is loaded through Aglyn's plugin manager: the apps read its entry in the monorepo's `plugins.config.json`, import the module each surface names, and call the registrar declared for that surface. It is not a standalone library; installing it on its own loads nothing.

The Inbox is console-only. Submissions, members and leads live in Firestore and have no canvas component, so it adds nothing to a published page and declares no `site` registrar. It is not a mailbox: nothing in it receives mail. A submission arrives as a form post, and a reply is sent with `Reply-To` set to the sender's own console account address, so answers go to a real mailbox.

### In the console

`registerInboxConsole()` registers:

- An **Inbox** nav item and page at `/inbox`, with the sections Submissions, Members & leads, and Campaigns as routes. The page is code-split.
- An "Inbox" glance widget in the `hostDashboard` slot.
- A "Submissions" widget in the `formSubmissions` slot, a zone the forms plugin hosts on a form's page. It is the Inbox's own table narrowed to that form.
- Two zones the Inbox hosts for other plugins: the body of its Campaigns section, and a "where this came from" attribution area on a lead or submission. The plugin that owns campaigns draws in both.

### On the server

`registerInboxConsoleApi()` from `@aglyn/plugins-inbox/server` (the `consoleApi` surface) registers:

- `inbox/reply`: send one reply to the person who made a submission. A reply is transactional, so no marketing consent is read, but the suppression lists still apply.
- `inbox/list-options` and `inbox/assign-list`: show which marketing lists a submitter may be put on, and enroll them. Replying enrolls nobody, and enrolling sends nothing.

Routes are served by the host app's API dispatcher under `/api/`.

### Entry points

| import | contents |
| -- | -- |
| `@aglyn/plugins-inbox` | `BUNDLE_ID` and `registerInboxConsole` |
| `@aglyn/plugins-inbox/server` | `registerInboxConsoleApi`, `inboxReplyHandler`, `inboxListOptionsHandler`, `inboxAssignListHandler` |
| `@aglyn/plugins-inbox/*` | any module under `src/lib/` |

## Usage

The registrars are normally called by Aglyn's generated plugin loaders. Called directly:

```ts
// Console app
import { registerInboxConsole } from '@aglyn/plugins-inbox'
registerInboxConsole()

// Server-only API dispatcher
import { registerInboxConsoleApi } from '@aglyn/plugins-inbox/server'
registerInboxConsoleApi()
```

## How it fits

A plugin may import the tenant runtime, the renderer, the Besigner logic, the core and the shared packages. It never imports another plugin, and the core never imports a plugin. The Inbox depends on `@aglyn/aglyn`, `@aglyn/tenant-data-admin`, `@aglyn/tenant-feature-instance` and several `@aglyn/shared-*` packages, including `@aglyn/shared-util-email` for sending. It meets the forms and campaign plugins only through zones and widget slots registered with the core.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/plugins/inbox
