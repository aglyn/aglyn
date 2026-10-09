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
| Commerce integrations cards | `accounting`, `shipping`, `post-purchase`, `tax-engines`, `marketing-platforms`, `fulfillment-networks`, `sales-channels` | next lane | [ ] | [ ] |
| Sites, pages and their versions | `hosts/[host]/screens/*` (opening a page = Besigner) | AGL-3668 | [x] | [ ] |
| Components, layouts, templates | `hosts/[host]/components/*`, `layouts/*`, `templates/*` (lists native, editing = Besigner) | AGL-3668 | [x] | [ ] |
| Site setup | `hosts/[host]/setup/{details,emails,seo,theme,tracking}`, `theme` | AGL-3668 | [x] | [ ] |
| Content collections | `hosts/[host]/content/*` | AGL-3668 | [x] | [ ] |
| Media | `hosts/[host]/media`, `[orgSlug]/media`, `video-delivery` | AGL-3668 | [x] | [ ] |
| Forms and submissions | `forms` | AGL-3668 | [x] | [ ] |
| Datasets and data | `data`, `[orgSlug]/data` | AGL-3668 | [ ] | [x] |
| Fonts, theme presets, plugin marketplace, logic | `fonts`, `theme-presets`, `marketplace`, `logic` | AGL-3668 | [ ] | [ ] |
| CRM | `crm` | AGL-3669 | [x] | [x] |
| Inbox | `inbox` | AGL-3669 | [x] | [x] |
| Emails, campaigns, funnels, texts | `email`, `marketing`, `funnels`, `sms` (email design = Besigner) | AGL-3669 | [ ] | [ ] |
| Sequences (internal only) | `outreach`, where the console shows it | AGL-3669 | [x] | [x] |
| Bookings, events calendar | `bookings`, `events-calendar` | AGL-3670 | [x] | [x] |
| Analytics | `hosts/[host]/analytics` | AGL-3670 | [x] | [x] |
| Automations | `workflows` | AGL-3670 | [x] | [x] |
| Notifications and their settings | `manage/notifications/*` | AGL-3670 | [x] | [x] |
| AI | `ai` (credits, jobs, settings) | AGL-3671 | [ ] | [ ] |
| Site admin | `hosts/[host]/admin/{activity,backup,danger,domain,error-pages,general,plugins,security}`, `hosts/[host]/users` | AGL-3671 | [ ] | [ ] |
| Workspace settings | `[orgSlug]/settings/*`, `[orgSlug]/plugins/*` | AGL-3671 | [ ] | [ ] |
| Team and roles | `[orgSlug]/team/*` | AGL-3671 | [ ] | [ ] |
| Billing and usage | `billing`, `[orgSlug]/billing/*` (paying = Stripe's hosted pages) | AGL-3671 | [ ] | [ ] |
| Your account | `manage/user/*`, `manage/report-issue` | AGL-3671 | [ ] | [ ] |
| Support | `support`, `[orgSlug]/support/*` | AGL-3671 | [ ] | [ ] |
| Staff | `admin/*` (staff claims only) | AGL-3667 in AGL-3671 | [ ] | [ ] |

Not screens: `signin`, `signup`, `signout`, `sso`, `reset-password`,
`verify-email`, `account-recovery`, `auth/handoff/*` and `edit-access` are the
sign-in flows the shell already owns.
