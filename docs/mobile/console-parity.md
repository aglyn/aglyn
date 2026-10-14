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
| Site setup | `hosts/[host]/setup/{details,business,emails,seo,theme,tracking,integrations}`, `theme` | AGL-3668 | [ ] | [ ] |
| Content collections | `hosts/[host]/content/*` | AGL-3668 | [x] | [x] |
| Media | `hosts/[host]/media`, `[orgSlug]/media`, `video-delivery` | AGL-3668 | [ ] | [ ] |
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
yet, and a row is ticked again when its last one lands):

- Components, layouts, templates: Start from a template (the gallery and Use
  template), Save as template, a Header or Footer to start an email block
  from, a component's icon, the per-plan count beside Create, and Publish to
  marketplace. Using or saving a template reads and writes a tree stored as
  msgpack bytes, which the native readers did not expose.
- Site setup: the SEO check and target keywords, the Business profile
  section, the weekly opening-hours picker, Local business, picking the logos,
  favicon, app icon and social images from the media library instead of
  typing an address, the theme's "What you have changed" list with Reset, and
  the Integrations rail section (a plugin zone, `hostSettings`: each plugin's
  native card for it is that plugin's). The AI-lane widgets in the Business
  profile and SEO areas are the AI lane's.
- Media: the image editor (rotate, flip, crop, downscale), the Uploaded and
  Uploaded by filters, and, after both, a film's captured poster frame becoming
  an entry's cover. Orientation, alt text, tag and size filters are native.
- Content collections: an entry's cover image and video are picked from the
  media library (typed addresses today).
- Plugin marketplace: publishing (a plugin, component, layout, site template,
  theme, dataset schema or email starter), the publisher agreement, the seller
  panel and reports. Browsing, listing detail, install, uninstall and licenses
  are native.
- Datasets: Import (and the dataset page's Export entry beside it) open the
  data transfer hub, which the Workspace settings lane builds; export of a
  dataset is native. Apple's box is ticked when Import opens the hub.

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
