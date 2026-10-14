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
| Commerce integrations cards | `accounting`, `shipping`, `post-purchase`, `tax-engines`, `marketing-platforms`, `fulfillment-networks`, `couriers`, `sales-channels` | next lane | [ ] | [ ] |
| Sites, pages and their versions | `hosts/[host]/screens/*` (opening a page = Besigner) | AGL-3668 | [x] | [x] |
| Components, layouts, templates | `hosts/[host]/components/*`, `layouts/*`, `templates/*` (lists native, editing = Besigner) | AGL-3668 | [x] | [x] |
| Site setup | `hosts/[host]/setup/{details,emails,seo,theme,tracking}`, `theme` | AGL-3668 | [x] | [x] |
| Content collections | `hosts/[host]/content/*` | AGL-3668 | [x] | [x] |
| Media | `hosts/[host]/media`, `[orgSlug]/media`, `video-delivery` | AGL-3668 | [x] | [x] |
| Forms and submissions | `forms` | AGL-3668 | [x] | [x] |
| Datasets and data | `data`, `[orgSlug]/data` | AGL-3668 | [ ] | [x] |
| Fonts, theme presets, plugin marketplace, logic | `fonts`, `theme-presets`, `marketplace`, `logic` | AGL-3668 | [ ] | [ ] |
| CRM | `crm` | AGL-3669 | [x] | [x] |
| Inbox | `inbox` | AGL-3669 | [x] | [x] |
| Emails, campaigns, funnels, texts | `email`, `marketing`, `funnels`, `sms` (email design = Besigner) | AGL-3669 | [x] | [x] |
| Sequences (internal only) | `outreach`, where the console shows it | AGL-3669 | [x] | [x] |
| Bookings, events calendar | `bookings`, `events-calendar` | AGL-3670 | [x] | [x] |
| Analytics | `hosts/[host]/analytics` | AGL-3670 | [x] | [x] |
| Automations | `workflows` | AGL-3670 | [x] | [x] |
| Notifications and their settings | `manage/notifications/*` | AGL-3670 | [x] | [x] |
| AI | `ai` (credits, jobs, settings) | AGL-3671 | [x] | [x] |
| Site admin | `hosts/[host]/admin/{activity,backup,danger,domain,error-pages,general,plugins,security}`, `hosts/[host]/users` | AGL-3671 | [x] | [x] |
| Workspace settings | `[orgSlug]/settings/*`, `[orgSlug]/plugins/*` | AGL-3671 | [ ] | [ ] |
| Team and roles | `[orgSlug]/team/*` | AGL-3671 | [x] | [x] |
| Billing and usage | `billing`, `[orgSlug]/billing/*` (paying = Stripe's hosted pages) | AGL-3671 | [x] | [x] |
| Your account | `manage/user/*`, `manage/report-issue` | AGL-3671 | [x] | [x] |
| Support | `support`, `[orgSlug]/support/*` | AGL-3671 | [x] | [x] |
| Staff | `admin/*` (staff claims only) | AGL-3667 in AGL-3671 | [ ] | [ ] |

Texts (`sms`): the plugin is infrastructure with no console page of its own.
The console's texts surfaces are the Commerce settings card's "Also send as
texts" switch (native: `sms.texts`, Customer texts) and the order dialog's
"Resend receipt" Text channel. Both platforms' orders have it now: the
Apple order detail sends a receipt by email or, where the store has texts on,
by text (AGL-3652), which was the one thing keeping the Apple box above
open. The card's per-moment email
switches belong to the Commerce settings and are not part of this row. A
funnel has no page design of its own, so it has no Besigner entry.

Workspace settings (AGL-3671) stays open on both platforms for what the console does there that the apps do
not yet: the logo and favicon fields take a pasted https address, not a pick from the workspace media library
(`MediaUrlField`); the time zone is a typed IANA name that the route checks, not the console's list; the
Plugins list and a plugin's page show the built-in plugins and leave out the Marketplace installs, their
per-site pins and Permissions & data, which belong to the Marketplace row (AGL-3668); and a hold opened from
a link with `?notice=` shows the list, not that notice's review dialog. Everything else in the twelve sections
is covered and held to the console's own words by `native-workspace-settings-match-the-console.spec.ts`.

Not screens: `signin`, `signup`, `signout`, `sso`, `reset-password`,
`verify-email`, `account-recovery`, `auth/handoff/*` and `edit-access` are the
sign-in flows the shell already owns.
