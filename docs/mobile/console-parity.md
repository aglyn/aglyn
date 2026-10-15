# Console parity in the native apps

Zach, 2026-10-07: everything you can do on the website you can do in the
app. Every console area is a native screen on iPhone, iPad, Android phone and
tablet, Mac and Windows. Only the Besigner opens, in the in-app web view
(`native-architecture.md`, "Native console, Besigner-only web view").

This is the checklist. A row is done when its screens and actions work on BOTH
platform trees (SwiftUI and Compose), verified on the seeded emulator stack.
The owning lane ticks its own rows: `[x]` Apple · `[x]` Kotlin.

| area | console routes / plugin | lane | Apple | Kotlin |
| -- | -- | -- | -- | -- |
| Home, site switcher | `(home)`, `[orgSlug]`, `hosts`, `hosts/[host]` | leads | [x] | [x] |
| Orders, products, stock, sales | `commerce` | leads | [ ] | [ ] |
| POS register, readers, kiosk | `commerce` POS, `kiosk/[pluginId]` | leads | [ ] | [ ] |
| Redirects | `redirects` | leads | [x] | [x] |
| Commerce integrations cards | `accounting`, `shipping`, `post-purchase`, `tax-engines`, `marketing-platforms`, `fulfillment-networks`, `couriers`, `sales-channels` | next lane | [x] | [x] |
| Sites, pages and their versions | `hosts/[host]/screens/*` (opening a page = Besigner) | AGL-3668 | [x] | [x] |
| Components, layouts, templates | `hosts/[host]/components/*`, `layouts/*`, `templates/*` (lists native, editing = Besigner) | AGL-3668 | [ ] | [ ] |
| Site setup | `hosts/[host]/setup/{details,business,emails,seo,theme,tracking,integrations}`, `theme` (the theme's Advanced overrides are a raw JSON editor: not built, people are not asked to write code) | AGL-3668 | [x] | [x] |
| Content collections | `hosts/[host]/content/*` | AGL-3668 | [x] | [x] |
| Media | `hosts/[host]/media`, `[orgSlug]/media` (`video-delivery` has no console page: it is server-side only) | AGL-3668 | [x] | [x] |
| Forms and submissions | `forms` | AGL-3668 | [x] | [x] |
| Datasets and data | `data`, `[orgSlug]/data` | AGL-3668 | [ ] | [x] |
| Fonts, theme presets, logic | `fonts`, `theme-presets`, `logic` | AGL-3668 | [x] | [x] |
| Plugin marketplace | `marketplace` (browse, listings, install, my installs and licenses native) | AGL-3668 | [ ] | [ ] |
| CRM | `crm` | AGL-3669 | [x] | [x] |
| Inbox | `inbox` | AGL-3669 | [x] | [x] |
| Emails, campaigns, funnels, texts | `email`, `marketing`, `funnels`, `sms` (email design = Besigner) | AGL-3669 | [x] | [x] |
| Sequences (internal only) | `outreach`, where the console shows it | AGL-3669 | [x] | [x] |
| Bookings, events calendar | `bookings`, `events-calendar` | AGL-3670 | [x] | [x] |
| Analytics | `hosts/[host]/analytics` | AGL-3670 | [x] | [x] |
| Automations | `workflows` | AGL-3670 | [x] | [x] |
| Notifications and their settings | `manage/notifications/*` | AGL-3670 | [x] | [x] |
| AI | `ai` (credits, jobs, settings) | AGL-3671 | [ ] | [ ] |
| Site admin | `hosts/[host]/admin/{activity,backup,danger,domain,error-pages,general,plugins,security}`, `hosts/[host]/users` | AGL-3671 | [ ] | [ ] |
| Workspace settings | `[orgSlug]/settings/*`, `[orgSlug]/plugins/*` | AGL-3671 | [ ] | [ ] |
| Team and roles | `[orgSlug]/team/*` | AGL-3671 | [x] | [x] |
| Billing and usage | `billing`, `[orgSlug]/billing/*` (paying = Stripe's hosted pages) | AGL-3671 | [ ] | [ ] |
| Your account | `manage/user/*`, `manage/report-issue` | AGL-3671 | [ ] | [ ] |
| Support | `support`, `[orgSlug]/support/*` | AGL-3671 | [ ] | [ ] |
| Staff | `admin/*` (staff claims only) | AGL-3667 in AGL-3671 | [ ] | [ ] |

Open in the AGL-3668 rows, 2026-10-14 (found by re-checking the ticked rows
against the console; each is a console action with no native screen on main
yet, and a row is ticked again when its last one lands). Components,
Site setup and Media were ticked again with the pull requests that carry the
rest of what this list named: start from and save as a template, email block
starters, a component's icon and a theme's "What you have changed" (#1559); the
AI plugin's SEO fixes, the cover-video poster frame, the image editor and
Setup's Integrations section (the cards of the plugins running on the site)
(#1586); and the Disabled notice on a file staff took down. What is left:

- Components, layouts, templates: the per-plan count beside Create (the
  limit the Billing and usage meter already reads) and Publish to marketplace
  on a component or layout.
- Site setup, deliberately not built: the theme's Advanced overrides, a raw
  JSON editor. Everything else in the row is native, including the AI plugin's
  widgets in the Business profile and SEO areas.
- Plugin marketplace: publishing (a plugin, component, layout, site template,
  theme, dataset schema or email starter), the publisher agreement, the seller
  panel and reports. Browsing, listing detail, install, uninstall and licenses
  are native.
- Datasets: Import (and the dataset page's Export entry beside it) open the
  data transfer hub, which the Workspace settings lane builds; export of a
  dataset is native. Apple's box is ticked when Import opens the hub.

The media library's "Default sharing for new media" card is in Workspace
settings, where the apps keep the workspace's defaults.

Texts (`sms`): the plugin is infrastructure with no console page of its own.
The console's texts surfaces are the Commerce settings card's "Also send as
texts" switch (native: `sms.texts`, Customer texts) and the order dialog's
"Resend receipt" Text channel. Both platforms' orders have it now: the
Apple order detail sends a receipt by email or, where the store has texts on,
by text (AGL-3652), which was the one thing keeping the Apple box above
open. The card's per-moment email
switches belong to the Commerce settings and are not part of this row. A
funnel has no page design of its own, so it has no Besigner entry.

Not screens: `signin`, `signup`, `signout`, `sso`, `reset-password`,
`verify-email`, `account-recovery`, `auth/handoff/*` and `edit-access` are the
sign-in flows the shell already owns.
