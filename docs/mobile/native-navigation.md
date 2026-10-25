# Native apps: navigation

AGL-3943, project P-AGL-141. The build sheet for the native navigation
redesign on both shells: AGL-3945 (Apple: SwiftUI on iPhone, iPad and Mac) and
AGL-3946 (Kotlin: Compose on Android phone and tablet, and Windows). Zach
decided the plan on 2026-10-18 and asked for all four phases to be built
straight through, then reviewed together. This page maps each piece to the
code: the shared contracts it reads, the existing screens it reuses, and what
is new.

The web console's own navigation does not change, with one exception: pins are
capped at five there too (§3).

## 1. The shared contracts

Both shells read the same data. It is written once in TypeScript, in plain
modules on `tools/scripts/mobile-pure-modules.json`, and generated into Swift
and Kotlin by `npm run generate:native-contracts` (`native-architecture.md` §5).
Never hand-edit the generated files.

| contract | source | what the apps get |
| -- | -- | -- |
| nav manifest | the core's lists and rows in `libs/aglyn/src/lib/app-utils/native-nav.ts`; each plugin's rows in `libs/plugins/<plugin>/src/lib/native-nav.ts` (`NATIVE_NAV_ROWS`, `NATIVE_NAV_ELSEWHERE`) | `ContractValues.nativeNavManifest` (`NativeNavManifest`, assembled by the generator), `nativeNavShellScreens`; `resolveNavList` cases |
| account preferences | `libs/aglyn/src/lib/app-utils/account-preferences.ts` | the `users/{uid}` field names, caps and defaults; `AccountItemRef`, `StarredItem`, `RecentItem`, `AppThemePrefs`, `RailWorkspaces`, `WorkspaceColor` and their enums; cases for every rule |
| one-box search | `libs/aglyn/src/lib/app-utils/one-box-search.ts` | `ONE_BOX_SEARCH_PATH`, `OneBoxResponse`, `OneBoxGroup`, `OneBoxRow`; `searchNavScreens` cases |

The pure functions (pins, the rail, recents, stars, the workspace color, the
theme reader, `resolveNavList`, `searchNavScreens`, the one-box paging
helpers) are ported once per platform: Apple in `AglynContracts`, Kotlin in
the `contracts` module. Each port replays every case in
`libs/native/contracts/function-cases.generated.json`, the way the order
formatters and the plugin switchboard already do, so no platform can drift
from the console's answers.

### The nav manifest

The core never names a plugin (`docs/PACKAGES.md` rule 3,
`check:plugin-domain-in-core`). So the core module holds the lists, the
groups and the core's own rows, and each plugin declares its own rows and the
list and group each one goes in (`NativeNavContribution`), placed by `order`.
The generator's `assembled` step in `tools/scripts/native-contracts.json`
runs `assembleNativeNav(core, rows, elsewhere)` over every listed plugin
module. That is the manifest in `contracts.generated.json`. The drift spec
requires every plugin with a `native-nav.ts` to be listed there.

The manifest holds four lists. Each list has groups, and each
group has rows:

- `workspace`: the sidebar for the whole workspace.
- `site`: the sidebar inside one site.
- `workspaceSettings`: the settings mode opened from the workspace menu.
- `siteSettings`: the settings mode opened from the site's Site settings row.
  It merges the console's Setup and Admin into one list.

A group (`NativeNavGroup`) has an `id`, an optional heading (`label`) and
`foldable`. A foldable group starts folded unless it holds the screen in use,
and each device remembers what the person opens. A group with
`dynamic: 'starred'` is filled by the shell with the person's starred items
for that scope.

A row (`NativeNavRow`) has these fields:

- `id`: the idea, the same in every list that shows it. Both sidebars use
  `media`, for example.
- `label`: the console's word for the place. `consoleLabel` is set only where
  Zach chose a different word, such as Overview for the site's analytics.
- `icon`: `{ apple, android }`, one SF Symbol and one Material Symbol per
  idea.
- `screen` and `params`: the native screen the row opens. This is a plugin's
  declared screen, a core screen spec (`core.*`), a site platform screen
  (`site.*`) or a shell destination (`shell.home`, `shell.analytics`,
  `shell.workspaceSettings`, `shell.siteSettings`).
- `pluginId`: the row hides when that plugin is off.
- `requiresHostAdmin`: only a site admin sees the row, just as only a site
  admin sees the console's Admin tab.
- `description`: a settings row's one line, in the words the native Setup
  screens already use.
- `keywords`: extra words search matches, so "billing" finds Plan.
- `sections`: the areas inside the row, as the console's section rail lists
  them. A section names its own `pluginId` only when it belongs to another
  plugin.
- `actions`: title-bar actions, such as Scan stock and New product on
  Products.
- `console`: where the row's twin is in the console (`NativeNavConsoleRef`).
  `apps/console/specs/native-nav-manifest.spec.ts` reads this reference.

**Help docs (`docs`).** A row and each of its sections may carry `docs`: a
docs-site path with its anchor, such as
`/content-and-data/crm/overview#at-the-organization-level`. It is the help
the console's own page for that place offers:

- a plugin hub's `header.docsTopic` and `docsAnchor`, for that scope;
- a settings hub's `help` prop: Team, Billing, workspace Settings, site
  Admin;
- the Sites list's `help` prop.

A section gets its row's page unless the console names one of its own. The
apps open it in the in-app browser, on the docs origin. The drift spec reads
the console's registry (`apps/console/constants/docs-help.generated.ts`) and
holds every row to it, including leaving `docs` out where the console's page
has no help.

**Create new (`create`).** `NATIVE_NAV_MANIFEST.create` holds one
`NativeNavCreateList` per scope, `workspace` and `site`. Each item
(`NativeNavCreateItem`) has these fields:

- `id`, `label`, `icon`;
- `screen` and `params` (`new: '1'` opens the area's create form);
- `pluginId`, `requiresHostAdmin`, `permission`, `hostRoles`;
- `planFeature` and `blockedReason`;
- `order`;
- `console`, where the console offers the same action.

The core offers Site (workspace) and Page (site). Each plugin adds its own
items in its `native-nav.ts` (`NATIVE_NAV_CREATE`).

| scope | items | the console's action |
| -- | -- | -- |
| workspace | Site, Contact, Email template | "Create site" on Sites; "New contact" on CRM → Contacts; "New template" on Emails → Templates |
| site | Page, Product, Draft order, Service, Event, Form, Contact | "Create new page"; "Add product"; "Draft order"; "Add service"; "Add event"; "Create Form"; "New contact" |

Three requested items are not offered, because the console has no such
action:

- **Booking:** bookings come from the site. The console's Bookings page
  creates a *service*.
- **Customer text:** there is no console page for texts. The native screen
  holds the texting settings.
- **Order:** the console creates a *draft order*.

`resolveCreateList(manifest, scope, enabledPluginIds, permissions, features,
hostRole)` builds the menu. An item of a plugin that is off is not offered.
Otherwise the item is shown, and is blocked with a reason when one of these
holds, checked in this order:

1. The workspace permission is not held (`NATIVE_CREATE_PERMISSION_REASON`).
2. The person's site role is not in `hostRoles` (`NATIVE_CREATE_SITE_ROLE_REASON`).
3. The plan lacks `planFeature` (`blockedReason`, or `NATIVE_CREATE_PLAN_REASON`).

This follows the prerequisite rules: shown, never hidden. The draft order's
Stripe prerequisite is shown inside its sheet, as in the console. Today only
`commerce.product` reads `new: '1'`. Each other screen opens its existing
create sheet when it reads the param, which is part of the Create new piece
in Phase 2.

`NATIVE_NAV_MANIFEST.elsewhere` lists the console places that no row holds,
and says where each went: the site Dashboard is the site's Home, Setup and
Admin are Site settings, POS is the Aglyn POS app, Team, Billing and Settings
are Workspace settings, and Support is the help menu.

To draw a list, call `resolveNavList(manifest, listId, enabledPluginIds,
hostAdmin)`, with `ContractValues.nativeNavManifest` as `manifest`. In the
cases file, `resolveNavList` and `searchNavScreens` name
`leadingValue: NATIVE_NAV_MANIFEST`: each case's `args` leave the manifest
out, and a replay passes it first.
It drops the rows and sections of plugins that are off and the admin rows a
non-admin may not open. Pass the site's effective plugins in site scope
(`resolveHostEnabledPlugins` from the ported switchboard, already in both
kits) and the workspace's (`resolveEnabledPlugins`) otherwise. The shell then
also drops a row whose screen the registry does not hold, so a build without
a plugin's screen never shows a dead row.

The lists as built:

| list | groups and rows |
| -- | -- |
| workspace | Home · Starred · Sites, CRM, Inbox, Emails, Marketing, Automation, Accounting, Sequences, Media, Data, Marketplace |
| site | Home, Overview · Starred · **Website**: Pages (sections Pages, Components, Layouts, Templates, Content), Media, Forms, Logic · **Sell**: Orders (Orders, Returns, Reservations), Products (Catalog, Promotions, Analytics; Scan stock, New product), Bookings, Events · **Customers**: Inbox (Submissions, Members & leads, Campaigns), CRM (Contacts, Leads, Companies, Deals, Tasks, Reports, Fields, Settings), Emails (Messages, Templates, Audiences, Topics, Sending, Suppressions), Marketing (Overview, Campaigns, Conversions, Overlays, A/B testing) · **More**: Automation, Redirects, Funnels, Customer texts, AI jobs, Data · Site settings |
| workspaceSettings | **Team**: Members, Custom roles, Recent activity · **Billing**: Plan, Usage, AI credits, Invoices, Settings · **Workspace**: Plugins, Branding, Single sign-on, Profile, API keys, Integrations, General · **Data & compliance**: Privacy, Holds & reviews, Import & export · **Danger zone**: Ownership, Delete |
| siteSettings | Users · **Setup**: Basic details, Business profile, SEO, Tracking, Theme, Emails, Integrations · **Admin** (site admins): General, Plugins, Custom Domain, Security, Error pages, Activity, Backup & template, Danger zone |

Zach decided the site groups and More's first four rows (Automation,
Redirects, Funnels, Customer texts). The decision did not place AI jobs or the
site's Data, so they sit at the end of More. Components, Layouts, Templates
and Content became sections of Pages, the way the proposal folds sections into
their area. The final review should look at both placements.

### Account preferences on `users/{uid}`

| field | shape | cap | written by |
| -- | -- | -- | -- |
| `pinnedOrgs` | workspace ids, in the person's order | 5; a longer list may only shrink | console chooser, app rail and switcher |
| `pinnedHosts` | `PinnedHost[]`: `orgId`, `hostId`, in the order pinned | 5 a workspace in the console; 100 in all | console Sites list (the site switcher lists them first) |
| `recentOrgs` | workspace ids, newest first | 8 | app, on opening a workspace |
| `starred` | `StarredItem[]`: `kind`, `id`, `orgId`, `hostId?`, `label`, `screen`, `params?`, `color?`, `starredAtMs` | 50 | app ☆ |
| `recents` | `RecentItem[]`: the same reference, plus `openedAtMs` | 30 | app, on opening a screen or record |
| `workspaceColors` | `{ [orgId]: '#RRGGBB' }` | 100 | app, account menu → Theme → Workspace colors |
| `appTheme` | `AppThemePrefs`: `appearance`, `theme`, `accent`, `density`, `textSize`, `sidebarStyle`, `appIcon`, `useWorkspaceBrand` | its own keys and values | app, account menu → Theme |
| `tabBars` | `TabBarPins[]`: `scope` (`site:<hostId>` or `org:<orgId>`), `areas` (nav row ids, in order), `chosen` | 4 areas a scope, 100 scopes | phone: long-press a Home tile, the account sheet → Tab bar, and the first areas opened (§9) |

- A `kind` is `screen` for a nav row (its `id` is the row's) or a one-box
  group id for a record (`page`, `order`, `contact` and so on).
- A star's color is a named `StarColor`, which each platform draws from its
  own theme tokens. No screen hand-types a color.
- The per-device theme override ("Apply to this device only") is local to the
  device, in `UserDefaults` or DataStore, and is never written to the account.
- A workspace's color comes from `resolveWorkspaceColor(picked, brand, logo,
  useWorkspaceBrand)`. The color the person picked wins, then the workspace's
  `brandingProfile.primaryColor`, then a color taken from the logo. The rail
  tile always shows it. The app is tinted with it unless the person turned
  "Use each workspace's brand" off, which stops brand and logo tints. A
  picked color still tints, because the person chose it.
- Write one field at a time with a merge. Write recents at most once per
  opened item: skip the write when the item is already first. Each write
  costs a document write, and both apps listen to the document.

`cloud/firebase-firestore.rules` (`accountPrefsValid()` on `users/{userId}`)
holds every cap, refuses a sixth pin and holds `appTheme` to its keys and
values. A field is checked only when a write touches it, so an ordinary edit
beside an over-cap list still lands. The matrix in
`cloud/rules-tests/firestore-rules.test.mjs` covers each case. These rules
must be deployed (§6).

## 2. Phase 1: scope and structure

| piece | Apple (AGL-3945) | Kotlin (AGL-3946) | reads / writes | reuses | new |
| -- | -- | -- | -- | -- | -- |
| Workspace picker, then site picker | replaces `SwitcherView` (iPhone sheet, Mac/iPad popover) | replaces `SwitcherScreen` | `users/{uid}/orgs` (paged, as `WorkspaceStore` does), `pinnedOrgs`, `recentOrgs`; sites from `users/{uid}/hostMemberships`; server search through the one box | `WorkspaceStore` paging and logos, the console's `arrangeWorkspaces` order (pinned, then A to Z) | search field, pinned and recent sections, role and plan badges |
| Workspace rail (Mac, iPad, Android tablet; phones use the picker) | new column left of `NavigationSplitView` | new rail in `AglynNavigationSuite` at expanded width and up | `railWorkspaces(orgIds, pinnedOrgs, recentOrgs)`, `resolveWorkspaceColor`; unread badges from the notification feed | logo tiles (`BrandPicture`, `orgLogos`) | the rail; ⌘1–⌘5 to pins; drag to reorder (`movePinnedOrg`); "+" for create or accept invite |
| Sidebar per scope | rebuilds `MainShell`'s sidebar from `resolveNavList('workspace' or 'site')` in place of `SidebarScreen.all` and `CoreGroupList` | rebuilds the drawer from the same, in place of `shellPlaces` | the manifest, plugin switchboard, host role | every screen the rows name exists | groups, folding, the Starred group |
| **Org-scope modes** | CRM, Inbox, Emails and Marketing open at workspace scope | the same | the org-level data the console's org pages read | the site screens | **new**: the plugins' `crm.*`, `inbox.*`, `email.*` and `marketing.*` screens are `requiresSite = true` today on both platforms. At workspace scope each needs an org mode that mirrors the console's org page (`CrmConsolePage`, `InboxConsolePage` with `INBOX_ORG_CONSOLE_SECTIONS` and its org-wide submissions, `EmailsConsolePage`, `MarketingConsolePage` with `MARKETING_ORG_CONSOLE_SECTIONS`): the same section ids and labels, at org data scope. At workspace scope Members & leads needs `data.manage`. Automation already has `workflows.org-automation` |
| Settings as a mode | the sidebar swaps to `resolveNavList('workspaceSettings' or 'siteSettings')` with a back arrow | the same | the manifest; host role | every settings screen (`core.settings.*`, `core.team*`, `core.billing*`, `core.site.*`, `site.setup` with `section`, `site.theme`, `ai.credits`) | the mode; grouped rows with descriptions |
| Workspace menu (its name ▾) and account menu (photo at the foot of the rail) | menus | menus | — | the account screens `core.account.*`, `core.support`, notification settings | Theme ▸ submenu (Phase 4 data); Add account |
| Add account | multiple signed-in accounts in the Keychain, one Firebase app per account, push per account | the same with the platform credential store | `users/{uid}/devices` per account | the existing auth stack | all of it |
| Labels and icons | from the manifest | from the manifest | — | — | Logic, not "Functions & Variables"; Users, not "Team on this site"; one icon per idea |

## 3. The console's five-pin cap (shipped in this change, web)

Zach decided "five everywhere, the console included". What the console does
now:

- `apps/console/hooks/use-pinned-orgs.ts` returns `pinned`, the pins in force:
  at most five, and the first five stored until the person picks. It also
  returns `stored`, `overCap` and `full`, and three actions. `toggle` answers
  `full` for a sixth pin and writes nothing. `replace` and `keep` write the
  whole list, five pins or fewer. A write the rules refuse puts the stored
  list back instead of showing a pin that never landed.
- On the workspace chooser (`app/(app)/(home)/page.tsx`), a sixth pin opens
  "Pinned is full. Replace one?" (`PinnedFullDialog`). The dialog lists the
  five pins, each with Replace, and has a Keep my pins button. The pin button
  stays on screen and enabled, and its tooltip says why it asks.
- A person who pinned more than five before the cap sees "Keep which 5?"
  (`PinnedOrgsKeepPrompt`, on the console's persistent chrome in
  `main.layout.tsx`) once. The first five are ticked. "Keep these" stays on
  screen, disabled with its reason, while more than five are ticked. Closing
  the prompt keeps the first five, so it is never asked again.
- The rules hold the same cap (§1).

## 4. Phase 2: finding and making things

| piece | Apple | Kotlin | reads / writes | reuses | new |
| -- | -- | -- | -- | -- | -- |
| The one box (⌘K): search and switching in one place | the title bar field and ⌘K palette | the top bar field and Ctrl+K on desktop | `GET /api/search` (§5) with the ID token; `OneBoxResponse`; plus the local `searchNavScreens` group | `ConsoleAPIClient` / Ktor API client; deep-link resolution of `row.link` (`context.openLink`, `model.open`); the switcher's selection for workspace and site rows | the box, grouped results, "Show more" per group (`group`, `cursor`), back, forward and history |
| Starred and Recents | ☆ in each screen's title bar; the Starred group; Home's recents | the same | `starred`, `recents` (`toggleStarred`, `setStarColor`, `recordRecent`) | — | all of it |
| Home: what needs you | rework of `HomeView` | rework of `HomeScreen` | orders by status, unanswered inbox, today's bookings, failed payments, finished AI jobs (the data the apps already list) | existing list screens, opened with their filters | the "Needs you" lines; recents as cards; the one-line AI prompt that opens the existing Create with AI flow |
| Create new | "+" on the rail; the center tab on phones | the same | `resolveCreateList` over the manifest's `create` (§1), with the workspace's permissions and plan features and the person's site role | each area's own create form, shown as a sheet | the menu, with a blocked item shown disabled and its reason; each screen reading `new: '1'` (only `commerce.product` does today) |
| Notifications popover | the bell in the title bar | the same | `users/{uid}/notifications` | `NotificationsView` / `NotificationsScreen`, notification settings | the popover, with a scope filter and All / Unread; the sidebar row goes |

## 5. The one-box route

`apps/console/app/api/search/route.ts` handles the request, and
`apps/console/app/api/_lib/one-box-search.ts` does the work.

- **Request:** `GET /api/search?q=…&orgId=…&hostId=…&limit=…&group=…&cursor=…`
  with `Authorization: Bearer <ID token>`. Console routes are not App Check
  gated (`native-architecture.md` §4).
  - `q` must be at least two characters and is capped at 100.
  - `limit` is 5 rows per group by default, 25 at most.
  - `group` with `cursor` pages one group.
  - A `hostId` needs its `orgId`.
- **Limits:** 60 searches a minute per account (`checkRateLimit`, which
  answers 429 with `RateLimit-*` headers). A locked workspace or site
  answers 423 through `lockdownRefusal`.
- **Response:** `OneBoxResponse`, whose `groups` are in the palette's order:
  - `workspaces`, from the caller's `users/{uid}/orgs`, in every workspace;
  - `sites`, from `users/{uid}/hostMemberships`, narrowed to `orgId` when one
    is sent, otherwise every site;
  - under a site, the console palette's own groups: pages, emails,
    components, layouts, templates, content and authors;
  - every plugin's search sources: CRM contacts, leads, companies, deals,
    tasks and activities; products and **orders**; services; redirects;
    workflows.
  - Each row carries a console `link`. The apps open it through their
    deep-link grammar, so a record opens on its native screen and a Besigner
    page opens in the in-app Besigner.
  - The screens-and-settings group (`appScreens`) is the apps' own:
    `searchNavScreens(ContractValues.nativeNavManifest, q, scope,
    enabledPluginIds, hostAdmin)` answers it with no read, and the box shows
    it beside the route's groups. Its rows carry `screen` and `params`.
- **Who sees what:** the Admin SDK bypasses the rules, so the engine applies
  every gate itself:
  - reads are keyed to the token's uid;
  - a workspace the caller is not a member of answers 403 before any of its
    data is read;
  - a site must belong to the workspace and list the caller in its
    `memberRoles`;
  - each group needs its plugin on (workspace, site and release flags), its
    plan flag and quota, and its permission;
  - orders need the admin or editor site role, as `canReadHostSensitive`
    asks;
  - org-shared rows are read with the site's scope tokens, and off a site
    only by an org-wide member. Each row is then held to `memberCanSee`.
  - `one-box-search.spec.ts` tests each gate, including that a member of
    workspace A never sees workspace B.
- **Reads and indexes:** the windows are what the palette reads: 30 documents
  per collection, ordered by document id, and one widening read of 270 when a
  full window matched nothing. Orders are read on the Orders list's own query
  (`ORDER_LIST_QUERY.search`, `searchTokens` and `createdAtMs` descending),
  whose composite already exists. **No new index.**
- **Plugins:** a plugin registers its server sources with
  `registerPluginSearchSources` (`libs/aglyn/src/lib/plugin-manager/plugin-search-sources.ts`)
  from its console server declarations, along with its console extension's
  gates:
  - CRM, bookings and redirects: `declarations.console-server.ts`, using the
    same source objects their console extensions list;
  - commerce: `COMMERCE_SERVER_SEARCH_SOURCES`, which adds orders;
  - workflows: its `declarations.server.ts`.

## 6. Phases 3 and 4

| piece | Apple | Kotlin | reads / writes | reuses | new |
| -- | -- | -- | -- | -- | -- |
| Tabs (Mac, iPad) | the system's window tabs; ⌘T, ⌘W, ⌘⇧T | Compose Desktop windows | — | — | tab overview, recently closed |
| AI panel | docked on the right; a sheet on phones | the same | the console's Assist routes and credits | the AI plugin's screens (`ai.*`) | context chip and suggestions (live AI runs only with Zach's go) |
| Help and in-app docs | "?" in the title bar | the same | the row's or section's `docs` (§1) for "Help docs" on this screen | the in-app browser screen (AGL-3935) | the menu |
| Whole-app theming | `AppThemePrefs` applied through the shared tokens (`AglynUI`) | through `AglynTheme` / `Tokens.generated.kt` | `appTheme`, `workspaceColors`, local override | generated tokens | themes, accent with contrast checks, density, text size, sidebar style, app icons |
| Screen patterns, Marketplace home, plan card | — | — | — | the console's counts and listings | per the proposal |

Every native UI change updates the "Native App" Figma file in the same change
(`feedback_native_app_figma_stays_in_sync`).

## 7. Push routing per account

`MobilePushData` (`libs/aglyn/src/lib/app-utils/mobile-push.ts`) carries
`uid`, the account a push was sent to. The fan-out
(`libs/tenant/data/admin/src/lib/server/push-delivery.ts`) makes one send per
recipient, each with that account's `uid`.

- **Apple:** `AglynCore` `MobilePushData.uid` is read from the payload.
- **Android:** `AglynMessagingService` puts `EXTRA_UID` (`"uid"`) on the tap
  intent.

An app signed in to several accounts (Add account, Phase 1) opens a tapped
push in that account, switching to it when it is signed in but not in use. A
push without `uid` (sent before the field) opens in the account in use, as
before.

## 8. Owed deploys

- **Firestore rules:** `accountPrefsValid()` on `users/{userId}`, which now
  also caps `tabBars` (AGL-4006). Deploy them
  before or with the promotion that ships this change, and before any app
  build that writes the new fields. Without them the caps are not enforced
  server-side, though the client writers still cap.
- **Indexes:** none.
- **Functions:** none.

## 9. The phone's navigation (AGL-4006)

The phone's shape was decided on 2026-10-20, after a Menu tab and a More
bucket were rejected: every area is equally important and equally easy to reach. Both
phone shells draw it from the same contract, and the Figma Phone page (2:7)
holds the frames (Home 22:176, Android Home 22:775, the Tab bar sheet,
Pin an area, First open, Area switcher, Activity). Decisions page cards 7 to 9.

- **Home is every area as the same tile.** `phoneHomeGroups(list, team,
  ownerName)` (native-nav.ts) takes the scope's everyday list as the app
  shows it and returns its groups, the sidebar's More headed Tools
  (`PHONE_HOME_GROUP_LABELS`), then the scope's own places last: Overview and
  Site settings in a site, Team (the workspace settings' Members row) and
  Workspace settings (`WORKSPACE_SETTINGS_ROW`) everywhere. A tile's badge is
  its area's Needs-you count.
- **The tab bar is the person's.** Home is always first, then up to four
  areas (`TAB_BAR_AREAS_MAX`): long-press a tile → Add to tab bar, or the
  account sheet → Tab bar to remove, reorder and add. `isTabPinnable` keeps
  Home and the two settings modes out. `tabBarLayout(areas, available)`
  places Create new in the centre slot while there are three areas or fewer;
  with four the bar is full (iOS and Material take five destinations, and
  nothing overflows into a More tab), so Create moves to the top bar beside
  the AI button. A pinned area its scope cannot open (a plugin off, a screen
  this build lacks) is left out, never drawn dead.
- **Pins are kept per scope** (`tabBarScope`: each site, and the whole
  workspace) in `users/{uid}.tabBars`.
- **Before anyone pins:** a fresh scope shows Home and Create, with a
  one-time tip (kept on the device). The first areas opened take the free
  spots and stay (`autoPinTabArea`); a scope the person changed by hand
  (`chosen`) is only changed by them again. Nothing is guessed and nothing
  rotates.
- **Any area is one tap from Home and two from anywhere:** an area opened
  from a tile is pushed on the Home tab; a pinned area is its own tab's root.
  Its title carries ▾, which opens the same tiles as a sheet (iOS) or a modal
  bottom sheet (Android) to switch area in place. Inside an area its
  sections stay chips (AGL-3993).
- **The top bar** holds the scope chip, search, the bell (Activity: Needs
  you and the notifications), the AI button and the photo (the account
  sheet, now with a Tab bar row).
