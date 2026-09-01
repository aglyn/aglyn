# Changelog

Every released version of the Aglyn platform, newest first. A version names a
commit that was **promoted to `production` and verified deployed** — see
[docs/RELEASING.md](docs/RELEASING.md) for how one is cut.

This is the engineering record. The customer-facing changelog is published as
content on the marketing site and is written separately.

<!-- releases below -->

## v1.0.0-beta.40 — 2026-09-01

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/v1.0.0-beta.39...v1.0.0-beta.40)

### Fixed

- **infra:** a link preview and a mailed image can reach what they need ([AGL-2483](https://linear.app/aglyn/issue/AGL-2483))
- **commerce:** related products read a stable sample, not an arbitrary one

### Performance

- **tenant:** site search stops paying for datasets it cannot link to

<details>
<summary>Also in this release: 1 test</summary>

- **aglyn:** a sibling tenant's blanked Origin stays refused, and is pinned as such

</details>

## v1.0.0-beta.39 — 2026-09-01

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/v1.0.0-beta.38...v1.0.0-beta.39)

### Fixed

- **email:** the preference page can save again — its own privacy header was refusing its own form
- **email:** the opt-out footer reads as a sentence, not as a hundred characters of signature
- **analytics:** a browser we have declared ours loads no advertising tag
- **aglyn:** a byline shows the author's own portrait, not the site's mark
- **email:** the CAA reaches only the zones that need it, and a tracked domain outlives its own links
- **plugins-mui:** a Collection Search preset, so the element drawer can reach the block
- **email:** a sending domain is issued able to count a click, and says so when it cannot

### Performance

- **seo:** the sitemap reads entry slugs, not whole articles
- **content:** every listing address of a collection now shares one entries read

## v1.0.0-beta.38 — 2026-09-01

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/2cdfabc72...v1.0.0-beta.38)

### Added

- **besigner:** a link says where it opens, in words an author already knows ([AGL-1191](https://linear.app/aglyn/issue/AGL-1191))

### Fixed

- **security:** the measurement allowlist names the LinkedIn shards and the cross-client collector
- **marketing:** the campaign figures import the forms subpath, not the barrel ([AGL-830](https://linear.app/aglyn/issue/AGL-830), [AGL-1349](https://linear.app/aglyn/issue/AGL-1349))
- **email:** the footer link opens the preference page, on every marketing path and in both parts
- **billing:** a deferred reduction moves the line the target phase actually carries

### Documentation

- **forms:** the parity spec says why its fixture has no leads figure

<details>
<summary>Also in this release: 1 test</summary>

- **billing:** a deferred reduction is quoted as deferred, and spares a pending downgrade

</details>

## v1.0.0-beta.37 — 2026-09-01

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/v1.0.0-beta.36...v1.0.0-beta.37)

### Added

- **marketing:** a campaign shows what its forms hold, apart from what it caused

### Fixed

- **console:** saving a content entry drops the caches of the pages that show it ([AGL-1150](https://linear.app/aglyn/issue/AGL-1150))
- **billing:** a deferred reduction is quoted as deferred, and keeps a pending plan change intact

### Documentation

- **forms:** the leads column documents when a figure is absent, not that none is written

<details>
<summary>Also in this release: 1 test, 1 ci</summary>

- **billing:** an add-on reduction is held to the period end, not the card
- **selfhost:** wait for the tenant to serve the request under test, not merely to start ([AGL-2433](https://linear.app/aglyn/issue/AGL-2433))

</details>

## v1.0.0-beta.36 — 2026-09-01

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/v1.0.0-beta.34...v1.0.0-beta.36)

### Fixed

- **console:** publishing a form drops the caches of the pages that place it
- **docs:** status.aglyn.com served a second copy of the whole docs site

<details>
<summary>Also in this release: 2 chore</summary>

- **release:** carry v1.0.0-beta.35 into the lockfile ([AGL-2089](https://linear.app/aglyn/issue/AGL-2089))
- **release:** v1.0.0-beta.35 ([AGL-2089](https://linear.app/aglyn/issue/AGL-2089))

</details>

## v1.0.0-beta.35 — 2026-09-01

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/v1.0.0-beta.34...v1.0.0-beta.35)

### Fixed

- **docs:** status.aglyn.com served a second copy of the whole docs site

## v1.0.0-beta.34 — 2026-09-01

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/v1.0.0-beta.32...v1.0.0-beta.34)

### Added

- **billing:** capacity bought now is charged now, for the amount the confirm names ([AGL-535](https://linear.app/aglyn/issue/AGL-535))

### Fixed

- **security:** a blocked img-src silenced GA4 audience building
- **billing:** the purchase confirm names usage, and the quote stops quoting once bought
- **forms:** a placed form renders once instead of nesting inside itself
- **console:** a plan card quotes the contacts rate only when it is billed ([AGL-1604](https://linear.app/aglyn/issue/AGL-1604), [AGL-1658](https://linear.app/aglyn/issue/AGL-1658), [AGL-1635](https://linear.app/aglyn/issue/AGL-1635))
- **analytics:** a production build on localhost is not a production deployment ([AGL-2067](https://linear.app/aglyn/issue/AGL-2067))

<details>
<summary>Also in this release: 1 test, 1 chore</summary>

- **analytics:** give the analytics suites a real hostname to run at
- **release:** v1.0.0-beta.33 ([AGL-2089](https://linear.app/aglyn/issue/AGL-2089))

</details>

## v1.0.0-beta.33 — 2026-09-01

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/v1.0.0-beta.32...v1.0.0-beta.33)

### Added

- **billing:** capacity bought now is charged now, for the amount the confirm names ([AGL-535](https://linear.app/aglyn/issue/AGL-535))

### Fixed

- **billing:** the purchase confirm names usage, and the quote stops quoting once bought
- **forms:** a placed form renders once instead of nesting inside itself
- **console:** a plan card quotes the contacts rate only when it is billed ([AGL-1604](https://linear.app/aglyn/issue/AGL-1604), [AGL-1658](https://linear.app/aglyn/issue/AGL-1658), [AGL-1635](https://linear.app/aglyn/issue/AGL-1635))
- **analytics:** a production build on localhost is not a production deployment ([AGL-2067](https://linear.app/aglyn/issue/AGL-2067))

## v1.0.0-beta.32 — 2026-09-01

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/v1.0.0-beta.29...v1.0.0-beta.32)

### Added

- **console:** staff can turn a promotion code back on without the Stripe Dashboard
- **forms:** a form's page lists its submissions and measures what it could only name
- **forms:** a placed form renders the entity's published design
- **email:** an audience can be built from a campaign
- **forms:** a submission files the person under the form's own campaigns
- **theme:** the floating-mockup shadow is a theme token with a CSS var
- **theme:** the accent washes and the brand violet are palette tokens

### Fixed

- **console:** a form editor shows the draft, not the form's published copy
- **besigner:** the hierarchy's ancestor walk stops instead of locking the tab
- **console:** a promotion code reaches the charge, and the charge is confirmed first
- **console:** the priced quote names the discount and how long it lasts
- **besigner:** a number-typed attribute stores a number, not the text typed ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **console:** the first site carries the plan the visitor came to buy
- **console:** the workspace picker carries the plan the visitor came to buy ([AGL-1149](https://linear.app/aglyn/issue/AGL-1149))
- **console,email:** email health can see the shared pool it never looked at

### Documentation

- **tenant:** the forms read says the TTL is all a form publish has

<details>
<summary>Also in this release: 2 chore</summary>

- **release:** v1.0.0-beta.31 ([AGL-2089](https://linear.app/aglyn/issue/AGL-2089))
- **release:** v1.0.0-beta.30 ([AGL-2089](https://linear.app/aglyn/issue/AGL-2089))

</details>

2 commit(s) did not parse as conventional commits (merge commits and the like) and did not contribute to the version bump.

## v1.0.0-beta.31 — 2026-09-01

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/v1.0.0-beta.29...v1.0.0-beta.31)

### Added

- **console:** staff can turn a promotion code back on without the Stripe Dashboard
- **forms:** a form's page lists its submissions and measures what it could only name
- **forms:** a placed form renders the entity's published design
- **email:** an audience can be built from a campaign
- **forms:** a submission files the person under the form's own campaigns
- **theme:** the floating-mockup shadow is a theme token with a CSS var
- **theme:** the accent washes and the brand violet are palette tokens

### Fixed

- **besigner:** the hierarchy's ancestor walk stops instead of locking the tab
- **console:** a promotion code reaches the charge, and the charge is confirmed first
- **console:** the priced quote names the discount and how long it lasts
- **besigner:** a number-typed attribute stores a number, not the text typed ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **console:** the first site carries the plan the visitor came to buy
- **console:** the workspace picker carries the plan the visitor came to buy ([AGL-1149](https://linear.app/aglyn/issue/AGL-1149))
- **console,email:** email health can see the shared pool it never looked at

### Documentation

- **tenant:** the forms read says the TTL is all a form publish has

<details>
<summary>Also in this release: 1 chore</summary>

- **release:** v1.0.0-beta.30 ([AGL-2089](https://linear.app/aglyn/issue/AGL-2089))

</details>

2 commit(s) did not parse as conventional commits (merge commits and the like) and did not contribute to the version bump.

## v1.0.0-beta.30 — 2026-09-01

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/v1.0.0-beta.29...v1.0.0-beta.30)

### Added

- **forms:** a placed form renders the entity's published design
- **email:** an audience can be built from a campaign
- **forms:** a submission files the person under the form's own campaigns
- **theme:** the floating-mockup shadow is a theme token with a CSS var
- **theme:** the accent washes and the brand violet are palette tokens

### Fixed

- **console,email:** email health can see the shared pool it never looked at

2 commit(s) did not parse as conventional commits (merge commits and the like) and did not contribute to the version bump.

## v1.0.0-beta.29 — 2026-09-01

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/07eaadb6e...v1.0.0-beta.29)

### Added

- **email:** a campaign sends from the shared pool, graded for the company it keeps
- **email:** a one-off email designs itself without minting a "template"
- **tools:** a dry-run backfill for the nodes still stored as plain maps
- **besigner:** the working draft is compressed like the version it shadows
- **besigner,tenant:** a screen version carries its own layout binding ([AGL-1428](https://linear.app/aglyn/issue/AGL-1428))

### Fixed

- **email:** a zero-arity mock makes its own call payload unreadable
- **redirects:** a rule edit announces itself instead of waiting out the hour backstop
- **email:** the resource mock is typed to the argument the assertions read
- **console:** the menubar tells Base UI its rendered elements are native buttons
- **console:** an email screen's save is the save the send path sees
- **besigner:** a working draft is stamped against the document it is measured against
- **console:** the interactions panel lists what the element actually carries
- **console:** every remaining besigner document is compressed at rest ([AGL-753](https://linear.app/aglyn/issue/AGL-753), [AGL-1391](https://linear.app/aglyn/issue/AGL-1391))
- **email:** an email design is compressed at rest and read in both forms ([AGL-1151](https://linear.app/aglyn/issue/AGL-1151))
- **ci:** nx affected measures against the commit the run is about
- **tenant,console:** the media CDN names an asset no site can see, and the alert opens the repair
- **monitoring:** a server error says which deployment threw it
- **tenant-data-admin,aglyn:** the media scope guard asserts the rule the code enforces

### Documentation

- **releasing:** a promoted batch deploys the functions it schedules

<details>
<summary>Also in this release: 2 test</summary>

- **tenant:** the media-ref specs stop paying for the whole plugin graph
- **tenant:** the render path is pinned against both stored forms

</details>

## v1.0.0-beta.28 — 2026-08-31

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/97daf9521...v1.0.0-beta.28)

### Added

- **console:** a campaign holds the screens, forms and contacts a push runs across
- **console:** the inbox's sections are addresses, not tabs
- **email:** an email is written on its own page, and its message has one source
- **marketing:** a campaign of several emails reports what it earned
- **email:** a site holds several senders and an email picks one
- **billing:** a dedicated sending domain is an entitlement, not a tier
- **console:** a campaign's page says what it caused and where it sent people
- **email:** a site chooses the address and the person its mail comes from
- **billing:** a custom sending domain begins at Pro
- **email:** a site without its own domain sends receipts, not nothing
- **pricing:** campaign email begins at Pro, and Starter cannot send
- **email:** the opt-out pages carry the sending site's brand, not the platform's ([AGL-2411](https://linear.app/aglyn/issue/AGL-2411))
- **console:** a plugin widget asks who is looking, once per page
- **console:** the organization can see the person its sites share
- **console:** the register and the email console declare who may open them
- **billing:** the page-view rate is held to the page weight it prices
- **console:** the modules the conversions surfaces are built from
- **console:** what the campaigns caused is finally on screen
- **console:** the utilization every margin figure assumes is measured
- **console:** the shell decides who may open a plugin surface, not the plugin
- **console:** the page heading says which section of a surface is open
- **billing:** assist is metered in what it costs, not in how often it is asked
- **console:** the Forms create button moves up into the page header
- **billing:** the tier bands are costed against the prices they are sold at
- **billing:** email sending is priced, and the top plan is no longer unbounded
- **email:** the provisioning sweep claims for sites that have none
- **email:** a site's mail leaves on its own domain, never on aglyn.com
- **tenant:** a campaign gets credit for the form, lead, contact and booking it caused
- **console:** the forms surface reaches parity with reusable components
- **email:** the composer names the address it leaves on, and refuses before Send
- **email:** a tenant can add a sending domain, publish its records and verify it
- **email:** one site's sending identity has a route, and only an org admin may write it
- **email:** a test send picks its persona, its recipient and its identity
- **billing:** how many forms a site may hold stops being a per-tier lever
- **billing:** how many forms a site may hold is a plan allowance, and it is published
- **email:** a campaign says what it earned, because we own the checkout
- **email:** stop mailing an address that has gone quiet, without removing it
- **email:** an audience can ask who opened, and say "any of" and "not"
- **email:** engagement is rolled onto the person, not only the message
- **email:** the console says what a send is doing, and lets a campaign be edited
- **email:** a campaign can be removed and a draft thrown away, without losing a send
- **email:** a merchant can require a confirmation click, per stream
- **email:** a verified sending domain has to keep proving itself
- **besigner:** a form is designed in the besigner, and cannot be published broken
- **console:** forms have a list and a page of their own
- **forms:** a form is a versioned document, on the rails a component runs on
- **email:** a recipient can ask for less mail instead of none
- **email:** a campaign reaches an audience larger than one send
- **email:** a workspace has its own bounce and complaint rate, and a new one is ramped
- **automations:** an automation can wait, so a sequence can exist
- **email:** a customer can bring the list they already have
- **email:** an email is written, sent and withdrawn on its own page
- **forms:** a design that would silently stop collecting cannot be published
- **email:** you can write an email here, and send one to more people later
- **email:** every remaining list on the surface reads by the same row grammar
- **email:** a campaign row is a link and carries the console's trailing actions cluster
- **email:** a message row opens the message, and carries where else it leads
- **email:** a topic row opens the topic, and Edit moves off the row
- **email:** the templates list is a table, and its actions are where every other list keeps them
- **email:** a plain-text message previews the mail it actually sent
- **email:** the platform suppression list has a reader, a release and an explanation
- **email:** the composer sends under a topic, and creates through the shared drawer
- **email:** an audience is a resource, with pages and a real filter builder
- **email:** a campaign holds many emails, and the send dialog states its size
- **marketplace:** a campaign email can start from somebody else's design
- **email:** a recipient can leave one stream instead of the whole site
- **email:** a merchant can put an address on the suppression list by hand
- **email:** an email and a template each get their own page
- **email:** the delivery log answers who opened one site's mail
- **email:** a send records which list it went to
- **console:** billing shows the pace a workspace is throttled at ([AGL-2409](https://linear.app/aglyn/issue/AGL-2409), [AGL-890](https://linear.app/aglyn/issue/AGL-890), [AGL-2482](https://linear.app/aglyn/issue/AGL-2482), [AGL-1046](https://linear.app/aglyn/issue/AGL-1046))
- **console:** an email list can be read, renamed, added to and taken from
- **console:** a campaign report, with every denominator on screen
- **email:** a campaign keeps the populations its own send measured
- **email:** the unsubscribe link can say which campaign it came from
- **email:** the delivery webhook records what a campaign rate divides by
- **email:** campaign reporting math where every denominator is named
- **data:** a dataset record can be read without being opened for editing
- **console:** plan cards state the campaign email allowance, three to a row ([AGL-1438](https://linear.app/aglyn/issue/AGL-1438))
- **console:** the site's name, address and backups move to the Admin hub
- **console:** billing opens on the upgrade decision, not the whole catalogue ([AGL-1864](https://linear.app/aglyn/issue/AGL-1864), [AGL-1863](https://linear.app/aglyn/issue/AGL-1863), [AGL-1859](https://linear.app/aglyn/issue/AGL-1859))
- **console:** a sending domain can ask a provider for its signing key ([AGL-2501](https://linear.app/aglyn/issue/AGL-2501))
- **forms:** the forms that already exist can be adopted, and keep their history
- **forms,inbox:** per-form submission lists key on the id, not the caption
- **forms,leads:** a form captures a lead, and one person is one lead ([AGL-76](https://linear.app/aglyn/issue/AGL-76))
- **forms:** a form is a thing, not the caption an author typed
- **email:** the default consent policy enforces retroactively ([AGL-2499](https://linear.app/aglyn/issue/AGL-2499))
- **tools:** backfill a marketing-consent basis over the pre-release records
- **email:** a consent basis records whose act it was, not just what it says
- **inbox,console,docs:** add a form's sender to a list, on a basis somebody stated
- **tenant-data-admin:** a list membership records WHY it may be mailed, and honors a refusal
- **cloud:** the dynamic-list sweep gets the index its query needs
- **email:** a list can be a rule, and the rule never drops anybody
- **email:** a campaign reaches the people who agreed to hear from it ([AGL-301](https://linear.app/aglyn/issue/AGL-301))
- **console:** the sending-domain records are shown, not guessed at
- **marketing:** a campaign on an unverified domain answers 409, not silence
- **tenant-data-admin:** a site's bulk send can ask both suppression lists
- **email:** a sending domain that DNS has not proved cannot reach verified
- **email:** a workspace gets a share of the platform hour, not all of it
- **email:** the send path refuses an unverified identity, twice over
- **email:** the three send ceilings are dimensioned against each other
- **email:** a sending domain that is not verified refuses the send
- **aglyn:** one address-derived document id, on the server side of the barrel ([AGL-2499](https://linear.app/aglyn/issue/AGL-2499))
- **console:** the dashboard keeps the cards you keep
- **plugins:** a dashboard widget declares the name its switch will carry
- **inbox,console:** answer a form submission from the Inbox
- **inbox,console:** the dashboard says what is waiting for a reply ([AGL-419](https://linear.app/aglyn/issue/AGL-419))
- **console,commerce,email:** the dashboard glance cards are registered, not imported ([AGL-433](https://linear.app/aglyn/issue/AGL-433))
- **console:** the upgrade collects what it needs instead of sending you away ([AGL-1132](https://linear.app/aglyn/issue/AGL-1132))
- **console,tenant:** the subscription lifecycle reaches the workspace feed ([AGL-118](https://linear.app/aglyn/issue/AGL-118))
- **tools:** fold one person's two accounts together, by sweeping for the uid ([AGL-2005](https://linear.app/aglyn/issue/AGL-2005), [AGL-2029](https://linear.app/aglyn/issue/AGL-2029))
- **console:** the Stripe portal gains a staff door on the org page ([AGL-275](https://linear.app/aglyn/issue/AGL-275))
- **tenant-data-admin,commerce,marketplace:** a payout that never landed leaves a record
- **aglyn,console,commerce:** a plugin console page can be a hub of routes ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **console,tenant,scripts:** creation is an event too, and a check that says so ([AGL-118](https://linear.app/aglyn/issue/AGL-118))
- **console,docs:** a way to pay an overdue invoice, and a quote that explains its tax
- **console,tenant:** a resource records who made it, and the route records that it was made ([AGL-118](https://linear.app/aglyn/issue/AGL-118))
- **scripts,docs:** reconstruct the activity entries that were never written ([AGL-118](https://linear.app/aglyn/issue/AGL-118))
- **console:** subscribing is our own page now, and billing details need no plan ([AGL-1340](https://linear.app/aglyn/issue/AGL-1340))
- **console,shared-util-email:** open a delivery row to read the message
- **console,shared-util-email,tenant-data-admin:** import the mail sent before the feed existed
- **console,aglyn:** a plugin page owns its switch ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486), [AGL-1014](https://linear.app/aglyn/issue/AGL-1014), [AGL-428](https://linear.app/aglyn/issue/AGL-428))
- **console,docs:** where the platform files its sales tax is a control, not a redeploy ([AGL-2021](https://linear.app/aglyn/issue/AGL-2021))
- **console,shared-ui-theme:** the card form is ours now, and nothing opens over the page
- **console,docs,aglyn,tenant:** the ad tags reach every surface we own, and stop on the same word
- **tools:** one paste sets a secret in .env and on Vercel
- **console,docs:** billing settings you can read and change without a popup ([AGL-940](https://linear.app/aglyn/issue/AGL-940), [AGL-1133](https://linear.app/aglyn/issue/AGL-1133))
- **console,shared-util-email,tenant-data-admin:** what we sent someone, on their staff page
- **tenant,tools:** already-published images get their intrinsic size ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **console,tenant,aglyn:** a site's plugin settings follow the workspace's, and can stop ([AGL-428](https://linear.app/aglyn/issue/AGL-428), [AGL-1014](https://linear.app/aglyn/issue/AGL-1014), [AGL-1608](https://linear.app/aglyn/issue/AGL-1608), [AGL-1440](https://linear.app/aglyn/issue/AGL-1440))
- **aglyn:** a plugin setting a workspace answers once, a site may answer itself
- **console,aglyn,marketing:** an authored analytics event carries params ([AGL-1587](https://linear.app/aglyn/issue/AGL-1587), [AGL-577](https://linear.app/aglyn/issue/AGL-577))
- **commerce:** a member account door reports to the host's own GA4 ([AGL-1591](https://linear.app/aglyn/issue/AGL-1591))
- **console,docs:** the sales tax return files where the deployment is registered
- **mui,besigner,console:** images carry their own dimensions, so the page stops shifting ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **tenant:** a hostname becomes reachable without a hosting vendor ([AGL-2436](https://linear.app/aglyn/issue/AGL-2436))
- **console:** a paid subscription reports its Google Ads conversion ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152))
- **aglyn,console:** a signup reports the Google Ads conversion it earned ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152))
- **console,aglyn,tenant-instance:** the console asks before it measures ([AGL-1597](https://linear.app/aglyn/issue/AGL-1597), [AGL-1498](https://linear.app/aglyn/issue/AGL-1498))
- **aglyn,console,tenant:** a site can run its own Google Ads and LinkedIn tags ([AGL-1608](https://linear.app/aglyn/issue/AGL-1608))

### Fixed

- **console:** a record's detail page is headed by the record, not by its list
- **tenant:** the admin bar's Orders link opens Orders
- **email:** a dedicated domain reads as the request it is, and senders are documented
- **email:** a campaign batch keeps inside the provider's request rate
- **email:** a provider rate limit defers the recipient instead of settling them
- **repo:** a test spanning two plugins moves out of the app that owns neither
- **email:** a confirmed opt-in lifts the bounce it just disproved
- **console:** a review verdict stops chasing a dead publisher mailbox
- **marketing:** a campaign page leads with what the campaign caused
- **console:** orders are not an inbox
- **rules:** the sending-label pin and its request stamp are Admin-SDK only
- **email:** a dedicated sending domain is requested, not issued
- **email:** the sender picker offers everyone who works on the site
- **console:** the emails hub's first section stops repeating the hub's name
- **email:** a spec binding named module fails the next lint rule
- **billing:** every upgrade card says what the next screen will ask for
- **email:** a sending domain no longer outlives the site that owned it
- **runtime:** an immediate action email asks who it is mailing
- **email:** a topic opt-out reaches the senders that only the gate guards
- **tenant:** the unsubscribe page logo is named in the image-sink inventory ([AGL-1725](https://linear.app/aglyn/issue/AGL-1725))
- **email:** the shared pool is the floor under a dedicated sending domain
- **email:** a campaign honors the pace its recipients asked for
- **billing:** a plan the org did not buy says so, instead of a dead button ([AGL-1118](https://linear.app/aglyn/issue/AGL-1118), [AGL-1795](https://linear.app/aglyn/issue/AGL-1795), [AGL-2156](https://linear.app/aglyn/issue/AGL-2156), [AGL-1028](https://linear.app/aglyn/issue/AGL-1028), [AGL-1715](https://linear.app/aglyn/issue/AGL-1715))
- **console:** the zone read sees the whole zone, not its first page
- **aglyn:** campaignAttributions is classified for the media scan
- **console:** the usage meters hold until the plan is known ([AGL-1422](https://linear.app/aglyn/issue/AGL-1422))
- **repo:** the spec configs compile against the types they are asserting
- **console:** the plan grid delivers all eight plans and says each fact once ([AGL-1864](https://linear.app/aglyn/issue/AGL-1864), [AGL-1117](https://linear.app/aglyn/issue/AGL-1117), [AGL-1859](https://linear.app/aglyn/issue/AGL-1859), [AGL-2156](https://linear.app/aglyn/issue/AGL-2156), [AGL-2297](https://linear.app/aglyn/issue/AGL-2297))
- **repo:** npm run lint runs the linters again
- **billing:** the plan count includes the plan the grid folds away
- **rules:** reading the CRM asks for the permission its console asks for
- **email:** the audience table reports the basis the sender acts on
- **console:** the sending-domain sweep runs on a scheduler instead of nothing
- **pricing:** publish the email-send and assist overage rates the product already bills
- **email:** a mailbox provider can reach the unsubscribe link it is told to POST ([AGL-2408](https://linear.app/aglyn/issue/AGL-2408))
- **email:** a domain the provider already holds is adopted, not refused forever
- **email:** a sending domain's own page is reachable from the list
- **auth:** a request that cannot be authorized is not sent, and does not hang
- **console:** the marketing conversions tab has a title
- **email:** the sending-domain provisioning sweep has the index it queries
- **rules:** reading who is on an audience needs the authority to manage data
- **email:** scheduling a campaign that cannot be authorized says so instead of nothing
- **rules:** a custom role that revokes data.manage is honored by the rules
- **console:** the conversions section says why the kinds stand apart
- **pricing:** the margin model counts assist credits, and cannot miss the next cost
- **tools:** the page-weight gate's --entry note names a client root
- **repo:** the deploy-ordering guard covers the Cloud Scheduler routes too ([AGL-2359](https://linear.app/aglyn/issue/AGL-2359), [AGL-1617](https://linear.app/aglyn/issue/AGL-1617))
- **console:** the margin surface answers the console's standing guards
- **pricing:** the add-on tables state the rates the code charges
- **console:** one mock key per name, so the app typechecks
- **billing:** our cost of goods stops crossing the customer boundary
- **pricing:** every table the /pricing generator emits is reconciled, not two
- **pricing:** the published tables carry the resized allowances
- **console:** the enrollment double declares its campaign lookup once
- **console:** the relaxed-coverage test measures the band before it trusts it
- **selfhost:** the per-site sending domain answers to the two self-host guards
- **console:** a plugin's site page and its workspace page title apart
- **pricing:** the Pro bandwidth band is sized to the tier's own cost model
- **console:** a plugin section gets its own browser-tab title
- **forms:** the catalog quotes the allowance the server enforces
- **billing:** the assist credit odometer declares its lockdown posture
- **billing:** close the last of the negative tails, on both levers
- **pricing:** the annual Agency price is the one Stripe charges
- **consent:** a marketing basis runs to a brand, not to an account
- **console:** the identity picker offers the site's own domain, not aglyn.com
- **console:** the enrollment double answers the campaign-touch lookup
- **console:** the content entries page IS the query
- **commerce:** the recovery queue counts an ordered walk
- **commerce:** the orders table reads the most recent orders, and says so
- **commerce:** the money cards read the period they report
- **bookings:** a refunded appointment stops counting as revenue a campaign earned
- **besigner,console:** a form is placeable from any document, and an empty picker says so
- **email:** the attribution record is server-only, and three assertions were vacuous
- **console:** forms are reachable from the nav
- **ui:** a table row's cells sit on one vertical centre
- **email:** a confirmation message is counted like every other send
- **email:** the erasure double did not honor a field deletion
- **email:** three specs typecheck under their own tsconfigs
- **email:** the sender's address comes from the server, and only from the server
- **console:** the console plugin API dispatcher bounds what one operator can spend
- **email:** an immediate send may name an email, but only an unsent one
- **console:** the discoverable-form scan is a text file again
- **scripts:** the form-id backfill refuses an argument it does not understand
- **email:** an email always says which template it used, or that it used none
- **forms:** a date field's label stops sitting on its own placeholder
- **email:** a campaign of one names its email, and one record opens one page
- **aglyn:** the media usage scan classifies the campaign container
- **email:** a site editor cannot forge a campaign's delivery record
- **email:** one alignment decision per campaign column, not two
- **email:** the send-ceiling spec may read the price table it checks against
- **email:** the copy that gets mailed is sanitized like the copy that gets previewed
- **email:** the pre-send preview answers, and one renderer draws what is mailed
- **email:** bulk mail carries an unsubscribe, a suppression check and a ceiling
- **email:** an unrecorded delivered count read as a 0% delivery rate
- **console:** the enrollment-and-send spec doubles the two helpers its sender now calls
- **marketing:** the Figma pricing frames carry the lowered email allowances
- **data:** the record view renders a list item by item, not as a join
- **aglyn:** a consent-provenance fixture names a role, not a person
- **pricing:** the top two email allowances come down to what we can deliver
- **console:** a metered limit on a plan card carries its rate ([AGL-1864](https://linear.app/aglyn/issue/AGL-1864))
- **console:** the Enterprise card states its limits instead of omitting them ([AGL-1864](https://linear.app/aglyn/issue/AGL-1864), [AGL-2482](https://linear.app/aglyn/issue/AGL-2482))
- **console:** the Enterprise card stops printing its highlights twice ([AGL-1864](https://linear.app/aglyn/issue/AGL-1864))
- **console:** each plan card states what it alone adds ([AGL-1864](https://linear.app/aglyn/issue/AGL-1864))
- **console:** the issuing join survives a domain released mid-write
- **besigner:** the form picker offers the site's forms instead of nothing
- **scripts:** the demo-host check reports a failure it could only call unknown ([AGL-1617](https://linear.app/aglyn/issue/AGL-1617))
- **marketing:** a replayed delivery event no longer counts twice ([AGL-268](https://linear.app/aglyn/issue/AGL-268))
- **scripts:** a typo in the backfill's --exclude no longer writes over a real person ([AGL-1489](https://linear.app/aglyn/issue/AGL-1489))
- **marketing:** proofing your own draft is not a marketing send ([AGL-349](https://linear.app/aglyn/issue/AGL-349))
- **email:** the default consent policy is the one the sends actually apply
- **console,email:** the campaign allowance is reported off the counter that gates it ([AGL-2113](https://linear.app/aglyn/issue/AGL-2113))
- **cloud:** the dynamic-list query wants a single-field index, not a composite
- **marketing,docs:** a campaign reaches a knowable set of people, and says which
- **email:** one person subscribing twice is one list member, not two ([AGL-2499](https://linear.app/aglyn/issue/AGL-2499))
- **inbox,console:** the reply card stops spacing itself, and admits its window
- **console:** the automation guard reads the section ids where they now live
- **plugins-redirects:** the plan refusal belongs to the shell that renders it ([AGL-2484](https://linear.app/aglyn/issue/AGL-2484))
- **console:** the Traffic card takes the row, and reads across it ([AGL-2500](https://linear.app/aglyn/issue/AGL-2500))
- **console:** the workspace pickers page on the shared footer ([AGL-2501](https://linear.app/aglyn/issue/AGL-2501), [AGL-2336](https://linear.app/aglyn/issue/AGL-2336))
- **aglyn:** the admin-gate check reads rules, not prose
- **console,plugins:** the refusal names the add-on, and cannot grant itself ([AGL-2484](https://linear.app/aglyn/issue/AGL-2484), [AGL-2501](https://linear.app/aglyn/issue/AGL-2501))
- **marketplace,marketing:** a role refusal names the roles it admits
- **console:** a member's orders page, and the lifetime figure stops guessing ([AGL-2501](https://linear.app/aglyn/issue/AGL-2501))
- **console:** the refund charge list pages, and admits it is a window ([AGL-2501](https://linear.app/aglyn/issue/AGL-2501))
- **redirects:** the rule list pages, and the walk names its order ([AGL-2501](https://linear.app/aglyn/issue/AGL-2501))
- **events-calendar:** the events list pages, and says when it is short ([AGL-2501](https://linear.app/aglyn/issue/AGL-2501))
- **console:** the events page stops promising an upgrade it can't deliver
- **console:** a legal acceptance's sha256 links to the document it hashes
- **console:** the flags page banner stops carrying an oversized help icon
- **marketplace:** a listing's reviews page, and the guard sees the helpers ([AGL-2501](https://linear.app/aglyn/issue/AGL-2501))
- **console:** the licence lists page, and name the order they walk ([AGL-2501](https://linear.app/aglyn/issue/AGL-2501))
- **console:** the stuck-claims list pages, and its figures say "at least" ([AGL-2501](https://linear.app/aglyn/issue/AGL-2501))
- **console:** the erasure queue pages, and says when it is a floor ([AGL-2501](https://linear.app/aglyn/issue/AGL-2501))
- **cloud,tools:** themeHistory is server-owned, and the split can now run ([AGL-1302](https://linear.app/aglyn/issue/AGL-1302), [AGL-2334](https://linear.app/aglyn/issue/AGL-2334))
- **repo:** drop 85 citations that named the wrong real issue ([AGL-2500](https://linear.app/aglyn/issue/AGL-2500), [AGL-1488](https://linear.app/aglyn/issue/AGL-1488), [AGL-1478](https://linear.app/aglyn/issue/AGL-1478), [AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **console:** a self-host dunning email points at the operator's own console ([AGL-2176](https://linear.app/aglyn/issue/AGL-2176))
- **console:** a card that needs authentication gets to authenticate ([AGL-1877](https://linear.app/aglyn/issue/AGL-1877))
- **repo:** the list-pagination arc cites the issue it is actually about ([AGL-2501](https://linear.app/aglyn/issue/AGL-2501), [AGL-693](https://linear.app/aglyn/issue/AGL-693), [AGL-2500](https://linear.app/aglyn/issue/AGL-2500))
- **tools,repo:** a citation names an issue that exists, and a guard keeps it that way ([AGL-2500](https://linear.app/aglyn/issue/AGL-2500), [AGL-2499](https://linear.app/aglyn/issue/AGL-2499), [AGL-693](https://linear.app/aglyn/issue/AGL-693), [AGL-2306](https://linear.app/aglyn/issue/AGL-2306), [AGL-1476](https://linear.app/aglyn/issue/AGL-1476))
- **tenant,plugins:** four specs assert against shapes the compiler allows
- **commerce,console:** the commerce lists reach past their first window ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **tools:** a deploy script refuses an argument it cannot parse ([AGL-1489](https://linear.app/aglyn/issue/AGL-1489))
- **console:** a retained version is an event; a resource's first is not ([AGL-118](https://linear.app/aglyn/issue/AGL-118))
- **console,tenant:** a site's lifecycle events reach its own log ([AGL-118](https://linear.app/aglyn/issue/AGL-118))
- **console:** the staff overview names the workspace, not its id ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **console,tenant:** a manager seat is taken in the transaction that grants it ([AGL-2068](https://linear.app/aglyn/issue/AGL-2068))
- **tenant-data-admin,console:** erasure stops at an address two accounts hold ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486), [AGL-1140](https://linear.app/aglyn/issue/AGL-1140))
- **workflows,console:** the actions list is bounded, the expander is a footer ([AGL-693](https://linear.app/aglyn/issue/AGL-693), [AGL-2486](https://linear.app/aglyn/issue/AGL-2486), [AGL-2292](https://linear.app/aglyn/issue/AGL-2292))
- **commerce:** the discounts hub reaches the payment link and the register ([AGL-305](https://linear.app/aglyn/issue/AGL-305), [AGL-2159](https://linear.app/aglyn/issue/AGL-2159))
- **aglyn,cloud:** the sign-in screen is an admin decision ([AGL-553](https://linear.app/aglyn/issue/AGL-553), [AGL-1361](https://linear.app/aglyn/issue/AGL-1361))
- **console:** the order row declares the two fields that decide its mode
- **console:** capacity cannot be dropped out from under what is using it ([AGL-2439](https://linear.app/aglyn/issue/AGL-2439), [AGL-483](https://linear.app/aglyn/issue/AGL-483))
- **commerce:** a rehearsal stops reporting itself into the merchant's analytics ([AGL-2040](https://linear.app/aglyn/issue/AGL-2040))
- **console:** the bank challenge runs against the intent Stripe is holding ([AGL-1132](https://linear.app/aglyn/issue/AGL-1132))
- **commerce,console,aglyn:** a smoke-test order stops counting as revenue
- **redirects,events-calendar:** the redirect cap counts what the server counts ([AGL-693](https://linear.app/aglyn/issue/AGL-693), [AGL-1716](https://linear.app/aglyn/issue/AGL-1716))
- **console:** a half-typed site setting survives changing tab ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **tenant,logic,workflows,email,console:** the detector learns the shape a plugin list is actually written in ([AGL-693](https://linear.app/aglyn/issue/AGL-693), [AGL-185](https://linear.app/aglyn/issue/AGL-185))
- **console:** a seat pool cannot shrink under the sites holding it ([AGL-2439](https://linear.app/aglyn/issue/AGL-2439), [AGL-2438](https://linear.app/aglyn/issue/AGL-2438))
- **console,commerce:** the billing address gets one editor, sharing moves out ([AGL-1133](https://linear.app/aglyn/issue/AGL-1133), [AGL-1048](https://linear.app/aglyn/issue/AGL-1048))
- **console:** the mode notice covers the org it was written for, and Plan fills its row
- **console:** the downgrade warning measures what the plan includes ([AGL-483](https://linear.app/aglyn/issue/AGL-483))
- **tenant:** a workflow step stops writing dataset rows nobody paid for ([AGL-2253](https://linear.app/aglyn/issue/AGL-2253))
- **commerce:** the discounts hub reaches buy-now, and the product page can take a code ([AGL-96](https://linear.app/aglyn/issue/AGL-96))
- **marketplace,console:** a facilitated sale records the state it was taxed in ([AGL-2137](https://linear.app/aglyn/issue/AGL-2137))
- **console,tenant-data-admin:** mail history and erasure see every address ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **console,tenant-data-admin:** a provider address joins the uniqueness index ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **commerce:** a scoped discount stops discounting the whole catalog
- **console:** a marketplace moderation decision is retrievable by what it acted on
- **commerce:** one dashboard stops showing two different revenues
- **console:** an audit entry reaches the page of the person it is about
- **console:** one opening of a message is one audited access
- **console,commerce:** the ledger stops asserting money arrived
- **console:** the tax ID is asked for before the charge it changes
- **console:** a mid-cycle plan change quotes its tax
- **marketplace:** a publisher can take their bio down ([AGL-1009](https://linear.app/aglyn/issue/AGL-1009))
- **console:** an abandoned bank confirmation stops being invisible
- **commerce:** a coupon can be given the expiry both checkouts already enforce
- **console,docs:** the confirm quotes the proration too, not next month's invoice ([AGL-535](https://linear.app/aglyn/issue/AGL-535))
- **commerce,marketplace,console:** a stranded merchant gets a door into Stripe
- **commerce:** a line refund gives back what the buyer paid, not the list price
- **console,scripts:** a site with one member has no mystery about who built it ([AGL-118](https://linear.app/aglyn/issue/AGL-118))
- **commerce:** a free-shipping code stops charging for shipping
- **commerce:** an abandoned booking stops holding its dates forever
- **aglyn,console:** an abandoned signup stops holding a paid plan and booking its MRR
- **commerce:** a cancelled order stops counting as revenue at a glance
- **commerce:** the payments card stops calling stranded funds enabled ([AGL-1997](https://linear.app/aglyn/issue/AGL-1997))
- **commerce,email,inbox,marketing,workflows,console:** the plugin lists get a footer, and name what they page ([AGL-693](https://linear.app/aglyn/issue/AGL-693), [AGL-1918](https://linear.app/aglyn/issue/AGL-1918), [AGL-2408](https://linear.app/aglyn/issue/AGL-2408))
- **console,tenant,aglyn:** a site built from a template records that it was ([AGL-118](https://linear.app/aglyn/issue/AGL-118))
- **console:** a plan switch quotes what it costs, not next month's invoice ([AGL-535](https://linear.app/aglyn/issue/AGL-535))
- **console:** the delivery dialog settles, and every cell sits on one line
- **workflows,tenant-runtime:** the run history asks for its own rows ([AGL-2292](https://linear.app/aglyn/issue/AGL-2292))
- **commerce,bookings:** the public availability reads stop at their own horizon ([AGL-2159](https://linear.app/aglyn/issue/AGL-2159))
- **tenant-data-admin:** the cross-pool user sweeps ask the pools together ([AGL-1122](https://linear.app/aglyn/issue/AGL-1122))
- **console:** a table with rows under it has a footer under those ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **console,docs:** a finding names its rows, and we stop filing our own sale ([AGL-1900](https://linear.app/aglyn/issue/AGL-1900), [AGL-1582](https://linear.app/aglyn/issue/AGL-1582), [AGL-1811](https://linear.app/aglyn/issue/AGL-1811))
- **console:** the delivery table is one line per row, at full width
- **console:** the recovery queue names its seller, and the label map is in scope ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **console:** the Assist board names its workspaces and states its cuts ([AGL-693](https://linear.app/aglyn/issue/AGL-693), [AGL-2340](https://linear.app/aglyn/issue/AGL-2340))
- **console:** the audit log pages on the shared footer ([AGL-693](https://linear.app/aglyn/issue/AGL-693), [AGL-2324](https://linear.app/aglyn/issue/AGL-2324))
- **console:** the staff Users list pages what it draws, not what it fetched ([AGL-693](https://linear.app/aglyn/issue/AGL-693), [AGL-1122](https://linear.app/aglyn/issue/AGL-1122))
- **shared-ui-jsx:** a hidden footer stops paging, and a dead size menu stops drawing ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **console:** the site artifact lists page an ordered walk ([AGL-693](https://linear.app/aglyn/issue/AGL-693), [AGL-1716](https://linear.app/aglyn/issue/AGL-1716))
- **tenant-data-admin:** a dotted key in a merge-set is a field NAME, not a path
- **console,tools:** a refused save says why, and the guard covers the EIN
- **console:** a compact field stops truncating its own label
- **docs:** the trust page stops denying the ad signals it now grants ([AGL-1597](https://linear.app/aglyn/issue/AGL-1597), [AGL-1649](https://linear.app/aglyn/issue/AGL-1649))
- **console:** the ad tags this console mounts are named in its candidate CSP
- **console,shared-ui-next:** a breadcrumb names the section you are on
- **console:** the country namer stops being assigned twice
- **console,docs:** a site's plugin page gets its own help destination
- **tools:** the new guard's own advice published an unprovisioned mailbox ([AGL-1577](https://linear.app/aglyn/issue/AGL-1577))
- **shared-util-email:** every message carries an HTML part, so its links are links
- **monitoring,docs:** every uptime check carries the firewall bypass header ([AGL-1717](https://linear.app/aglyn/issue/AGL-1717))
- **console:** the site collaborator list is in the order it looks like it is in ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **plugins-marketplace,console:** the marketplace shelf and the template gallery page ([AGL-693](https://linear.app/aglyn/issue/AGL-693), [AGL-1196](https://linear.app/aglyn/issue/AGL-1196), [AGL-827](https://linear.app/aglyn/issue/AGL-827))
- **plugins-data:** the records table walks the collection instead of sampling it ([AGL-693](https://linear.app/aglyn/issue/AGL-693), [AGL-2335](https://linear.app/aglyn/issue/AGL-2335))
- **docs:** the two customer-facing uptime checks have been dark for a week ([AGL-1717](https://linear.app/aglyn/issue/AGL-1717))
- **aglyn,console,tenant:** one client-address reader, and a hop a caller cannot pick ([AGL-2014](https://linear.app/aglyn/issue/AGL-2014))
- **monitoring,docs:** the receiver and the channel get read honestly ([AGL-1921](https://linear.app/aglyn/issue/AGL-1921))
- **shared-util-email:** the credential probe stops looking like failed mail ([AGL-709](https://linear.app/aglyn/issue/AGL-709))
- **commerce,bookings,mui,marketing:** every paid path reports its checkout ([AGL-1591](https://linear.app/aglyn/issue/AGL-1591), [AGL-2481](https://linear.app/aglyn/issue/AGL-2481))
- **monitoring,cloud,docs:** the platform 5xx log gets a policy that watches it ([AGL-1921](https://linear.app/aglyn/issue/AGL-1921))
- **tenant,console,docs:** a tenant site is not a page that uploads ([AGL-1452](https://linear.app/aglyn/issue/AGL-1452), [AGL-1273](https://linear.app/aglyn/issue/AGL-1273))
- **shared-ui-next,console:** the vertical tab rail follows its own URL ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486), [AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **console:** the screen and layout editors report a refused cache drop ([AGL-1483](https://linear.app/aglyn/issue/AGL-1483))
- **tenant:** the wildcard driver claimed apexes nobody named ([AGL-2436](https://linear.app/aglyn/issue/AGL-2436))
- **console:** a publish says so when the live pages were not refreshed ([AGL-1483](https://linear.app/aglyn/issue/AGL-1483))
- **aglyn:** two env-mutating specs shared one global loader ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152))
- **console,besigner:** a refused save no longer publishes and says it worked ([AGL-1483](https://linear.app/aglyn/issue/AGL-1483))
- **aglyn,console:** a closed tab no longer loses the subscribe conversion ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152))
- **console,aglyn:** the privacy control reaches pages with no account menu ([AGL-1498](https://linear.app/aglyn/issue/AGL-1498), [AGL-1597](https://linear.app/aglyn/issue/AGL-1597))
- **aglyn,console,tenant:** the geo signal and build stamp work off Vercel ([AGL-2436](https://linear.app/aglyn/issue/AGL-2436))
- **aglyn,console:** the country signal is not one platform's header ([AGL-2436](https://linear.app/aglyn/issue/AGL-2436))
- **aglyn,console,docs:** the console declares the advertising it actually does ([AGL-1597](https://linear.app/aglyn/issue/AGL-1597))
- **plugins-data:** the delete spy declares the argument it is asserted on
- **plugins-mui,commerce:** a subtitle names its element at the call site ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **aglyn,plugins-data,console,tenant:** a record delete asks the query, not a page ([AGL-180](https://linear.app/aglyn/issue/AGL-180))
- **shared-ui-theme,commerce:** a subtitle is a type style, not a heading ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486), [AGL-1487](https://linear.app/aglyn/issue/AGL-1487))
- **tenant,aglyn,plugins-mui:** every published page gets a main landmark ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **tenant:** the analytics hits reach Google again, on both of its domains ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **console:** a tracking id can be turned off, not just on ([AGL-1608](https://linear.app/aglyn/issue/AGL-1608))
- **commerce,console:** a scanned barcode reaches the whole catalog ([AGL-693](https://linear.app/aglyn/issue/AGL-693), [AGL-2292](https://linear.app/aglyn/issue/AGL-2292))
- **commerce,console:** the catalog search reaches the whole catalog ([AGL-693](https://linear.app/aglyn/issue/AGL-693), [AGL-2292](https://linear.app/aglyn/issue/AGL-2292))

### Performance

- **tenant:** the root layout stops pulling the icon catalog for one constant
- **tools:** the page-weight gate pins the boundary, not only the ceiling
- **tenant:** the published page stops reaching core through a barrel
- **tenant:** the page-weight gate and the host module its parent commit names
- **tenant:** a published page stops downloading the console half of core
- **besigner:** an entity picker browses a page instead of a catalog
- **plugins:** the console cards order their windows and read pickers on demand
- **commerce:** the product editor reads its pickers when it is opened
- **inbox:** the inbox mounts the section being read, not all of them ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **console:** one read for a whole page of /v1/sites, not one per site ([AGL-1302](https://linear.app/aglyn/issue/AGL-1302))
- **tenant-data-admin:** the media delivery gate reads three fields, in one batch ([AGL-1302](https://linear.app/aglyn/issue/AGL-1302))
- **console:** a hub index redirects on the server, so it stops flashing blank ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **commerce:** one catalog read seeds every grid on the page

### Reverted

- **tools:** drop set-env-secret, which only worked for Aglyn

### Changed

- **console:** the zone read uses the documented endpoint version
- **console:** a form is a capability with both halves, so it is a plugin
- **plugins:** the campaign shapes marketing reads stop living inside the email plugin
- **console:** a campaign is a marketing object, and now lives there
- **ui:** the rule that a rate names its denominator has one home
- **email:** the templates section says templates in its URL too
- **email:** one figure component, and one name for a message's campaign
- **ui:** the create drawer moves to a library so plugin pages can use it
- **aglyn:** the list-enrollment rule moves to the framework both callers can reach
- **console:** the section that holds Workflows is no longer called Workflows
- **rules:** the host membership helper is named for the test it makes
- **console:** drop the second spelling of the Setup tab-id list
- **console:** the Setup layout stops importing the cards it no longer renders
- **console:** Host Setup is five routes, and its sections stop costing what they never showed ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **email,marketing,workflows:** three more plugin hubs are routes, metered first ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **console:** drop the pre-split billing page
- **console,aglyn:** billing is four sections, and an unopened one costs nothing ([AGL-1422](https://linear.app/aglyn/issue/AGL-1422))
- **console:** delete the embedded checkout panel
- **console,commerce:** marketplace sections are routes, unopened tabs stop reading ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **console:** drop the checkout dialog the panel replaced
- **console,shared-ui-next:** the tab param's compatibility layer goes
- **console,tenant:** the console asks a provider for a name, not Vercel ([AGL-2436](https://linear.app/aglyn/issue/AGL-2436), [AGL-1273](https://linear.app/aglyn/issue/AGL-1273))
- **aglyn,console,tenant:** one consent dialog, on every surface ([AGL-1498](https://linear.app/aglyn/issue/AGL-1498))
- **console:** the account page becomes six routes ([AGL-693](https://linear.app/aglyn/issue/AGL-693))

### Documentation

- **pricing:** checking a live page needs the probe header, not a browser
- **pricing:** the SEO description is a ninth surface, and one request cannot confirm a publish
- **pricing:** the page caught up, and the SEO description is a surface too
- **pricing:** the Agency raise is recorded, and every surface it had to reach
- **email:** two comments cite copy that no longer says what they quote
- **email:** the words describe the sending model the product actually has
- **self-host:** the two shared-pool settings get their rows
- **email:** a sending-domain slot is a bundled quota, not a per-domain price
- **pricing:** the recorded page weight is first paint, and says so
- **rules:** record the resolved-permission projection where the other two live
- **selfhost:** state the ratchet's rule as a technical fact
- **specs:** record what the read-cost pass fixed and what is left
- **specs:** classify every oversized read by who pays for it
- **email:** the gate's comments state the rule, not how it was assembled
- **email:** sending domains and the proof drawer are documented, and the registers agree
- **repo:** the plugin boundary audit names the elements filed in the wrong library
- **email:** tell customers about import, opt-down and confirmation
- **repo:** the one-click unsubscribe check says what a human must actually do
- **email:** the gap register records what closed, and what P11 leaves open
- **email:** a template's standing has no writer yet, and says so
- **specs:** the email registers say what is actually built
- **self-host:** the marketing frequency ceiling is a configurable number
- **email:** the gap register marks what has since been closed
- **email:** the nine-field rule is reachable, and G4 is closed
- **email:** topics and the preference page, for customers and for operators
- **email:** the campaign send cap is per workspace, not per site
- **specs:** the email overhaul spec stops describing problems that are fixed
- **console:** the read meter records why the emails figures moved
- **specs:** the shared domain hides which tenant earned a complaint
- **specs:** where email actually stands against the products it is sold beside
- **api:** the form-submission object publishes its form id and its routing
- **self-host:** the two sending-domain variables an operator must set
- **tenant-data-admin:** name every writer the dated rule filters depend on
- **design:** what custom sending domains do, and where the build stops
- **specs:** the email spec described a send order the code never had
- **specs:** the list-member key is one derivation, and not in the file either spec named ([AGL-2499](https://linear.app/aglyn/issue/AGL-2499))
- **specs:** why the Inbox got a reply button and not an add-to-list one
- the automation section is named Automation, its tabs keep their names
- **specs:** a form is not an object in this product, and that is the whole problem
- **specs:** correct the email spec's headline finding — the secret was set
- **specs:** the email feature is mostly built and mostly switched off
- send readers to Admin for the surfaces that already live there
- **console,tools:** the unmetered months are written off, and why not to chase them ([AGL-1280](https://linear.app/aglyn/issue/AGL-1280))
- **console:** the Billing address card says which tax it sets ([AGL-1133](https://linear.app/aglyn/issue/AGL-1133))
- **marketplace,console:** name the listing review state and pin the queue
- **releasing,scripts,tenant:** the owed rules deploy, the billing decision, and the field a feed cannot be read without ([AGL-118](https://linear.app/aglyn/issue/AGL-118), [AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **aglyn:** the dead-status note stops citing a bucket that no longer exists
- put the stale-GA-settings marker where the paragraph still reads ([AGL-1597](https://linear.app/aglyn/issue/AGL-1597))
- **analytics,docs:** five places still said Google Signals was off ([AGL-1597](https://linear.app/aglyn/issue/AGL-1597), [AGL-1649](https://linear.app/aglyn/issue/AGL-1649), [AGL-1594](https://linear.app/aglyn/issue/AGL-1594), [AGL-1648](https://linear.app/aglyn/issue/AGL-1648))
- **tenant,aglyn:** a comment that claimed a reader, and a person quoted
- the domain provider gets a runbook, and four shipped surfaces get a page
- the self-host template names the domain driver and the tax jurisdiction
- **docs,aglyn,console:** every env var a self-host operator sets, in one place ([AGL-905](https://linear.app/aglyn/issue/AGL-905), [AGL-2436](https://linear.app/aglyn/issue/AGL-2436))
- **tenant:** the CSP says why it carries no script-src and no trusted types ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486), [AGL-1152](https://linear.app/aglyn/issue/AGL-1152))
- **analytics:** google signals is on, and on deliberately

<details>
<summary>Also in this release: 34 test, 8 chore, 4 style</summary>

- **email:** a free site is proved to send, not just to be ungated
- **email:** the batched-send clock is the one the code reads
- **email:** the guards on a branded opt-out page
- **console:** the metering case derives its bands instead of retyping them
- **console:** the two conversions assertions that were passing on nothing
- **email:** the campaigns section holds a document ceiling, not a log line
- **console:** the forms list drops a snackbar it never raises
- **forms:** the contract check stands between the author and the write
- **leads:** a returning person's capture serialises against nobody ([AGL-2404](https://linear.app/aglyn/issue/AGL-2404), [AGL-2231](https://linear.app/aglyn/issue/AGL-2231))
- **email:** every create control sits in its card header, contained
- **email:** campaign figures line up under their own headers
- **email:** the seven campaign-send doubles model the topic filter
- **console:** classify the campaign report's two tables ([AGL-2501](https://linear.app/aglyn/issue/AGL-2501))
- **repo:** ignore the isolated nx cache directories
- **console:** the two pricing guards follow the lowered allowances
- **console:** the three plan cards read across cleanly ([AGL-1864](https://linear.app/aglyn/issue/AGL-1864))
- **scripts:** the citation ceiling admits AGL-2502 ([AGL-2502](https://linear.app/aglyn/issue/AGL-2502))
- **scripts:** the backfill self-test names no Aglyn hostname
- **marketing:** the two suites the org hourly claim was not added to
- **marketing:** a sendable campaign audience carries a consent basis
- **email:** the three capture surfaces record a basis, and only a basis
- **scripts:** report the people holding two list rows, and never delete one ([AGL-2499](https://linear.app/aglyn/issue/AGL-2499))
- **events-calendar,redirects:** the ceiling helpers are real in the doubles ([AGL-2501](https://linear.app/aglyn/issue/AGL-2501))
- **console:** the member-drawer double answers the whole firestore surface ([AGL-2501](https://linear.app/aglyn/issue/AGL-2501))
- **console:** the free-workspace ceiling on /api/orgs/create is covered ([AGL-2265](https://linear.app/aglyn/issue/AGL-2265))
- **console:** the tax controls join the super-only surface map ([AGL-2021](https://linear.app/aglyn/issue/AGL-2021))
- **console:** the create doubles carry the audit write and the refusal ([AGL-118](https://linear.app/aglyn/issue/AGL-118), [AGL-2265](https://linear.app/aglyn/issue/AGL-2265))
- **console:** meter what each Host Setup section reads, before it becomes routes ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **marketplace,console:** the sale's jurisdiction, and that nothing is backfilled ([AGL-2137](https://linear.app/aglyn/issue/AGL-2137))
- **commerce:** the refund suite can reach line refunds, and stops eating its errors
- **console:** the crowding spec fills both access halves, so it can fail
- **console:** the overview answers a spike instead of throwing on it ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **tenant,console:** the console guard names its one ad mount instead of forbidding all of them
- **aglyn:** the hardcoded-host guard names the personal-identifier checker
- **tools,console,tenant-data-admin,docs:** the public repo stops naming a person
- **console:** the footer guard walks every plugin, and a paged list names its order ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **console:** the site-plugins mocks name every component the card renders
- one canonical author identity
- untrack the agent handoff notes
- untrack the agent handoff notes as well
- untrack the personal agent instructions
- **console:** the media-alt assertion stopped testing the formatter
- **aglyn:** type the consent theme spec against the real stored record
- **aglyn:** the site's consent surface wears the site's theme ([AGL-1591](https://linear.app/aglyn/issue/AGL-1591))
- **aglyn:** the closed-tab recovery is covered, not just written ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152))
- **tenant:** prove the shared gtag library is fetched once, not twice ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152))

</details>

1 commit(s) did not parse as conventional commits (merge commits and the like) and did not contribute to the version bump.

## v1.0.0-beta.27 — 2026-08-27

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/v1.0.0-beta.26...v1.0.0-beta.27)

### Added

- **console:** sections become routes, starting with Team ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **console,commerce,tenant:** the Site users card searches every member ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **console,tenant-data-admin:** the account list searches every pool ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **console:** the filter panel comes back, answering real Firestore predicates ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **console:** the organization search finds a word anywhere in the name ([AGL-693](https://linear.app/aglyn/issue/AGL-693), [AGL-2324](https://linear.app/aglyn/issue/AGL-2324))
- **console:** the staff organization search reaches the whole collection ([AGL-693](https://linear.app/aglyn/issue/AGL-693))

### Fixed

- **console:** the root .env reaches the app, and the CSP card names an incident ([AGL-693](https://linear.app/aglyn/issue/AGL-693), [AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **console,shared-ui-jsx:** masonry fans out, and a root card stops spacing itself ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **contacts,console:** the contact list is ordered, and searches all of it ([AGL-2292](https://linear.app/aglyn/issue/AGL-2292), [AGL-1706](https://linear.app/aglyn/issue/AGL-1706))
- **console,tenant-data-admin:** a new org is not born scope-drifted ([AGL-1038](https://linear.app/aglyn/issue/AGL-1038), [AGL-1725](https://linear.app/aglyn/issue/AGL-1725), [AGL-1726](https://linear.app/aglyn/issue/AGL-1726))
- **tools:** the firewall finding names the path it found ([AGL-2483](https://linear.app/aglyn/issue/AGL-2483))
- **console,tools:** the activity feeds filter the feed, not the page ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **console,shared-ui-jsx:** the org filter targets a field that exists ([AGL-693](https://linear.app/aglyn/issue/AGL-693), [AGL-1028](https://linear.app/aglyn/issue/AGL-1028))
- **console:** the organization list stops offering a filter it cannot apply ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **console,shared-ui-jsx:** the list table gets its toolbar, its height, and one search ([AGL-693](https://linear.app/aglyn/issue/AGL-693))

### Changed

- **console:** the routed section indexes drop their ?tab= maps ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **console:** organization settings becomes eight routes ([AGL-693](https://linear.app/aglyn/issue/AGL-693), [AGL-2154](https://linear.app/aglyn/issue/AGL-2154))
- **shared-ui-next,console:** the routed rail is HubTabs' twin, not a rival ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **console:** two staff read-outs join the shared table ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **console:** the actor activity log joins the shared table ([AGL-693](https://linear.app/aglyn/issue/AGL-693))

### Documentation

- **tools:** the third way the firewall PATCH error misleads ([AGL-2483](https://linear.app/aglyn/issue/AGL-2483))
- the README shows the Besigner, and links every social profile

## v1.0.0-beta.26 — 2026-08-27

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/7efa6db49...v1.0.0-beta.26)

### Added

- **cloud:** the console's daily crons get a punctual runner ([AGL-1617](https://linear.app/aglyn/issue/AGL-1617))
- **console:** the organization feed includes its sites ([AGL-1490](https://linear.app/aglyn/issue/AGL-1490), [AGL-1993](https://linear.app/aglyn/issue/AGL-1993))
- **console:** activity by person, and the logs the staff pages were missing ([AGL-1488](https://linear.app/aglyn/issue/AGL-1488))
- **cloud:** index activity by actor across the whole platform ([AGL-1488](https://linear.app/aglyn/issue/AGL-1488))
- **besigner,docs:** interactions get their own panel tab, and Info folds in ([AGL-1486](https://linear.app/aglyn/issue/AGL-1486))
- **besigner:** the hierarchy eye is display:none, not the hidden class ([AGL-1479](https://linear.app/aglyn/issue/AGL-1479), [AGL-1480](https://linear.app/aglyn/issue/AGL-1480), [AGL-1478](https://linear.app/aglyn/issue/AGL-1478))
- **tools,workflows,docs:** retire element-scoped actions into their nodes ([AGL-1478](https://linear.app/aglyn/issue/AGL-1478))
- **console,besigner:** the besigner writes an interaction onto its element ([AGL-1478](https://linear.app/aglyn/issue/AGL-1478), [AGL-1066](https://linear.app/aglyn/issue/AGL-1066), [AGL-1476](https://linear.app/aglyn/issue/AGL-1476))
- **aglyn,marketing:** a published page runs the interactions on its own nodes ([AGL-1478](https://linear.app/aglyn/issue/AGL-1478), [AGL-659](https://linear.app/aglyn/issue/AGL-659))
- **aglyn,tenant:** keep the abuse-report control on the page ([AGL-1477](https://linear.app/aglyn/issue/AGL-1477))
- **besigner:** the hierarchy eye hides a layer ([AGL-592](https://linear.app/aglyn/issue/AGL-592), [AGL-1405](https://linear.app/aglyn/issue/AGL-1405))
- **besigner,docs:** hide an element from the published site without typing a class ([AGL-592](https://linear.app/aglyn/issue/AGL-592))
- **besigner,docs:** switch a class off on the canvas without removing it ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **besigner,shared:** carry the style switch across every panel control ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **console:** owner controls for the embed and connection allowlists ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152))
- **tenant:** frame-src is enforced on published sites ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152), [AGL-518](https://linear.app/aglyn/issue/AGL-518), [AGL-1944](https://linear.app/aglyn/issue/AGL-1944))
- **tenant:** connect-src is enforced on published sites ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152))
- **besigner,shared,docs:** switch one style off without losing its value ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **besigner,docs:** show a hidden element on the canvas from its hierarchy row ([AGL-592](https://linear.app/aglyn/issue/AGL-592))
- **docs,console:** the CDN moves to every plan, and the feature matrix becomes tracked ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152))
- **console:** layouts and components get the working draft too ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152))
- **console:** a draft save writes a draft, not the live page ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152))
- **tenant,console:** owner controls for media, fonts and form destinations ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152))
- **console:** a Security tab on host setup ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152))
- **console:** the document switcher covers components too ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **console:** traffic leads the screen view, and activity pages for free ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **tenant,console,docs:** constrain workers and the manifest ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152))
- **console:** the save button names the next action, on every editor that has one ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152))
- **console:** the save button splits into Save draft and Save & publish ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152))

### Fixed

- **console:** the two lint errors holding the gate red
- **tenant:** a workspace subdomain IS the console, so the edit hint may return to it ([AGL-627](https://linear.app/aglyn/issue/AGL-627))
- **tools:** the three red gate guards, and the declaration one of them asked for ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152))
- **console:** re-auth stops sending you back to sign in, and the other tab heals ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486), [AGL-1062](https://linear.app/aglyn/issue/AGL-1062), [AGL-664](https://linear.app/aglyn/issue/AGL-664))
- **cloud,console:** the daily crons leave GitHub's scheduler ([AGL-1617](https://linear.app/aglyn/issue/AGL-1617))
- **console:** the org-wide feed pages, and the reaper reads its claims safely ([AGL-1490](https://linear.app/aglyn/issue/AGL-1490), [AGL-942](https://linear.app/aglyn/issue/AGL-942))
- **console:** an idle staff tab stops talking itself into a 404 ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **commerce,tenant:** commerce lists page, and the liability is a real total ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486), [AGL-2292](https://linear.app/aglyn/issue/AGL-2292), [AGL-1767](https://linear.app/aglyn/issue/AGL-1767))
- **console:** the activity feed pages, and its rows carry their date ([AGL-2292](https://linear.app/aglyn/issue/AGL-2292), [AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **plugins-mui:** a subtitle is not a heading ([AGL-1487](https://linear.app/aglyn/issue/AGL-1487))
- **besigner,console:** saving an unchanged document says so instead of writing ([AGL-1483](https://linear.app/aglyn/issue/AGL-1483), [AGL-1262](https://linear.app/aglyn/issue/AGL-1262))
- **console:** staff timestamps carry the time, in the reader's own zone ([AGL-1482](https://linear.app/aglyn/issue/AGL-1482))
- **besigner:** the row menu opens at the panel edge, not the row's ([AGL-1481](https://linear.app/aglyn/issue/AGL-1481))
- **besigner,console:** node edits record an undo step and reach the map ([AGL-1480](https://linear.app/aglyn/issue/AGL-1480), [AGL-1481](https://linear.app/aglyn/issue/AGL-1481))
- **aglyn,console,marketplace,tenant:** close the image/* prefix and the fifth ingress ([AGL-1476](https://linear.app/aglyn/issue/AGL-1476), [AGL-1474](https://linear.app/aglyn/issue/AGL-1474))
- **console:** the nav bar aligns its active tab in a background tab too ([AGL-649](https://linear.app/aglyn/issue/AGL-649))
- **plugins-mui:** a presence flag is not a cleared attribute ([AGL-592](https://linear.app/aglyn/issue/AGL-592))
- **console:** narrow the tab strip's scroll arrows
- **console:** put the secondary bar's first tab back to its stock metrics
- **console:** a flat screens list pays for no toggle slot and no indent ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **console:** expanding a screen holds the columns still and slides its children in ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **console:** row actions are anchors and the quick action is named in the menu ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **console:** the secondary bar's first tab hung a gutter right of every other bar
- **tools:** emit browser source maps so client error reports name a file
- **console:** saving an email version no longer changes which email sends
- **shared:** the styles panel colour swatch drew a wedge out of its circle
- **besigner:** hovering a selected node lost its wash and clipped its controls ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **besigner:** the hover outline and its wash were slate, not the accent ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **console:** a dead session cost six denied reads per read, not one ([AGL-1440](https://linear.app/aglyn/issue/AGL-1440), [AGL-216](https://linear.app/aglyn/issue/AGL-216))
- **console:** the installed app icon had a translucent seam along its bottom edge ([AGL-1058](https://linear.app/aglyn/issue/AGL-1058))
- **tenant,console:** the host caches expired between requests, so they never hit ([AGL-1302](https://linear.app/aglyn/issue/AGL-1302))
- **billing:** an org with no billing document paid two reads on every lookup ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152), [AGL-1289](https://linear.app/aglyn/issue/AGL-1289))

### Performance

- **shared:** the log level decides whether a debug line reaches the console
- **plugins,shared:** a published page no longer ships the Firebase client SDK

### Reverted

- **console:** undo the secondary app bar spacing changes

### Changed

- **console:** the site activity log joins the shared table ([AGL-693](https://linear.app/aglyn/issue/AGL-693), [AGL-1488](https://linear.app/aglyn/issue/AGL-1488))
- **console:** the staff users list joins the shared table ([AGL-693](https://linear.app/aglyn/issue/AGL-693), [AGL-1122](https://linear.app/aglyn/issue/AGL-1122), [AGL-2005](https://linear.app/aglyn/issue/AGL-2005), [AGL-360](https://linear.app/aglyn/issue/AGL-360), [AGL-1962](https://linear.app/aglyn/issue/AGL-1962))
- **console,shared-ui-jsx:** the list table becomes shared, and staff orgs adopt it ([AGL-693](https://linear.app/aglyn/issue/AGL-693), [AGL-1151](https://linear.app/aglyn/issue/AGL-1151), [AGL-1895](https://linear.app/aglyn/issue/AGL-1895))
- **console,commerce:** every list pages, and none of them grows ([AGL-693](https://linear.app/aglyn/issue/AGL-693), [AGL-1122](https://linear.app/aglyn/issue/AGL-1122))
- **console,shared-ui-jsx:** one pagination footer, on every list ([AGL-693](https://linear.app/aglyn/issue/AGL-693), [AGL-703](https://linear.app/aglyn/issue/AGL-703), [AGL-1895](https://linear.app/aglyn/issue/AGL-1895))
- **console:** custom domain, security and activity move to Admin ([AGL-1484](https://linear.app/aglyn/issue/AGL-1484), [AGL-1485](https://linear.app/aglyn/issue/AGL-1485))
- **besigner:** drop the element toolbar the canvas stopped rendering

### Documentation

- **tenant:** record why script-src and style-src stay off this surface ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152), [AGL-1228](https://linear.app/aglyn/issue/AGL-1228))
- replace transcript openers with the constraint they introduced
- **besigner,shared,tools:** restore comment blocks cut off mid-sentence
- **console,tenant:** restore comment blocks cut off mid-sentence
- name roles, not people, in runbooks and guards
- **aglyn,plugins,tenant:** rewrite library comments to explain the code
- **console:** rewrite spec and legal-constant comments to explain the code
- **console:** rewrite api and component comments to explain the code
- **besigner,shared:** rewrite style-panel comments to explain the code
- **console,besigner,tenant:** rewrite comments to explain the code
- **aglyn:** rewrite plan-entitlements comments to explain the code

<details>
<summary>Also in this release: 1 test, 4 chore, 1 style</summary>

- **tenant:** pick up the generated root-params types reference
- **besigner:** cover the hidden-element reveal through the rendered tree ([AGL-592](https://linear.app/aglyn/issue/AGL-592))
- american spelling in the policy builder's comments
- remove the message text itself, not just the attribution
- finish removing quoted messages and genericise owner-role references
- remove quoted owner messages from code comments and docs

</details>

## v1.0.0-beta.25 — 2026-08-26

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/v1.0.0-beta.24...v1.0.0-beta.25)

### Fixed

- **tenant:** the verdict route's apex import resolved undefined at runtime ([AGL-1289](https://linear.app/aglyn/issue/AGL-1289))

## v1.0.0-beta.24 — 2026-08-26

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/29892ba1d...v1.0.0-beta.24)

### Added

- **tenant:** img-src is enforced on published sites (AGL-1152, closes AGL-1726) ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152), [AGL-1726](https://linear.app/aglyn/issue/AGL-1726), [AGL-2195](https://linear.app/aglyn/issue/AGL-2195), [AGL-523](https://linear.app/aglyn/issue/AGL-523))
- **tenant:** measurement beacons survive img-src enforcement ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152), [AGL-1726](https://linear.app/aglyn/issue/AGL-1726), [AGL-1671](https://linear.app/aglyn/issue/AGL-1671))
- **tools:** seed each site's approved image hosts from what it already loads ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152), [AGL-1726](https://linear.app/aglyn/issue/AGL-1726), [AGL-1725](https://linear.app/aglyn/issue/AGL-1725), [AGL-518](https://linear.app/aglyn/issue/AGL-518))
- **besigner:** the editor warns before an unapproved image host is published ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152), [AGL-247](https://linear.app/aglyn/issue/AGL-247))
- **console:** a site owner can say which external hosts its images come from ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152), [AGL-1726](https://linear.app/aglyn/issue/AGL-1726))
- **tenant:** the img-src allowlist becomes the site owner's, per site ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152), [AGL-1726](https://linear.app/aglyn/issue/AGL-1726), [AGL-1228](https://linear.app/aglyn/issue/AGL-1228))

### Fixed

- **tenant,console,docs:** isolate the origin with COOP ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152), [AGL-1228](https://linear.app/aglyn/issue/AGL-1228), [AGL-523](https://linear.app/aglyn/issue/AGL-523))
- **console:** a publish never dropped a custom domain's cached pages ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152))
- **console:** the screens empty state matches the other three ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152))
- **console:** one empty state across the four artifact lists ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152), [AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **console:** the org Data page rendered a completely blank body ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152), [AGL-2080](https://linear.app/aglyn/issue/AGL-2080), [AGL-1648](https://linear.app/aglyn/issue/AGL-1648))
- **tools,aglyn:** two guards my own change tripped ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152), [AGL-2195](https://linear.app/aglyn/issue/AGL-2195), [AGL-1014](https://linear.app/aglyn/issue/AGL-1014))
- **tenant:** the measurement gate missed the field ad pixels actually use ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152))
- **console:** the staff org list shows the plan an org reads as ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152))
- **docs:** docs.aglyn.com ships with no CSP and no nosniff at all ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152), [AGL-523](https://linear.app/aglyn/issue/AGL-523), [AGL-1788](https://linear.app/aglyn/issue/AGL-1788), [AGL-1799](https://linear.app/aglyn/issue/AGL-1799), [AGL-1228](https://linear.app/aglyn/issue/AGL-1228))
- **console:** a stale tab stops being stuck on an expired-token error ([AGL-1200](https://linear.app/aglyn/issue/AGL-1200), [AGL-1066](https://linear.app/aglyn/issue/AGL-1066), [AGL-1471](https://linear.app/aglyn/issue/AGL-1471))

<details>
<summary>Also in this release: 1 chore</summary>

- **aglyn:** prune the self-host allowlist row org-lockdown no longer needs ([AGL-2195](https://linear.app/aglyn/issue/AGL-2195))

</details>

## v1.0.0-beta.23 — 2026-08-26

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/v1.0.0-beta.22...v1.0.0-beta.23)

### Fixed

- **test-infra:** the hermetic-env scrubber stops leaking the private key ([AGL-690](https://linear.app/aglyn/issue/AGL-690), [AGL-689](https://linear.app/aglyn/issue/AGL-689))

### Performance

- **tenant,console:** the ISR window stops being the propagation mechanism ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152), [AGL-1150](https://linear.app/aglyn/issue/AGL-1150), [AGL-1302](https://linear.app/aglyn/issue/AGL-1302), [AGL-2195](https://linear.app/aglyn/issue/AGL-2195))
- **tenant:** a page with a collection block stops paying a serial read ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152), [AGL-1440](https://linear.app/aglyn/issue/AGL-1440))
- **tenant,aglyn:** the enrichers stop queueing, and a phase stops mislabelling ([AGL-1152](https://linear.app/aglyn/issue/AGL-1152), [AGL-1302](https://linear.app/aglyn/issue/AGL-1302))

## v1.0.0-beta.22 — 2026-08-26

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/0703692fa...v1.0.0-beta.22)

### Added

- **tools:** a backfill that gives existing media the variants it advertises ([AGL-1442](https://linear.app/aglyn/issue/AGL-1442), [AGL-1476](https://linear.app/aglyn/issue/AGL-1476))

## v1.0.0-beta.21 — 2026-08-26

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/v1.0.0-beta.20...v1.0.0-beta.21)

### Fixed

- **cloud,console:** the log-drain receiver moves off the project its own drain watches ([AGL-1921](https://linear.app/aglyn/issue/AGL-1921))

### Performance

- **plugins,aglyn:** the srcSet stops advertising the full-size original ([AGL-1442](https://linear.app/aglyn/issue/AGL-1442), [AGL-2486](https://linear.app/aglyn/issue/AGL-2486))

## v1.0.0-beta.20 — 2026-08-26

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/6d13021c3...v1.0.0-beta.20)

### Added

- **console,tenant,aglyn:** a Tracking tab, and Tag Manager under the same gate ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **console:** a new collection is defined when it is created ([AGL-2498](https://linear.app/aglyn/issue/AGL-2498), [AGL-105](https://linear.app/aglyn/issue/AGL-105))
- **console:** the theme preview shows the whole type ramp ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **console,aglyn:** a screen says what it is holding up, when asked ([AGL-703](https://linear.app/aglyn/issue/AGL-703), [AGL-845](https://linear.app/aglyn/issue/AGL-845), [AGL-1335](https://linear.app/aglyn/issue/AGL-1335), [AGL-1893](https://linear.app/aglyn/issue/AGL-1893), [AGL-405](https://linear.app/aglyn/issue/AGL-405), [AGL-693](https://linear.app/aglyn/issue/AGL-693))

### Fixed

- **console:** a ?tab= link opens the tab it names ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **console,aglyn,tenant:** the SEO fields are one card, and a person has a photo ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486), [AGL-1191](https://linear.app/aglyn/issue/AGL-1191))
- **console:** the upload areas the first pass missed ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **console:** an address field is called Slug, everywhere ([AGL-2498](https://linear.app/aglyn/issue/AGL-2498))
- **console,theme:** the screens tree opens closed, and the ramp guard matches it ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **console:** every upload area says what size to bring ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **console:** one favicon, one entity logo, and a size said before the upload ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **theme,console:** a Heading 3 was bigger than a Heading 2 ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **besigner:** the picker-demand spec names a field type that exists ([AGL-703](https://linear.app/aglyn/issue/AGL-703))
- **theme,console:** a dialog leaves room for its first field's label ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **console:** every paginated list starts on its smallest page ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **jsx:** the empty-state artwork reads its greys off the theme ([AGL-693](https://linear.app/aglyn/issue/AGL-693))
- **tools:** the gate dies on macOS before it runs a single phase ([AGL-2089](https://linear.app/aglyn/issue/AGL-2089))
- **console,jsx:** one table footer, and an empty library that invites ([AGL-693](https://linear.app/aglyn/issue/AGL-693))

### Performance

- **plugins:** a plugin's revocation read stops costing a second round trip ([AGL-1302](https://linear.app/aglyn/issue/AGL-1302), [AGL-2307](https://linear.app/aglyn/issue/AGL-2307))
- **tenant,plugins:** the render caches stop expiring on the request rate ([AGL-1302](https://linear.app/aglyn/issue/AGL-1302), [AGL-2010](https://linear.app/aglyn/issue/AGL-2010))
- **console,aglyn:** a publish reads the lookups its page actually needs ([AGL-703](https://linear.app/aglyn/issue/AGL-703), [AGL-188](https://linear.app/aglyn/issue/AGL-188), [AGL-1397](https://linear.app/aglyn/issue/AGL-1397))
- **console,besigner,aglyn:** stop paying for lists nobody is looking at ([AGL-703](https://linear.app/aglyn/issue/AGL-703), [AGL-1440](https://linear.app/aglyn/issue/AGL-1440))

### Changed

- **console:** creating a collection is a drawer, like every other artifact ([AGL-2498](https://linear.app/aglyn/issue/AGL-2498), [AGL-699](https://linear.app/aglyn/issue/AGL-699))

<details>
<summary>Also in this release: 1 test</summary>

- **jsx-forms,console:** the setup page's inline validation does work ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))

</details>

## v1.0.0-beta.19 — 2026-08-25

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/0162186e5...v1.0.0-beta.19)

### Fixed

- **besigner:** the styles-panel test fixture names every scale it must ([AGL-1308](https://linear.app/aglyn/issue/AGL-1308))

## v1.0.0-beta.18 — 2026-08-25

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/v1.0.0-beta.17...v1.0.0-beta.18)

### Fixed

- **tenant:** the counter-notice names the agent it is served on ([AGL-2035](https://linear.app/aglyn/issue/AGL-2035), [AGL-2026](https://linear.app/aglyn/issue/AGL-2026), [AGL-2044](https://linear.app/aglyn/issue/AGL-2044))

### Documentation

- **env:** the designated-agent block is required, not deferred ([AGL-2035](https://linear.app/aglyn/issue/AGL-2035))

## v1.0.0-beta.17 — 2026-08-25

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/v1.0.0-beta.16...v1.0.0-beta.17)

### Added

- **monitoring:** a Vercel log-drain receiver for the platform 5xx ([AGL-1921](https://linear.app/aglyn/issue/AGL-1921), [AGL-1923](https://linear.app/aglyn/issue/AGL-1923), [AGL-723](https://linear.app/aglyn/issue/AGL-723))

### Fixed

- **sso:** the attestation helper stops hard-coding an Aglyn hostname ([AGL-1887](https://linear.app/aglyn/issue/AGL-1887))
- **lockdown:** a takedown at org and host scope survives a failed read ([AGL-1881](https://linear.app/aglyn/issue/AGL-1881), [AGL-1621](https://linear.app/aglyn/issue/AGL-1621), [AGL-1501](https://linear.app/aglyn/issue/AGL-1501))
- **rules:** a platform lockdown freezes client-SDK writes too ([AGL-1881](https://linear.app/aglyn/issue/AGL-1881), [AGL-1965](https://linear.app/aglyn/issue/AGL-1965), [AGL-210](https://linear.app/aglyn/issue/AGL-210), [AGL-1501](https://linear.app/aglyn/issue/AGL-1501), [AGL-1887](https://linear.app/aglyn/issue/AGL-1887))
- **i18n,besigner:** standardize on american spelling, fix token menu width

### Documentation

- **screens,layouts:** screens, layouts, components and templates each get their own page ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486), [AGL-1074](https://linear.app/aglyn/issue/AGL-1074))

<details>
<summary>Also in this release: 3 test</summary>

- **aglyn,commerce:** specs assert the american spellings the app now renders
- **console:** the consent-preview spec asserts the american spelling it now renders
- **sso:** the attestation marker is proven unwritable from any client ([AGL-1887](https://linear.app/aglyn/issue/AGL-1887))

</details>

## v1.0.0-beta.16 — 2026-08-25

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/v1.0.0-beta.15...v1.0.0-beta.16)

### Fixed

- **tenant,aglyn:** a bounded read says so even when the gate thinned it ([AGL-1516](https://linear.app/aglyn/issue/AGL-1516), [AGL-471](https://linear.app/aglyn/issue/AGL-471))
- **console:** the staff user detail cards balance instead of stretching ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **orgs:** an invitation cannot demote the owner out of their own org ([AGL-1888](https://linear.app/aglyn/issue/AGL-1888), [AGL-1375](https://linear.app/aglyn/issue/AGL-1375))

### Documentation

- **orgs:** an invitation never changes who owns the workspace ([AGL-1888](https://linear.app/aglyn/issue/AGL-1888))

## v1.0.0-beta.15 — 2026-08-25

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/v1.0.0-beta.14...v1.0.0-beta.15)

### Added

- **console:** the abuse queue says who is holding no receipt ([AGL-2400](https://linear.app/aglyn/issue/AGL-2400))
- **besigner:** a screen says so when a component on it changed under the author ([AGL-1898](https://linear.app/aglyn/issue/AGL-1898))
- **console:** a collection entry opens a detail page, not a dialog ([AGL-2498](https://linear.app/aglyn/issue/AGL-2498), [AGL-845](https://linear.app/aglyn/issue/AGL-845), [AGL-471](https://linear.app/aglyn/issue/AGL-471))

### Fixed

- **legal:** a receipt that never left is written down, not warned about ([AGL-2400](https://linear.app/aglyn/issue/AGL-2400))
- **sso:** the console offers turn-on for an org the publish gate now admits ([AGL-1887](https://linear.app/aglyn/issue/AGL-1887))
- **sso:** claiming an attested domain persists the token it shows ([AGL-1887](https://linear.app/aglyn/issue/AGL-1887))
- **consent:** the host switch that obtains an advertising basis is declared ([AGL-1649](https://linear.app/aglyn/issue/AGL-1649), [AGL-1498](https://linear.app/aglyn/issue/AGL-1498), [AGL-1355](https://linear.app/aglyn/issue/AGL-1355), [AGL-1361](https://linear.app/aglyn/issue/AGL-1361))

### Documentation

- **legal:** the staff runbook said no receipt is emailed, and was wrong ([AGL-2400](https://linear.app/aglyn/issue/AGL-2400))
- **media,besigner:** tell an author who hotlinks what their visitor's browser does ([AGL-1736](https://linear.app/aglyn/issue/AGL-1736))
- **legal:** a host an author typed is not an Annex III row, and must not become one ([AGL-1736](https://linear.app/aglyn/issue/AGL-1736))
- **ci:** the external-facts credential is set, and its own header said otherwise ([AGL-1921](https://linear.app/aglyn/issue/AGL-1921))
- **monitoring:** the monitor inventory is ten, and server-errors is not one of them ([AGL-1921](https://linear.app/aglyn/issue/AGL-1921), [AGL-1843](https://linear.app/aglyn/issue/AGL-1843))

## v1.0.0-beta.14 — 2026-08-24

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/v1.0.0-beta.13...v1.0.0-beta.14)

### Added

- **email:** marketing consent capture, list opt-in, resubscribe ([AGL-2499](https://linear.app/aglyn/issue/AGL-2499))

### Fixed

- **security:** two secret compares that short-circuit on the first byte ([AGL-1881](https://linear.app/aglyn/issue/AGL-1881), [AGL-512](https://linear.app/aglyn/issue/AGL-512))
- **tenant:** the beacon lockdown spec stops timing out on a cold runner ([AGL-1627](https://linear.app/aglyn/issue/AGL-1627))
- **ci:** the emulator sweep runs the tenant spec it has been skipping ([AGL-1627](https://linear.app/aglyn/issue/AGL-1627), [AGL-2486](https://linear.app/aglyn/issue/AGL-2486))

### Changed

- **email:** the transactional email palette is named once ([AGL-2499](https://linear.app/aglyn/issue/AGL-2499), [AGL-2025](https://linear.app/aglyn/issue/AGL-2025))

### Documentation

- **cloud:** the functions env example names a file firebase will accept ([AGL-1617](https://linear.app/aglyn/issue/AGL-1617))

<details>
<summary>Also in this release: 1 test</summary>

- **pricing:** the published marketplace take rate gets a fixed point ([AGL-2194](https://linear.app/aglyn/issue/AGL-2194))

</details>

## v1.0.0-beta.13 — 2026-08-24

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/v1.0.0-beta.12...v1.0.0-beta.13)

### Added

- **besigner:** an instance can override one inner element's attributes ([AGL-1899](https://linear.app/aglyn/issue/AGL-1899), [AGL-1332](https://linear.app/aglyn/issue/AGL-1332), [AGL-1304](https://linear.app/aglyn/issue/AGL-1304), [AGL-584](https://linear.app/aglyn/issue/AGL-584))
- **tools,docs:** a price cannot move without a recorded decision ([AGL-1908](https://linear.app/aglyn/issue/AGL-1908))
- **guards:** the residential address gets the guard it never had ([AGL-1491](https://linear.app/aglyn/issue/AGL-1491), [AGL-1963](https://linear.app/aglyn/issue/AGL-1963), [AGL-2021](https://linear.app/aglyn/issue/AGL-2021))
- **tools:** the launch runbook cannot name a script that is not there ([AGL-1533](https://linear.app/aglyn/issue/AGL-1533))
- **security:** staff can end one stolen device's sessions without taking the account ([AGL-1513](https://linear.app/aglyn/issue/AGL-1513), [AGL-1959](https://linear.app/aglyn/issue/AGL-1959), [AGL-1881](https://linear.app/aglyn/issue/AGL-1881), [AGL-2005](https://linear.app/aglyn/issue/AGL-2005), [AGL-2190](https://linear.app/aglyn/issue/AGL-2190))
- **billing:** the live dunning schedule is recorded, and something finally watches it ([AGL-2430](https://linear.app/aglyn/issue/AGL-2430))
- **analytics:** the campaign survives the hop to the console ([AGL-1731](https://linear.app/aglyn/issue/AGL-1731), [AGL-1562](https://linear.app/aglyn/issue/AGL-1562))
- **monitoring:** the server-error rate gets a reader that can go red ([AGL-1921](https://linear.app/aglyn/issue/AGL-1921))
- **plugins-mui,aglyn,tenant:** a collection search box the toolbar row can hold ([AGL-1516](https://linear.app/aglyn/issue/AGL-1516))

### Fixed

- **analytics:** the transport spec compiles against the widened return type ([AGL-1580](https://linear.app/aglyn/issue/AGL-1580))
- **content:** an unresolvable org withholds a schedule, it does not burn it ([AGL-471](https://linear.app/aglyn/issue/AGL-471), [AGL-247](https://linear.app/aglyn/issue/AGL-247))
- **content:** entry scheduling is gated on the plan that sells it ([AGL-471](https://linear.app/aglyn/issue/AGL-471), [AGL-1185](https://linear.app/aglyn/issue/AGL-1185), [AGL-1380](https://linear.app/aglyn/issue/AGL-1380))
- **health:** every health body labels its environment the same way ([AGL-2014](https://linear.app/aglyn/issue/AGL-2014), [AGL-2436](https://linear.app/aglyn/issue/AGL-2436), [AGL-1923](https://linear.app/aglyn/issue/AGL-1923))
- **analytics:** begin_checkout waits for gtag instead of racing the redirect ([AGL-1580](https://linear.app/aglyn/issue/AGL-1580))
- **ci:** console:test names its five real failures instead of dying mute ([AGL-1617](https://linear.app/aglyn/issue/AGL-1617), [AGL-975](https://linear.app/aglyn/issue/AGL-975))
- **selfhost:** two ops guards are allowlisted, and a red now prints its row ([AGL-1533](https://linear.app/aglyn/issue/AGL-1533), [AGL-1908](https://linear.app/aglyn/issue/AGL-1908), [AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **seo:** a host and screen listing publish the card alt they were given ([AGL-2398](https://linear.app/aglyn/issue/AGL-2398), [AGL-2417](https://linear.app/aglyn/issue/AGL-2417), [AGL-2204](https://linear.app/aglyn/issue/AGL-2204))
- **seo:** a host and screen listing publish the card alt they were given ([AGL-2398](https://linear.app/aglyn/issue/AGL-2398), [AGL-2417](https://linear.app/aglyn/issue/AGL-2417), [AGL-2204](https://linear.app/aglyn/issue/AGL-2204))
- **besigner:** the canvas expands a component nested inside a component ([AGL-1898](https://linear.app/aglyn/issue/AGL-1898), [AGL-1899](https://linear.app/aglyn/issue/AGL-1899), [AGL-1301](https://linear.app/aglyn/issue/AGL-1301))
- **crons:** the two frequent sweeps move to the punctual runner ([AGL-1617](https://linear.app/aglyn/issue/AGL-1617), [AGL-2010](https://linear.app/aglyn/issue/AGL-2010), [AGL-2176](https://linear.app/aglyn/issue/AGL-2176), [AGL-786](https://linear.app/aglyn/issue/AGL-786), [AGL-1955](https://linear.app/aglyn/issue/AGL-1955))
- **redirects:** only a publisher may route a live site off-platform ([AGL-1881](https://linear.app/aglyn/issue/AGL-1881), [AGL-2334](https://linear.app/aglyn/issue/AGL-2334), [AGL-2372](https://linear.app/aglyn/issue/AGL-2372))
- **guards:** the facilitator charge shape is an exit code, not a comment ([AGL-1956](https://linear.app/aglyn/issue/AGL-1956))
- **console:** the screen version view takes the card spans, and Raw JSON collapses ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **console:** the page activity card asks for the newest entries, not a random 200 ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486), [AGL-2292](https://linear.app/aglyn/issue/AGL-2292))
- **docs:** a bare {date} placeholder is MDX, and it broke the whole docs build ([AGL-2498](https://linear.app/aglyn/issue/AGL-2498))
- **guards:** a ratchet's own output names the row that clears it ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **guards:** the brand ratchet sees the two new subprocessor rows ([AGL-2402](https://linear.app/aglyn/issue/AGL-2402))
- **selfhost:** the contact-address guard's own literals are allowlisted ([AGL-2400](https://linear.app/aglyn/issue/AGL-2400), [AGL-2124](https://linear.app/aglyn/issue/AGL-2124))
- **selfhost:** the campaign hop's console origin is an allowlisted reader ([AGL-1731](https://linear.app/aglyn/issue/AGL-1731))
- **console:** the DAM dialog fills the screen, and its tiles reflow ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **tenant:** restore the AGL-2204 manifest work my previous commit reverted ([AGL-2204](https://linear.app/aglyn/issue/AGL-2204), [AGL-1881](https://linear.app/aglyn/issue/AGL-1881))
- **security:** a revoked device's open tab can still write, and we said it could not ([AGL-1881](https://linear.app/aglyn/issue/AGL-1881), [AGL-1513](https://linear.app/aglyn/issue/AGL-1513))
- **tenant:** the PWA manifest stops declaring a size it never measured ([AGL-2204](https://linear.app/aglyn/issue/AGL-2204), [AGL-1252](https://linear.app/aglyn/issue/AGL-1252))
- **consent:** advertising needs an explicit yes again, as the policy says ([AGL-1649](https://linear.app/aglyn/issue/AGL-1649), [AGL-2402](https://linear.app/aglyn/issue/AGL-2402))
- **console:** the staff sign-out dialog admits the revoked tab can still write ([AGL-1513](https://linear.app/aglyn/issue/AGL-1513))
- **plugins-mui:** the collection picker icons take their accent from the theme ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486), [AGL-1516](https://linear.app/aglyn/issue/AGL-1516))
- **console:** the screen version view cards span 2 and 1 of three columns ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **privacy:** the breach report's billing country is the newest one, not the last row ([AGL-2008](https://linear.app/aglyn/issue/AGL-2008))
- **privacy:** the breach report counted one account holder in three ([AGL-2008](https://linear.app/aglyn/issue/AGL-2008))
- **auth:** the handoff redemption honours the revocation epoch too ([AGL-1902](https://linear.app/aglyn/issue/AGL-1902))
- **privacy:** the copy-drift spec names the tag module as data, and says so ([AGL-1649](https://linear.app/aglyn/issue/AGL-1649))
- **auth:** an unverifiable admin token is refused with 401, not reported as 500 ([AGL-1993](https://linear.app/aglyn/issue/AGL-1993), [AGL-1921](https://linear.app/aglyn/issue/AGL-1921))
- **sso:** the one owner seat cannot be moved into the pool it protects ([AGL-1888](https://linear.app/aglyn/issue/AGL-1888), [AGL-1375](https://linear.app/aglyn/issue/AGL-1375), [AGL-1122](https://linear.app/aglyn/issue/AGL-1122))
- **privacy:** the two App Check control-plane hosts are declared, not published ([AGL-2402](https://linear.app/aglyn/issue/AGL-2402), [AGL-1648](https://linear.app/aglyn/issue/AGL-1648))
- **besigner:** an attribute edit after an undo stops vanishing ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **auth:** a project-pool sign-in stops inheriting an abandoned SSO attempt's tenant ([AGL-1993](https://linear.app/aglyn/issue/AGL-1993), [AGL-2486](https://linear.app/aglyn/issue/AGL-2486), [AGL-1962](https://linear.app/aglyn/issue/AGL-1962))
- **consent:** the advertising switch stops describing a rule it no longer follows ([AGL-1649](https://linear.app/aglyn/issue/AGL-1649), [AGL-2402](https://linear.app/aglyn/issue/AGL-2402))
- **presence:** a write of our own no longer re-renders the whole besigner ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **ops:** splitting the Stripe record is not the same as fixing its mode ([AGL-2401](https://linear.app/aglyn/issue/AGL-2401))
- **security:** a revoked App Check debug token can now be proven revoked ([AGL-2402](https://linear.app/aglyn/issue/AGL-2402))
- **legal:** a re-acceptance banner thanks you for the acceptance it already holds ([AGL-2316](https://linear.app/aglyn/issue/AGL-2316))
- **console:** a warm cache the server agrees with stops refusing every save ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **console:** a warm cache that the server agrees with stops refusing every save ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **console:** a photo used only on a product stops reporting as unused ([AGL-1867](https://linear.app/aglyn/issue/AGL-1867))
- **console:** search finds the page it could not find, and names a partial read ([AGL-2179](https://linear.app/aglyn/issue/AGL-2179), [AGL-1414](https://linear.app/aglyn/issue/AGL-1414))
- **tenant:** a read-only lock stops the beacon firing host automations ([AGL-1627](https://linear.app/aglyn/issue/AGL-1627), [AGL-2413](https://linear.app/aglyn/issue/AGL-2413), [AGL-2155](https://linear.app/aglyn/issue/AGL-2155), [AGL-2495](https://linear.app/aglyn/issue/AGL-2495))
- **console:** the screen version view packs its cards instead of stretching them ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **api,console:** two concurrent site creates can no longer claim one subdomain ([AGL-2465](https://linear.app/aglyn/issue/AGL-2465), [AGL-1848](https://linear.app/aglyn/issue/AGL-1848), [AGL-2063](https://linear.app/aglyn/issue/AGL-2063))
- **privacy:** a person in several orgs stops being filed in a coin-flipped one ([AGL-2008](https://linear.app/aglyn/issue/AGL-2008), [AGL-2336](https://linear.app/aglyn/issue/AGL-2336))
- **console,analytics:** the campaign survives the consent bounce, and the gap is named ([AGL-1731](https://linear.app/aglyn/issue/AGL-1731))
- **billing:** the staff margin figure says what it excludes ([AGL-1930](https://linear.app/aglyn/issue/AGL-1930))
- **selfhost,commerce:** a blank MEMBER_SESSION_SECRET signed cookies with an empty key ([AGL-2014](https://linear.app/aglyn/issue/AGL-2014), [AGL-2221](https://linear.app/aglyn/issue/AGL-2221))
- **rules:** an author refused by member-post.ts cannot addDoc the post either ([AGL-2372](https://linear.app/aglyn/issue/AGL-2372), [AGL-2334](https://linear.app/aglyn/issue/AGL-2334))

### Performance

- **presence:** the cursor hit test is throttled, not just the cursor write ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))

### Reverted

- restore the screen-version card grid a second time ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486), [AGL-1513](https://linear.app/aglyn/issue/AGL-1513))
- restore the screen-version card grid my last commit reverted ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **privacy:** restore the copy-drift spec's data-mention exemption ([AGL-1649](https://linear.app/aglyn/issue/AGL-1649), [AGL-1902](https://linear.app/aglyn/issue/AGL-1902))

### Documentation

- **email:** the DMARC section stops claiming p=quarantine ([AGL-1876](https://linear.app/aglyn/issue/AGL-1876))
- **analytics:** the RUM section stops claiming we have no RUM ([AGL-1856](https://linear.app/aglyn/issue/AGL-1856), [AGL-1642](https://linear.app/aglyn/issue/AGL-1642))
- **trust:** a publisher can install their OWN unreviewed build ([AGL-1736](https://linear.app/aglyn/issue/AGL-1736), [AGL-1083](https://linear.app/aglyn/issue/AGL-1083))
- **trust:** a plugin publisher, not only a site owner, can name the host ([AGL-1736](https://linear.app/aglyn/issue/AGL-1736))
- **marketing:** record the ratified AGL-1244 decisions, and what still blocks two ([AGL-1244](https://linear.app/aglyn/issue/AGL-1244))
- **analytics:** the registration half is finished, the filter is ACTIVE ([AGL-1637](https://linear.app/aglyn/issue/AGL-1637))
- **release:** the last two automatable screenshots, and a guard that sees a blank one ([AGL-1950](https://linear.app/aglyn/issue/AGL-1950))
- **analytics:** the internal-traffic stamp lands AFTER the boot burst, measured ([AGL-1582](https://linear.app/aglyn/issue/AGL-1582), [AGL-2067](https://linear.app/aglyn/issue/AGL-2067))
- **legal:** support@ lost its DPA clause the same week it gained one ([AGL-2400](https://linear.app/aglyn/issue/AGL-2400), [AGL-1648](https://linear.app/aglyn/issue/AGL-1648))
- **release:** backfill the beta.11 and beta.12 changelog entries ([AGL-1617](https://linear.app/aglyn/issue/AGL-1617))
- **selfhost:** two self-host claims that the code does not support ([AGL-2014](https://linear.app/aglyn/issue/AGL-2014), [AGL-2423](https://linear.app/aglyn/issue/AGL-2423), [AGL-1660](https://linear.app/aglyn/issue/AGL-1660))

<details>
<summary>Also in this release: 16 test, 1 ci, 1 style</summary>

- **selfhost:** the hardcoded-host ratchet admits a sentence about aglyn.com ([AGL-1577](https://linear.app/aglyn/issue/AGL-1577))
- **content:** the entry-scheduling specs admit the gate they now run into ([AGL-471](https://linear.app/aglyn/issue/AGL-471), [AGL-2498](https://linear.app/aglyn/issue/AGL-2498), [AGL-123](https://linear.app/aglyn/issue/AGL-123))
- **billing:** three revenue fixtures stop publishing a real home address ([AGL-1491](https://linear.app/aglyn/issue/AGL-1491), [AGL-1963](https://linear.app/aglyn/issue/AGL-1963))
- **content:** the entry publish gate is proven from both sides of its instant ([AGL-2498](https://linear.app/aglyn/issue/AGL-2498), [AGL-2497](https://linear.app/aglyn/issue/AGL-2497), [AGL-1250](https://linear.app/aglyn/issue/AGL-1250))
- **security:** the revoked-residual guard could not see the surface it had just gained ([AGL-1881](https://linear.app/aglyn/issue/AGL-1881))
- **legal:** a published contact address must be one that exists ([AGL-2400](https://linear.app/aglyn/issue/AGL-2400), [AGL-1577](https://linear.app/aglyn/issue/AGL-1577))
- **besigner:** one attribute edit is one commit, and stays one ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
- **tenant:** the image-sink inventory is derived from the source, not remembered ([AGL-1725](https://linear.app/aglyn/issue/AGL-1725))
- **sso:** the publish gate's attested branch is proven against Firestore ([AGL-1887](https://linear.app/aglyn/issue/AGL-1887))
- **besigner:** a co-editor undo is proven to move in BOTH directions ([AGL-1958](https://linear.app/aglyn/issue/AGL-1958))
- **analytics:** two campaign guards that were never executed ([AGL-1731](https://linear.app/aglyn/issue/AGL-1731))
- **auth:** the address-prefill fixtures stop publishing a real home address ([AGL-1963](https://linear.app/aglyn/issue/AGL-1963), [AGL-1491](https://linear.app/aglyn/issue/AGL-1491))
- **besigner:** drop the unrelated reformatting from d17dc873f ([AGL-1617](https://linear.app/aglyn/issue/AGL-1617))
- **besigner:** the pre-frame assertion stops racing the seeding frame ([AGL-1617](https://linear.app/aglyn/issue/AGL-1617))
- **nx:** the test log is redirected, not piped, so a failed task's output survives ([AGL-1617](https://linear.app/aglyn/issue/AGL-1617))
- **analytics:** an undefined campaign param can no longer pass as no param ([AGL-1731](https://linear.app/aglyn/issue/AGL-1731))
- **analytics:** the GA4 hit is proven ADDRESSED, not merely well-shaped ([AGL-2327](https://linear.app/aglyn/issue/AGL-2327))
- **rules:** the screen kind AGL-1400 added is proven denied to the client ([AGL-1400](https://linear.app/aglyn/issue/AGL-1400), [AGL-1383](https://linear.app/aglyn/issue/AGL-1383), [AGL-2092](https://linear.app/aglyn/issue/AGL-2092))

</details>

## v1.0.0-beta.12 — 2026-08-24

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/v1.0.0-beta.11...v1.0.0-beta.12)

### Fixed

- **commerce:** a product image on a white-label storefront stops naming aglyn.app ([AGL-1726](https://linear.app/aglyn/issue/AGL-1726))
- **domains:** a platform-reserved name cannot be claimed as a site domain ([AGL-1430](https://linear.app/aglyn/issue/AGL-1430))
- **billing,console:** a delivery that only landed on a RETRY stops being invisible ([AGL-1948](https://linear.app/aglyn/issue/AGL-1948))
- **selfhost,ops:** the upload-CORS allowlist is derived, audited and reclaimed ([AGL-1452](https://linear.app/aglyn/issue/AGL-1452))
- **commerce:** a site collaborator is no longer an admin at the refund gate ([AGL-2372](https://linear.app/aglyn/issue/AGL-2372))
- **commerce:** a reconstructed subscription states its tax regime ([AGL-2323](https://linear.app/aglyn/issue/AGL-2323))

### Documentation

- **trust:** the Google Ads row argued from a policy premise that is now false ([AGL-1736](https://linear.app/aglyn/issue/AGL-1736))
- **trust:** author-chosen image and CSS hosts are disclosed, and not proxied ([AGL-1736](https://linear.app/aglyn/issue/AGL-1736))
- **security:** the tenant img-src reports came back, and they refuse the flip ([AGL-1726](https://linear.app/aglyn/issue/AGL-1726))

<details>
<summary>Also in this release: 1 chore, 1 ci, 2 test</summary>

- **release:** package.json catches up to the tags, at beta.12 ([AGL-1617](https://linear.app/aglyn/issue/AGL-1617))
- **ops:** the upload-CORS allowlist gets a scheduled drift check ([AGL-1452](https://linear.app/aglyn/issue/AGL-1452))
- **aglyn:** health-report fixtures carry the required retried field ([AGL-1948](https://linear.app/aglyn/issue/AGL-1948))
- **commerce:** the register allowlist is proven to refuse an author ([AGL-2372](https://linear.app/aglyn/issue/AGL-2372))

</details>

## v1.0.0-beta.11 — 2026-08-24

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/v1.0.0-beta.10...v1.0.0-beta.11)

### Added

- **console:** the entry editor carries the publication controls ([AGL-2498](https://linear.app/aglyn/issue/AGL-2498))
- **console:** a content entry publish date is settable, and can be backdated ([AGL-2497](https://linear.app/aglyn/issue/AGL-2497))
- **docs:** status.aglyn.com lands on the status page, not the docs home ([AGL-2496](https://linear.app/aglyn/issue/AGL-2496))
- **legal:** Aglyn is the marketplace facilitator, and the Terms now say so ([AGL-1956](https://linear.app/aglyn/issue/AGL-1956))
- **legal:** a third-party host cannot receive data undeclared ([AGL-1648](https://linear.app/aglyn/issue/AGL-1648))

### Fixed

- **ops:** an unreadable backup listing is "unknown", not "backup failed" ([AGL-1843](https://linear.app/aglyn/issue/AGL-1843))
- **docs:** the status page shows billing and scheduled jobs, and its own copy says so ([AGL-2496](https://linear.app/aglyn/issue/AGL-2496))
- **commerce:** the merchant-facing tax copy stops contradicting the Terms ([AGL-1956](https://linear.app/aglyn/issue/AGL-1956))
- **docs:** the status page monitored nothing, and had nowhere to send you ([AGL-2496](https://linear.app/aglyn/issue/AGL-2496))
- **rules:** a revoked billing.view stops Firestore delivering the subscription doc ([AGL-243](https://linear.app/aglyn/issue/AGL-243))
- **console:** a failed permission read denies instead of answering "owner" ([AGL-243](https://linear.app/aglyn/issue/AGL-243))
- **console:** a permission gate holds instead of painting the ledger it is about to refuse ([AGL-243](https://linear.app/aglyn/issue/AGL-243))

<details>
<summary>Also in this release: 1 test</summary>

- **guards:** a disclosure registry may name what it discloses ([AGL-1648](https://linear.app/aglyn/issue/AGL-1648))

</details>

## v1.0.0-beta.10 — 2026-08-24

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/v1.0.0-beta.9...v1.0.0-beta.10)

### Added

- **billing:** one static URL Stripe can mail lands a customer on their own billing page ([AGL-2430](https://linear.app/aglyn/issue/AGL-2430))
- **tools:** an issue states the external fact that finishes it, re-read daily ([AGL-2193](https://linear.app/aglyn/issue/AGL-2193), [AGL-2396](https://linear.app/aglyn/issue/AGL-2396), [AGL-2379](https://linear.app/aglyn/issue/AGL-2379))

### Fixed

- **commerce:** a failed tax reversal can be retried, because Stripe caches the refusal ([AGL-1956](https://linear.app/aglyn/issue/AGL-1956))
- **commerce:** a subscription cycle stops handing Aglyn's sales tax to the merchant ([AGL-1956](https://linear.app/aglyn/issue/AGL-1956), [AGL-2317](https://linear.app/aglyn/issue/AGL-2317))

<details>
<summary>Also in this release: 1 test</summary>

- **billing:** the renewal path is rehearsable on a test clock ([AGL-1877](https://linear.app/aglyn/issue/AGL-1877), [AGL-1878](https://linear.app/aglyn/issue/AGL-1878), [AGL-2401](https://linear.app/aglyn/issue/AGL-2401))

</details>

## v1.0.0-beta.9 — 2026-08-24

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/12c1d7ddf...v1.0.0-beta.9)

### Added

- **billing:** a visitor-record ceiling refuses, and the site's owner is told ([AGL-1529](https://linear.app/aglyn/issue/AGL-1529), [AGL-2265](https://linear.app/aglyn/issue/AGL-2265), [AGL-2266](https://linear.app/aglyn/issue/AGL-2266), [AGL-1655](https://linear.app/aglyn/issue/AGL-1655), [AGL-2155](https://linear.app/aglyn/issue/AGL-2155), [AGL-889](https://linear.app/aglyn/issue/AGL-889), [AGL-2231](https://linear.app/aglyn/issue/AGL-2231), [AGL-1666](https://linear.app/aglyn/issue/AGL-1666), [AGL-2303](https://linear.app/aglyn/issue/AGL-2303))
- **white-label:** a custom console domain allowlists itself for App Check ([AGL-1378](https://linear.app/aglyn/issue/AGL-1378))

### Fixed

- **tax:** the staff return can finally answer the nexus question ([AGL-1956](https://linear.app/aglyn/issue/AGL-1956), [AGL-1904](https://linear.app/aglyn/issue/AGL-1904), [AGL-1811](https://linear.app/aglyn/issue/AGL-1811))
- **commerce:** the sales tax stays with the platform that owes it ([AGL-1956](https://linear.app/aglyn/issue/AGL-1956), [AGL-1904](https://linear.app/aglyn/issue/AGL-1904), [AGL-1811](https://linear.app/aglyn/issue/AGL-1811), [AGL-1544](https://linear.app/aglyn/issue/AGL-1544))
- **tools:** the two seeders stop fighting over one teammate email ([AGL-1617](https://linear.app/aglyn/issue/AGL-1617))
- **billing:** a no-op add-on quantity change stops billing a $0 proration pair ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486), [AGL-535](https://linear.app/aglyn/issue/AGL-535))
- **billing:** a test-mode console says so instead of "no invoices yet" ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486), [AGL-1137](https://linear.app/aglyn/issue/AGL-1137))

### Documentation

- **selfhost:** a screenshot note stops reading as a Docker-image claim ([AGL-2434](https://linear.app/aglyn/issue/AGL-2434))
- **tax:** the nexus table reaches the working papers and the docs ([AGL-1956](https://linear.app/aglyn/issue/AGL-1956), [AGL-2021](https://linear.app/aglyn/issue/AGL-2021))
- **legal:** an undisclosed subprocessor is published, the 30-day notice deleted ([AGL-1648](https://linear.app/aglyn/issue/AGL-1648))
- **analytics:** the docs GA env var was never set, and this file said it was ([AGL-1597](https://linear.app/aglyn/issue/AGL-1597))
- **staff-console:** the lockdown page says where a lock does not reach on the tenant API ([AGL-2495](https://linear.app/aglyn/issue/AGL-2495), [AGL-1621](https://linear.app/aglyn/issue/AGL-1621))
- **legal:** the subprocessor notice has a 30-day clock and nothing to run it ([AGL-1648](https://linear.app/aglyn/issue/AGL-1648))

<details>
<summary>Also in this release: 2 test, 2 ci</summary>

- **tools:** the first customer's whole path is one harness, red beside every green ([AGL-1514](https://linear.app/aglyn/issue/AGL-1514))
- **nx:** bound the jest fleet, and the digest now shows its working ([AGL-1617](https://linear.app/aglyn/issue/AGL-1617))
- **billing:** every free cap is driven to a refusal, and proven to be that cap ([AGL-1529](https://linear.app/aglyn/issue/AGL-1529), [AGL-2163](https://linear.app/aglyn/issue/AGL-2163))
- **gate:** a truncated test log now leaves a digest and an artifact ([AGL-1617](https://linear.app/aglyn/issue/AGL-1617))

</details>

## v1.0.0-beta.6 — 2026-08-20

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/f2bac3cd1...v1.0.0-beta.6)

### Fixed

- **commerce:** the tax card's brand import stops disabling its own use client ([AGL-2153](https://linear.app/aglyn/issue/AGL-2153))
- **commerce:** put 'use client' back above the import that displaced it ([AGL-2476](https://linear.app/aglyn/issue/AGL-2476), [AGL-2153](https://linear.app/aglyn/issue/AGL-2153))

<details>
<summary>Also in this release: 3 chore, 2 ci</summary>

- **deps-dev:** bump the linters group, eslint 9 -> 10 ([AGL-2478](https://linear.app/aglyn/issue/AGL-2478))
- **deps:** group typescript-eslint with its own scoped siblings ([AGL-2478](https://linear.app/aglyn/issue/AGL-2478))
- **deps-dev:** bump eight dev tools from the dev-minor-patch group ([AGL-2478](https://linear.app/aglyn/issue/AGL-2478))
- **deps-dev:** bump eslint to 10.8.1 in /cloud/functions ([AGL-2459](https://linear.app/aglyn/issue/AGL-2459))
- **deps:** guard the docs TypeScript major and keep react/react-dom paired ([AGL-2477](https://linear.app/aglyn/issue/AGL-2477), [AGL-2363](https://linear.app/aglyn/issue/AGL-2363))

</details>

## v1.0.0-beta.5 — 2026-08-20

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/v1.0.0-beta.4...v1.0.0-beta.5)

### Added

- **console,docs:** a /v1 list can be searched, so a sync stops sweeping the whole collection ([AGL-2460](https://linear.app/aglyn/issue/AGL-2460), [AGL-76](https://linear.app/aglyn/issue/AGL-76), [AGL-2414](https://linear.app/aglyn/issue/AGL-2414))
- **assist:** the monthly spend ceiling ships ARMED at $40 ([AGL-2264](https://linear.app/aglyn/issue/AGL-2264), [AGL-2441](https://linear.app/aglyn/issue/AGL-2441))
- **console,commerce:** a merchant can see the sales tax their own storefront collected ([AGL-2440](https://linear.app/aglyn/issue/AGL-2440), [AGL-1904](https://linear.app/aglyn/issue/AGL-1904))
- **tools:** derive the shipped-but-still-open queue by STATE, not by label ([AGL-2036](https://linear.app/aglyn/issue/AGL-2036), [AGL-2379](https://linear.app/aglyn/issue/AGL-2379))
- **aglyn,console:** the collaborator seat add-on is a POOL, allocated per site ([AGL-2439](https://linear.app/aglyn/issue/AGL-2439), [AGL-1775](https://linear.app/aglyn/issue/AGL-1775), [AGL-1947](https://linear.app/aglyn/issue/AGL-1947))
- **assist:** a monthly spend ceiling the reservation can refuse on ([AGL-2264](https://linear.app/aglyn/issue/AGL-2264), [AGL-2245](https://linear.app/aglyn/issue/AGL-2245))
- **console:** the console tells an author they cannot publish, instead of the database ([AGL-2334](https://linear.app/aglyn/issue/AGL-2334), [AGL-2365](https://linear.app/aglyn/issue/AGL-2365))
- **marketplace:** the abuse queue gets something that can feed it ([AGL-2435](https://linear.app/aglyn/issue/AGL-2435))
- **email:** the suppression list gets a reader ([AGL-2410](https://linear.app/aglyn/issue/AGL-2410), [AGL-1918](https://linear.app/aglyn/issue/AGL-1918), [AGL-2408](https://linear.app/aglyn/issue/AGL-2408), [AGL-1367](https://linear.app/aglyn/issue/AGL-1367), [AGL-950](https://linear.app/aglyn/issue/AGL-950))
- **seo:** a shared card says what it shows ([AGL-2417](https://linear.app/aglyn/issue/AGL-2417), [AGL-1896](https://linear.app/aglyn/issue/AGL-1896))
- **console:** the campaign send cap gets an odometer, not just a ceiling ([AGL-2426](https://linear.app/aglyn/issue/AGL-2426), [AGL-2246](https://linear.app/aglyn/issue/AGL-2246), [AGL-1438](https://linear.app/aglyn/issue/AGL-1438))
- **email:** a bounce on transactional mail stops dropping on the floor ([AGL-2407](https://linear.app/aglyn/issue/AGL-2407), [AGL-1918](https://linear.app/aglyn/issue/AGL-1918), [AGL-268](https://linear.app/aglyn/issue/AGL-268), [AGL-1438](https://linear.app/aglyn/issue/AGL-1438))
- **tools:** a guard that asks whether ANY copy of production data is off-project ([AGL-1882](https://linear.app/aglyn/issue/AGL-1882), [AGL-1490](https://linear.app/aglyn/issue/AGL-1490), [AGL-2422](https://linear.app/aglyn/issue/AGL-2422))

### Fixed

- **ci:** the legal-drift comment stops tripping the retired-name sweep ([AGL-2475](https://linear.app/aglyn/issue/AGL-2475), [AGL-2467](https://linear.app/aglyn/issue/AGL-2467), [AGL-975](https://linear.app/aglyn/issue/AGL-975))
- **commerce:** a stock movement and its ledger row cannot diverge ([AGL-2161](https://linear.app/aglyn/issue/AGL-2161), [AGL-428](https://linear.app/aglyn/issue/AGL-428))
- **console:** the org-library ceiling closes while its meter is off ([AGL-2003](https://linear.app/aglyn/issue/AGL-2003), [AGL-1886](https://linear.app/aglyn/issue/AGL-1886))
- **brand:** the tax summary and branding helper read the configured brand ([AGL-2153](https://linear.app/aglyn/issue/AGL-2153), [AGL-2428](https://linear.app/aglyn/issue/AGL-2428))
- **tenant,console:** skip App Check registration when the site key is unset ([AGL-2049](https://linear.app/aglyn/issue/AGL-2049), [AGL-1404](https://linear.app/aglyn/issue/AGL-1404))
- **rules:** deny the six host subcollections nothing writes from a client ([AGL-2042](https://linear.app/aglyn/issue/AGL-2042), [AGL-2410](https://linear.app/aglyn/issue/AGL-2410), [AGL-1367](https://linear.app/aglyn/issue/AGL-1367))
- **commerce:** a signed-in member cannot double-subscribe on the storefront ([AGL-1849](https://linear.app/aglyn/issue/AGL-1849), [AGL-1697](https://linear.app/aglyn/issue/AGL-1697), [AGL-1715](https://linear.app/aglyn/issue/AGL-1715))
- **tools,console:** generate the metered pass-through table from the billed rates ([AGL-2194](https://linear.app/aglyn/issue/AGL-2194), [AGL-1280](https://linear.app/aglyn/issue/AGL-1280), [AGL-2469](https://linear.app/aglyn/issue/AGL-2469), [AGL-2155](https://linear.app/aglyn/issue/AGL-2155))
- **console:** the pricing-parity guard typechecks, not just runs ([AGL-2469](https://linear.app/aglyn/issue/AGL-2469))
- **commerce:** membership/recover stops being an unauthenticated mail relay ([AGL-1966](https://linear.app/aglyn/issue/AGL-1966), [AGL-889](https://linear.app/aglyn/issue/AGL-889), [AGL-1918](https://linear.app/aglyn/issue/AGL-1918), [AGL-2407](https://linear.app/aglyn/issue/AGL-2407), [AGL-2404](https://linear.app/aglyn/issue/AGL-2404))
- **docs:** give apps/docs the jest types its own tsconfig asks for ([AGL-2468](https://linear.app/aglyn/issue/AGL-2468), [AGL-2459](https://linear.app/aglyn/issue/AGL-2459), [AGL-2457](https://linear.app/aglyn/issue/AGL-2457))
- **tools:** the legal-drift comparator stops counting page furniture as drift ([AGL-2467](https://linear.app/aglyn/issue/AGL-2467), [AGL-1647](https://linear.app/aglyn/issue/AGL-1647))
- **build:** pin useTypeScriptCli off so the typescript alias resolves ([AGL-2466](https://linear.app/aglyn/issue/AGL-2466))
- **commerce:** a supplier ships only their own lines, and the token model allows it ([AGL-2455](https://linear.app/aglyn/issue/AGL-2455), [AGL-2268](https://linear.app/aglyn/issue/AGL-2268))
- **commerce:** a partial refund takes back exactly what it paid for ([AGL-2454](https://linear.app/aglyn/issue/AGL-2454))
- **commerce:** a promotion slot is held at checkout, so N shoppers cannot pass a cap of one ([AGL-2453](https://linear.app/aglyn/issue/AGL-2453), [AGL-2449](https://linear.app/aglyn/issue/AGL-2449), [AGL-305](https://linear.app/aglyn/issue/AGL-305))
- **repo:** restore the three commits AGL-2444 reverted by a moving parent ([AGL-2444](https://linear.app/aglyn/issue/AGL-2444), [AGL-2146](https://linear.app/aglyn/issue/AGL-2146), [AGL-2377](https://linear.app/aglyn/issue/AGL-2377), [AGL-2379](https://linear.app/aglyn/issue/AGL-2379))
- **console:** every advertised org permission is enforced server-side ([AGL-2444](https://linear.app/aglyn/issue/AGL-2444), [AGL-2350](https://linear.app/aglyn/issue/AGL-2350), [AGL-435](https://linear.app/aglyn/issue/AGL-435))
- **console:** a downgrade restates per-item tax_rates and phase-0 metadata ([AGL-2146](https://linear.app/aglyn/issue/AGL-2146), [AGL-2150](https://linear.app/aglyn/issue/AGL-2150))
- **console:** the usage sweep stops skipping every never-subscribed org ([AGL-2420](https://linear.app/aglyn/issue/AGL-2420), [AGL-2413](https://linear.app/aglyn/issue/AGL-2413))
- **branding:** a white-label org's blank Support URL links NOWHERE ([AGL-2428](https://linear.app/aglyn/issue/AGL-2428))
- **commerce:** a draft payment link reports the stock it cannot cover ([AGL-2452](https://linear.app/aglyn/issue/AGL-2452), [AGL-2357](https://linear.app/aglyn/issue/AGL-2357))
- **commerce:** a room is held in the transaction that checks it ([AGL-2450](https://linear.app/aglyn/issue/AGL-2450), [AGL-2320](https://linear.app/aglyn/issue/AGL-2320))
- **commerce:** a gift card is held at checkout, so two carts cannot spend it ([AGL-2449](https://linear.app/aglyn/issue/AGL-2449), [AGL-2320](https://linear.app/aglyn/issue/AGL-2320))
- **tools:** say which Firebase variable was refused instead of dumping a GaxiosError ([AGL-2447](https://linear.app/aglyn/issue/AGL-2447))
- **selfhost:** a container's frame-ancestors names only the operator's hosts ([AGL-2446](https://linear.app/aglyn/issue/AGL-2446), [AGL-2443](https://linear.app/aglyn/issue/AGL-2443), [AGL-2198](https://linear.app/aglyn/issue/AGL-2198), [AGL-2176](https://linear.app/aglyn/issue/AGL-2176))
- **permissions:** the SSO route reads the permission, not the raw role ([AGL-2350](https://linear.app/aglyn/issue/AGL-2350), [AGL-2297](https://linear.app/aglyn/issue/AGL-2297))
- **assist:** the history budget is shared across turns, not granted to each ([AGL-2441](https://linear.app/aglyn/issue/AGL-2441), [AGL-2264](https://linear.app/aglyn/issue/AGL-2264))
- **selfhost:** name the request-geo headers, and stop calling a container "development" ([AGL-2436](https://linear.app/aglyn/issue/AGL-2436), [AGL-2037](https://linear.app/aglyn/issue/AGL-2037), [AGL-2180](https://linear.app/aglyn/issue/AGL-2180))
- **docker:** copy the .npmrc that npm ci reads into the deps stage ([AGL-2423](https://linear.app/aglyn/issue/AGL-2423), [AGL-2221](https://linear.app/aglyn/issue/AGL-2221))
- **console:** a paid add-on the schedule will drop no longer reads as "updated" ([AGL-2438](https://linear.app/aglyn/issue/AGL-2438))
- **console:** a site collaborator cannot list the workspace's API keys ([AGL-2350](https://linear.app/aglyn/issue/AGL-2350), [AGL-1026](https://linear.app/aglyn/issue/AGL-1026))
- **console:** the revalidate gate reads HOST_PUBLISH_ROLES, not a private copy ([AGL-2350](https://linear.app/aglyn/issue/AGL-2350), [AGL-2334](https://linear.app/aglyn/issue/AGL-2334))
- **permissions:** site creation and org settings read the permission, not the raw role ([AGL-2350](https://linear.app/aglyn/issue/AGL-2350))
- **permissions:** the server honours custom roles and per-member overrides ([AGL-2350](https://linear.app/aglyn/issue/AGL-2350), [AGL-435](https://linear.app/aglyn/issue/AGL-435), [AGL-506](https://linear.app/aglyn/issue/AGL-506))
- **bookings:** the reminder emails the docs promise now actually send ([AGL-2431](https://linear.app/aglyn/issue/AGL-2431), [AGL-160](https://linear.app/aglyn/issue/AGL-160), [AGL-2227](https://linear.app/aglyn/issue/AGL-2227))
- **tools,ci:** the Texas tax code on our own products exists in the repo now ([AGL-1877](https://linear.app/aglyn/issue/AGL-1877))
- **console,aglyn,docs:** dunning ends in a CANCEL, and three things now notice ([AGL-1877](https://linear.app/aglyn/issue/AGL-1877))
- **console:** an org-scoped site list holds off instead of listing every client ([AGL-2350](https://linear.app/aglyn/issue/AGL-2350))
- **brand:** the error and offline screens name no operator, lowercase included ([AGL-2350](https://linear.app/aglyn/issue/AGL-2350))
- **console:** the other three usage-alerts doubles answer the paged host query ([AGL-2421](https://linear.app/aglyn/issue/AGL-2421))
- **console:** an org-scoped route resolves the ORG brand, not the deployment brand ([AGL-2350](https://linear.app/aglyn/issue/AGL-2350), [AGL-2278](https://linear.app/aglyn/issue/AGL-2278), [AGL-2354](https://linear.app/aglyn/issue/AGL-2354))
- **console:** the usage-alerts sweep pages an org's hosts ([AGL-2421](https://linear.app/aglyn/issue/AGL-2421), [AGL-2220](https://linear.app/aglyn/issue/AGL-2220))
- **email:** the unsubscribe link stops firing on a prescanner's GET ([AGL-2408](https://linear.app/aglyn/issue/AGL-2408))
- **tenant,aglyn,docs:** the free bandwidth cap engages at the beacon, not only in the cron ([AGL-2413](https://linear.app/aglyn/issue/AGL-2413))

### Documentation

- **commerce:** the reserve spec stops advertising a gap it closes ([AGL-1848](https://linear.app/aglyn/issue/AGL-1848), [AGL-2450](https://linear.app/aglyn/issue/AGL-2450))
- **guides:** an API key never spans organizations ([AGL-2445](https://linear.app/aglyn/issue/AGL-2445))
- **selfhost:** say plainly that no Docker images are published ([AGL-2434](https://linear.app/aglyn/issue/AGL-2434))
- **commerce:** the shipping refusal cites the issue it came from ([AGL-2232](https://linear.app/aglyn/issue/AGL-2232), [AGL-2230](https://linear.app/aglyn/issue/AGL-2230))
- **assist:** the Assist signal board gets the staff-console page it lacked ([AGL-2257](https://linear.app/aglyn/issue/AGL-2257))
- **selfhost:** the template and the runbooks describe the deployment an operator actually gets ([AGL-2424](https://linear.app/aglyn/issue/AGL-2424), [AGL-2425](https://linear.app/aglyn/issue/AGL-2425), [AGL-2436](https://linear.app/aglyn/issue/AGL-2436), [AGL-2437](https://linear.app/aglyn/issue/AGL-2437), [AGL-2177](https://linear.app/aglyn/issue/AGL-2177), [AGL-2221](https://linear.app/aglyn/issue/AGL-2221))

<details>
<summary>Also in this release: 7 test, 9 chore, 7 ci</summary>

- **deps:** hold @base-ui/react at the 1.6 line until jest has PointerEvent ([AGL-2470](https://linear.app/aglyn/issue/AGL-2470))
- **deps:** bump five production minor/patch deps ([AGL-2470](https://linear.app/aglyn/issue/AGL-2470), [AGL-2472](https://linear.app/aglyn/issue/AGL-2472))
- **console:** pin the published /pricing table to the constants that charge it ([AGL-2469](https://linear.app/aglyn/issue/AGL-2469), [AGL-2079](https://linear.app/aglyn/issue/AGL-2079))
- **tools:** baseline the unsubscribe page's two email-HTML colours ([AGL-2408](https://linear.app/aglyn/issue/AGL-2408))
- **deps:** bump @fontsource/roboto and roboto-mono in /apps/docs ([AGL-2459](https://linear.app/aglyn/issue/AGL-2459))
- **deps:** bump the docusaurus group in /apps/docs ([AGL-2459](https://linear.app/aglyn/issue/AGL-2459))
- **deps-dev:** bump @eslint/eslintrc from 2.1.4 to 3.3.6
- **deps:** bump firebase in the firebase group across 1 directory
- **deps:** bump the actions group across 1 directory with 5 updates
- **deps-dev:** bump the nx-workspace group across 1 directory with 16 updates
- **tools:** assert legal-drift.yml refuses to no-op without its Drive variable ([AGL-2379](https://linear.app/aglyn/issue/AGL-2379), [AGL-1778](https://linear.app/aglyn/issue/AGL-1778))
- **docs,functions:** the two projects no repo-wide command could reach get real targets ([AGL-2377](https://linear.app/aglyn/issue/AGL-2377), [AGL-2363](https://linear.app/aglyn/issue/AGL-2363), [AGL-2124](https://linear.app/aglyn/issue/AGL-2124))
- **deps:** bump the mui-emotion group across 1 directory with 9 updates
- **deps-dev:** bump typescript-eslint to 8.67.0 in /cloud/functions ([AGL-2058](https://linear.app/aglyn/issue/AGL-2058))
- **deps:** guard the functions manifest's typescript alias and admin major ([AGL-2458](https://linear.app/aglyn/issue/AGL-2458), [AGL-2457](https://linear.app/aglyn/issue/AGL-2457))
- **deps:** bump firebase-functions to 7.3.2 in /cloud/functions ([AGL-2457](https://linear.app/aglyn/issue/AGL-2457))
- **labeler:** migrate the label config to the schema v5+ requires ([AGL-2456](https://linear.app/aglyn/issue/AGL-2456))
- **selfhost:** drop the buildx action the repo's Actions policy forbids ([AGL-2433](https://linear.app/aglyn/issue/AGL-2433))
- **console:** the two stale-seed editor specs carry AGL-2334's host-role hook ([AGL-2334](https://linear.app/aglyn/issue/AGL-2334), [AGL-2365](https://linear.app/aglyn/issue/AGL-2365))
- **selfhost:** assert what the tenant ROUTED the request to, not only its status ([AGL-2433](https://linear.app/aglyn/issue/AGL-2433), [AGL-2443](https://linear.app/aglyn/issue/AGL-2443))
- **selfhost:** build both Docker images and serve one request through the tenant ([AGL-2433](https://linear.app/aglyn/issue/AGL-2433), [AGL-2423](https://linear.app/aglyn/issue/AGL-2423), [AGL-2177](https://linear.app/aglyn/issue/AGL-2177), [AGL-2221](https://linear.app/aglyn/issue/AGL-2221))
- **aglyn:** the branding guard names its pre-auth gap instead of omitting it ([AGL-2322](https://linear.app/aglyn/issue/AGL-2322), [AGL-2350](https://linear.app/aglyn/issue/AGL-2350))
- **console,aglyn:** the cap suite can see the merge flag, and the ceiling comment does its own arithmetic ([AGL-2413](https://linear.app/aglyn/issue/AGL-2413))

</details>

## v1.0.0-beta.4 — 2026-08-19

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/v1.0.0-beta.3...v1.0.0-beta.4)

### Added

- **media:** DAM alt text defaults into every placement ([AGL-1896](https://linear.app/aglyn/issue/AGL-1896), [AGL-173](https://linear.app/aglyn/issue/AGL-173), [AGL-1305](https://linear.app/aglyn/issue/AGL-1305))
- **console:** a new cookie cannot reach production undeclared ([AGL-1918](https://linear.app/aglyn/issue/AGL-1918))
- **besigner,console:** the eight declared help topics get the panels they name ([AGL-2167](https://linear.app/aglyn/issue/AGL-2167), [AGL-2130](https://linear.app/aglyn/issue/AGL-2130), [AGL-1074](https://linear.app/aglyn/issue/AGL-1074))
- **console,rules:** an author host role edits content and cannot publish ([AGL-2334](https://linear.app/aglyn/issue/AGL-2334), [AGL-2380](https://linear.app/aglyn/issue/AGL-2380), [AGL-2131](https://linear.app/aglyn/issue/AGL-2131))

### Fixed

- **limits:** a contended rate-limit key refuses instead of hanging ([AGL-2404](https://linear.app/aglyn/issue/AGL-2404), [AGL-794](https://linear.app/aglyn/issue/AGL-794), [AGL-2416](https://linear.app/aglyn/issue/AGL-2416))
- **selfhost:** the cookie inventory names its OWN surfaces, not Aglyn's ([AGL-2412](https://linear.app/aglyn/issue/AGL-2412), [AGL-1918](https://linear.app/aglyn/issue/AGL-1918), [AGL-2037](https://linear.app/aglyn/issue/AGL-2037))
- **console:** report-usage resolves the metered price through the helper ([AGL-2405](https://linear.app/aglyn/issue/AGL-2405), [AGL-1878](https://linear.app/aglyn/issue/AGL-1878), [AGL-1352](https://linear.app/aglyn/issue/AGL-1352), [AGL-1340](https://linear.app/aglyn/issue/AGL-1340), [AGL-1715](https://linear.app/aglyn/issue/AGL-1715))
- **marketing:** a bounce and a complaint suppress the address ([AGL-1918](https://linear.app/aglyn/issue/AGL-1918))
- **tenant:** the plugin dispatcher refuses cross-origin visitor writes ([AGL-1880](https://linear.app/aglyn/issue/AGL-1880))
- **docs,commerce:** three console cards get the docs section their tooltip promises ([AGL-1918](https://linear.app/aglyn/issue/AGL-1918), [AGL-2226](https://linear.app/aglyn/issue/AGL-2226), [AGL-2341](https://linear.app/aglyn/issue/AGL-2341), [AGL-2227](https://linear.app/aglyn/issue/AGL-2227))
- **tenant:** the plugin dispatcher refuses cross-origin visitor writes ([AGL-1880](https://linear.app/aglyn/issue/AGL-1880))
- **console:** a Stripe 200 on a meter event is not a charge ([AGL-1878](https://linear.app/aglyn/issue/AGL-1878))
- **security:** stop trusting aglyn-console.vercel.app, and pin the list ([AGL-1940](https://linear.app/aglyn/issue/AGL-1940), [AGL-1135](https://linear.app/aglyn/issue/AGL-1135), [AGL-1344](https://linear.app/aglyn/issue/AGL-1344), [AGL-1486](https://linear.app/aglyn/issue/AGL-1486))
- **console:** a GET on the audit archive reports instead of deleting ([AGL-2084](https://linear.app/aglyn/issue/AGL-2084), [AGL-2165](https://linear.app/aglyn/issue/AGL-2165))
- **console:** a GET on the audit archive reports instead of deleting ([AGL-2084](https://linear.app/aglyn/issue/AGL-2084), [AGL-2165](https://linear.app/aglyn/issue/AGL-2165))
- **plugins:** name the published-site email-capture fields ([AGL-2392](https://linear.app/aglyn/issue/AGL-2392), [AGL-1665](https://linear.app/aglyn/issue/AGL-1665))
- **tenant:** collection pages announce their RSS feed, and the feed names itself ([AGL-2391](https://linear.app/aglyn/issue/AGL-2391), [AGL-1385](https://linear.app/aglyn/issue/AGL-1385))
- **plugins:** name the published-site email-capture fields ([AGL-2392](https://linear.app/aglyn/issue/AGL-2392), [AGL-1665](https://linear.app/aglyn/issue/AGL-1665))
- **tenant:** collection pages announce their RSS feed, and the feed names itself ([AGL-2391](https://linear.app/aglyn/issue/AGL-2391), [AGL-1385](https://linear.app/aglyn/issue/AGL-1385))
- **besigner:** the Custom CSS form speaks the Styles panel's spelling ([AGL-2390](https://linear.app/aglyn/issue/AGL-2390), [AGL-2207](https://linear.app/aglyn/issue/AGL-2207), [AGL-2209](https://linear.app/aglyn/issue/AGL-2209), [AGL-2208](https://linear.app/aglyn/issue/AGL-2208), [AGL-2210](https://linear.app/aglyn/issue/AGL-2210))
- **besigner:** the Custom CSS form speaks the Styles panel's spelling ([AGL-2390](https://linear.app/aglyn/issue/AGL-2390), [AGL-2207](https://linear.app/aglyn/issue/AGL-2207), [AGL-2209](https://linear.app/aglyn/issue/AGL-2209), [AGL-2208](https://linear.app/aglyn/issue/AGL-2208), [AGL-2210](https://linear.app/aglyn/issue/AGL-2210))

### Documentation

- the rate-limiting runbook gains the contention posture ([AGL-2404](https://linear.app/aglyn/issue/AGL-2404))
- six beta.3 features that shipped with no documentation get some ([AGL-1918](https://linear.app/aglyn/issue/AGL-1918), [AGL-2249](https://linear.app/aglyn/issue/AGL-2249), [AGL-2328](https://linear.app/aglyn/issue/AGL-2328), [AGL-2343](https://linear.app/aglyn/issue/AGL-2343), [AGL-2318](https://linear.app/aglyn/issue/AGL-2318), [AGL-2335](https://linear.app/aglyn/issue/AGL-2335), [AGL-2316](https://linear.app/aglyn/issue/AGL-2316))
- **email:** the runbook points at a DNS zone that no longer exists ([AGL-1918](https://linear.app/aglyn/issue/AGL-1918), [AGL-1495](https://linear.app/aglyn/issue/AGL-1495), [AGL-1493](https://linear.app/aglyn/issue/AGL-1493), [AGL-2407](https://linear.app/aglyn/issue/AGL-2407), [AGL-2408](https://linear.app/aglyn/issue/AGL-2408), [AGL-2409](https://linear.app/aglyn/issue/AGL-2409))
- the six legal/ops intakes are verified to deliver, not unconfirmed ([AGL-1911](https://linear.app/aglyn/issue/AGL-1911), [AGL-1577](https://linear.app/aglyn/issue/AGL-1577), [AGL-1973](https://linear.app/aglyn/issue/AGL-1973), [AGL-1983](https://linear.app/aglyn/issue/AGL-1983), [AGL-2400](https://linear.app/aglyn/issue/AGL-2400))
- the six legal/ops intakes are verified to deliver, not unconfirmed ([AGL-1911](https://linear.app/aglyn/issue/AGL-1911), [AGL-1577](https://linear.app/aglyn/issue/AGL-1577), [AGL-1973](https://linear.app/aglyn/issue/AGL-1973), [AGL-1983](https://linear.app/aglyn/issue/AGL-1983), [AGL-2400](https://linear.app/aglyn/issue/AGL-2400))
- **handoff:** v1.0.0-beta.3 is promoted, deployed, tagged; rules+indexes live ([AGL-566](https://linear.app/aglyn/issue/AGL-566))
- **handoff:** v1.0.0-beta.3 is promoted, deployed, tagged; rules+indexes live ([AGL-566](https://linear.app/aglyn/issue/AGL-566))

<details>
<summary>Also in this release: 4 test, 2 ci</summary>

- **tenant:** the release-gate spec's mock stops hiding the cross-origin refusal ([AGL-2419](https://linear.app/aglyn/issue/AGL-2419), [AGL-1880](https://linear.app/aglyn/issue/AGL-1880), [AGL-2415](https://linear.app/aglyn/issue/AGL-2415))
- **tenant:** the visitor-write rate-limit spec stops faking a symbol away ([AGL-2415](https://linear.app/aglyn/issue/AGL-2415), [AGL-1880](https://linear.app/aglyn/issue/AGL-1880))
- **shared:** pin the merge semantics a caller gets wrong, not just the bump ([AGL-1866](https://linear.app/aglyn/issue/AGL-1866), [AGL-2301](https://linear.app/aglyn/issue/AGL-2301))
- **tools:** make the shared-ui-jsx barrel discipline an exit code ([AGL-1895](https://linear.app/aglyn/issue/AGL-1895), [AGL-1290](https://linear.app/aglyn/issue/AGL-1290))
- **deps:** add the dependabot version-update config the repo never had ([AGL-2058](https://linear.app/aglyn/issue/AGL-2058), [AGL-2051](https://linear.app/aglyn/issue/AGL-2051))
- **deps:** add the dependabot version-update config the repo never had ([AGL-2058](https://linear.app/aglyn/issue/AGL-2058), [AGL-2051](https://linear.app/aglyn/issue/AGL-2051))

</details>

## v1.0.0-beta.3 — 2026-08-19

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/v1.0.0-beta.2...v1.0.0-beta.3)

### Added

- **tools,ci:** the guards that ran nowhere get a home ([AGL-2376](https://linear.app/aglyn/issue/AGL-2376), [AGL-2377](https://linear.app/aglyn/issue/AGL-2377), [AGL-2379](https://linear.app/aglyn/issue/AGL-2379), [AGL-1822](https://linear.app/aglyn/issue/AGL-1822), [AGL-2116](https://linear.app/aglyn/issue/AGL-2116))
- **tools,ci:** check:legal-drift gets a home — scheduled, loud, and gating nothing ([AGL-2379](https://linear.app/aglyn/issue/AGL-2379), [AGL-2029](https://linear.app/aglyn/issue/AGL-2029))
- **tools:** the back book's two money gaps get an audit that can come back red ([AGL-2361](https://linear.app/aglyn/issue/AGL-2361), [AGL-2323](https://linear.app/aglyn/issue/AGL-2323))
- **commerce,docs:** the register warns about a shortfall and never refuses ([AGL-2357](https://linear.app/aglyn/issue/AGL-2357), [AGL-2317](https://linear.app/aglyn/issue/AGL-2317), [AGL-2372](https://linear.app/aglyn/issue/AGL-2372))
- **commerce,docs:** the register warns about a shortfall and never refuses ([AGL-2357](https://linear.app/aglyn/issue/AGL-2357), [AGL-2372](https://linear.app/aglyn/issue/AGL-2372))
- **console,tenant-data-admin:** the clickwrap record answers what it was written for ([AGL-2316](https://linear.app/aglyn/issue/AGL-2316), [AGL-1497](https://linear.app/aglyn/issue/AGL-1497))
- **marketplace:** a publisher can read why their own version was pulled ([AGL-2328](https://linear.app/aglyn/issue/AGL-2328), [AGL-1085](https://linear.app/aglyn/issue/AGL-1085))
- **console:** the tax working papers get the reader the export exists to be ([AGL-2329](https://linear.app/aglyn/issue/AGL-2329))
- **commerce:** a lost stock decrement stops being invisible ([AGL-2358](https://linear.app/aglyn/issue/AGL-2358), [AGL-2157](https://linear.app/aglyn/issue/AGL-2157))
- **console:** stranded idempotency claims and unmatched refunds get readers ([AGL-2329](https://linear.app/aglyn/issue/AGL-2329))
- **marketplace:** a publisher sees what a $1 listing costs to process ([AGL-2343](https://linear.app/aglyn/issue/AGL-2343), [AGL-1544](https://linear.app/aglyn/issue/AGL-1544))
- **console:** the moderation reasons staff are made to type are shown to someone ([AGL-2328](https://linear.app/aglyn/issue/AGL-2328), [AGL-1652](https://linear.app/aglyn/issue/AGL-1652))
- **console:** the audit window moves and the 365-day archive has a reader ([AGL-2324](https://linear.app/aglyn/issue/AGL-2324), [AGL-2287](https://linear.app/aglyn/issue/AGL-2287), [AGL-214](https://linear.app/aglyn/issue/AGL-214), [AGL-1993](https://linear.app/aglyn/issue/AGL-1993))
- **console:** the Assist cost split by tier and by model reaches a screen ([AGL-2340](https://linear.app/aglyn/issue/AGL-2340))
- **console:** a "new sign-in" email now has somewhere to send you ([AGL-2318](https://linear.app/aglyn/issue/AGL-2318))
- **console:** the Assist corpus gets a consumer ([AGL-2314](https://linear.app/aglyn/issue/AGL-2314), [AGL-2220](https://linear.app/aglyn/issue/AGL-2220))
- **console:** marketplace reports get a staff queue ([AGL-2310](https://linear.app/aglyn/issue/AGL-2310))
- **console:** the named success manager is a person, and is copied ([AGL-2332](https://linear.app/aglyn/issue/AGL-2332))
- **console:** the dataset export is the whole dataset, streamed ([AGL-2335](https://linear.app/aglyn/issue/AGL-2335))
- **commerce:** stock movements get a history view, and referrers reach the aggregate ([AGL-2341](https://linear.app/aglyn/issue/AGL-2341))
- **api:** an integration can read the meter it is billed on ([AGL-2277](https://linear.app/aglyn/issue/AGL-2277))
- **api:** contact writes over /v1, metered against the audience band ([AGL-2276](https://linear.app/aglyn/issue/AGL-2276), [AGL-899](https://linear.app/aglyn/issue/AGL-899), [AGL-1044](https://linear.app/aglyn/issue/AGL-1044), [AGL-890](https://linear.app/aglyn/issue/AGL-890), [AGL-2253](https://linear.app/aglyn/issue/AGL-2253))
- **console,assist:** the data loop finally gets a reader ([AGL-2252](https://linear.app/aglyn/issue/AGL-2252), [AGL-1972](https://linear.app/aglyn/issue/AGL-1972), [AGL-1860](https://linear.app/aglyn/issue/AGL-1860), [AGL-2220](https://linear.app/aglyn/issue/AGL-2220), [AGL-2257](https://linear.app/aglyn/issue/AGL-2257))
- **console,staff:** the churn survey stops being write-only ([AGL-2248](https://linear.app/aglyn/issue/AGL-2248), [AGL-1859](https://linear.app/aglyn/issue/AGL-1859))
- **commerce:** the Merchant Center feed URL is in the console, not in a comment ([AGL-2249](https://linear.app/aglyn/issue/AGL-2249), [AGL-299](https://linear.app/aglyn/issue/AGL-299))
- **console,billing:** the budget card says whether the budget has actually alerted ([AGL-2239](https://linear.app/aglyn/issue/AGL-2239), [AGL-2234](https://linear.app/aglyn/issue/AGL-2234))
- **tools,console:** the Assist key cannot reach the browser, and a guard that says so ([AGL-2240](https://linear.app/aglyn/issue/AGL-2240), [AGL-1909](https://linear.app/aglyn/issue/AGL-1909), [AGL-1349](https://linear.app/aglyn/issue/AGL-1349))
- **console,analytics:** a plan change from the grid stops being invisible ([AGL-2235](https://linear.app/aglyn/issue/AGL-2235), [AGL-1859](https://linear.app/aglyn/issue/AGL-1859))
- **commerce:** gift cards get a console — balances, liability, issue and void ([AGL-2226](https://linear.app/aglyn/issue/AGL-2226), [AGL-1767](https://linear.app/aglyn/issue/AGL-1767))
- **aglyn,plugins:** every plugin console card gets a help affordance ([AGL-2213](https://linear.app/aglyn/issue/AGL-2213), [AGL-1074](https://linear.app/aglyn/issue/AGL-1074), [AGL-2130](https://linear.app/aglyn/issue/AGL-2130))
- **console,docs:** customers can report an issue, and it lands in Linear ([AGL-2185](https://linear.app/aglyn/issue/AGL-2185), [AGL-2181](https://linear.app/aglyn/issue/AGL-2181))
- **tenant,console:** a free site past its band is refused, ahead of the cache ([AGL-2155](https://linear.app/aglyn/issue/AGL-2155), [AGL-2070](https://linear.app/aglyn/issue/AGL-2070), [AGL-1967](https://linear.app/aglyn/issue/AGL-1967))
- **aglyn,console,docs:** the free plan's bandwidth band becomes enforceable ([AGL-1967](https://linear.app/aglyn/issue/AGL-1967))
- **tenant,console:** dwell time, so `Avg. time on this screen` can exist ([AGL-2182](https://linear.app/aglyn/issue/AGL-2182))
- **marketing,email:** the composer counts recipients BEFORE the send ([AGL-2178](https://linear.app/aglyn/issue/AGL-2178), [AGL-1768](https://linear.app/aglyn/issue/AGL-1768))
- **tenant,aglyn:** the free tier gets its missing bandwidth brace ([AGL-2155](https://linear.app/aglyn/issue/AGL-2155), [AGL-1371](https://linear.app/aglyn/issue/AGL-1371))
- **besigner:** the inspector says what is selected ([AGL-2175](https://linear.app/aglyn/issue/AGL-2175))
- **marketing:** popups can cap once per session, which is what we sell ([AGL-2174](https://linear.app/aglyn/issue/AGL-2174))
- **console:** the DAM gives the asset back, tags as chips, and names its variants ([AGL-2143](https://linear.app/aglyn/issue/AGL-2143))
- **marketplace:** a free listing says Free, and the listing page says what you get ([AGL-2173](https://linear.app/aglyn/issue/AGL-2173))
- **tools,console,tenant:** a ratchet stops the next hardcoded "Aglyn" reaching user-visible copy ([AGL-2170](https://linear.app/aglyn/issue/AGL-2170), [AGL-2153](https://linear.app/aglyn/issue/AGL-2153), [AGL-2025](https://linear.app/aglyn/issue/AGL-2025), [AGL-2002](https://linear.app/aglyn/issue/AGL-2002), [AGL-1059](https://linear.app/aglyn/issue/AGL-1059))
- **workflows,runtime:** a run history that can say what happened ([AGL-2171](https://linear.app/aglyn/issue/AGL-2171))
- **inbox,tenant:** the Inbox shows people and says where a submission went ([AGL-2168](https://linear.app/aglyn/issue/AGL-2168))
- **aglyn,console,tenant,enums:** the platform brand is configuration, not a literal ([AGL-2153](https://linear.app/aglyn/issue/AGL-2153), [AGL-2016](https://linear.app/aglyn/issue/AGL-2016), [AGL-2037](https://linear.app/aglyn/issue/AGL-2037))
- **console:** the Sites list and dashboard header match the console mockup ([AGL-2166](https://linear.app/aglyn/issue/AGL-2166), [AGL-390](https://linear.app/aglyn/issue/AGL-390))
- **console:** the DAM asset detail matches its mockup — download, tag chips, CDN line ([AGL-2143](https://linear.app/aglyn/issue/AGL-2143), [AGL-1051](https://linear.app/aglyn/issue/AGL-1051))
- **console,api:** a form submission can be acted on, not only read ([AGL-2127](https://linear.app/aglyn/issue/AGL-2127), [AGL-899](https://linear.app/aglyn/issue/AGL-899))
- **commerce:** the Orders screen now looks like the one we advertise ([AGL-2136](https://linear.app/aglyn/issue/AGL-2136), [AGL-1938](https://linear.app/aglyn/issue/AGL-1938), [AGL-2056](https://linear.app/aglyn/issue/AGL-2056))
- **console,api:** /v1 can create the dataset it was only ever allowed to fill ([AGL-2126](https://linear.app/aglyn/issue/AGL-2126), [AGL-1478](https://linear.app/aglyn/issue/AGL-1478), [AGL-1044](https://linear.app/aglyn/issue/AGL-1044), [AGL-1691](https://linear.app/aglyn/issue/AGL-1691), [AGL-1710](https://linear.app/aglyn/issue/AGL-1710))

### Fixed

- **release:** the prepare guard tests the version, not the subject line ([AGL-2388](https://linear.app/aglyn/issue/AGL-2388), [AGL-2389](https://linear.app/aglyn/issue/AGL-2389))
- **console:** the clickwrap opt-out spec's relative import stops failing console:lint ([AGL-2387](https://linear.app/aglyn/issue/AGL-2387), [AGL-2316](https://linear.app/aglyn/issue/AGL-2316))
- **console:** the subprocessor gate stops failing on a workflow that names the key ([AGL-1909](https://linear.app/aglyn/issue/AGL-1909), [AGL-2379](https://linear.app/aglyn/issue/AGL-2379))
- **ci:** raise the NX CI bound to 60 minutes — 30 cancelled honest runs ([AGL-2378](https://linear.app/aglyn/issue/AGL-2378), [AGL-2374](https://linear.app/aglyn/issue/AGL-2374), [AGL-2381](https://linear.app/aglyn/issue/AGL-2381))
- **tools,aglyn:** the back book's billing statuses get the exemption the guard asks for ([AGL-2385](https://linear.app/aglyn/issue/AGL-2385), [AGL-2361](https://linear.app/aglyn/issue/AGL-2361), [AGL-2323](https://linear.app/aglyn/issue/AGL-2323), [AGL-1715](https://linear.app/aglyn/issue/AGL-1715))
- **ci:** heavy RTL specs stop losing the scheduler race on a 4-vCPU runner ([AGL-2382](https://linear.app/aglyn/issue/AGL-2382), [AGL-1762](https://linear.app/aglyn/issue/AGL-1762), [AGL-1257](https://linear.app/aglyn/issue/AGL-1257))
- **libs:** five `test` targets with no tests, and one dormant passWithNoTests ([AGL-2377](https://linear.app/aglyn/issue/AGL-2377))
- **console,marketplace:** three more create-time quota gates count inside the transaction ([AGL-2371](https://linear.app/aglyn/issue/AGL-2371), [AGL-2231](https://linear.app/aglyn/issue/AGL-2231), [AGL-2369](https://linear.app/aglyn/issue/AGL-2369), [AGL-2370](https://linear.app/aglyn/issue/AGL-2370))
- **cloud:** the five rules specs nothing has ever run join the runner ([AGL-2376](https://linear.app/aglyn/issue/AGL-2376))
- **tools:** the retired-colour sweep enumerates git, not the disk ([AGL-2375](https://linear.app/aglyn/issue/AGL-2375), [AGL-2116](https://linear.app/aglyn/issue/AGL-2116))
- **ci:** bound NX CI at 30 minutes so one stuck spec cannot starve main for six hours ([AGL-2378](https://linear.app/aglyn/issue/AGL-2378))
- **ci:** the drift and census workflows judge a push per commit too ([AGL-2378](https://linear.app/aglyn/issue/AGL-2378))
- **ci:** state NX CI's concurrency so main is per-commit and only PRs supersede ([AGL-2378](https://linear.app/aglyn/issue/AGL-2378))
- **ci:** emulator guards group by commit, so a push is never evicted while pending ([AGL-2378](https://linear.app/aglyn/issue/AGL-2378))
- **ci:** a push to main gets a commit-scoped concurrency group ([AGL-2378](https://linear.app/aglyn/issue/AGL-2378))
- **console:** regenerate the Assist docs index for the POS shortfall section ([AGL-2357](https://linear.app/aglyn/issue/AGL-2357), [AGL-1988](https://linear.app/aglyn/issue/AGL-1988), [AGL-2374](https://linear.app/aglyn/issue/AGL-2374))
- **tools:** the untaxed count separates forward exposure from dead history ([AGL-2323](https://linear.app/aglyn/issue/AGL-2323))
- **console:** the reversal-label spec's firestore mock is a stable singleton ([AGL-2374](https://linear.app/aglyn/issue/AGL-2374), [AGL-1810](https://linear.app/aglyn/issue/AGL-1810), [AGL-2105](https://linear.app/aglyn/issue/AGL-2105))
- **marketplace,aglyn,console:** a revoked build stops itself, not the listing ([AGL-2368](https://linear.app/aglyn/issue/AGL-2368), [AGL-2306](https://linear.app/aglyn/issue/AGL-2306), [AGL-1016](https://linear.app/aglyn/issue/AGL-1016), [AGL-1085](https://linear.app/aglyn/issue/AGL-1085))
- **commerce:** a subscription's platform fee is taken on items only ([AGL-2317](https://linear.app/aglyn/issue/AGL-2317), [AGL-2289](https://linear.app/aglyn/issue/AGL-2289))
- **console:** the screen cap holds at the promotion and error-slot ends too ([AGL-2369](https://linear.app/aglyn/issue/AGL-2369), [AGL-2231](https://linear.app/aglyn/issue/AGL-2231), [AGL-1390](https://linear.app/aglyn/issue/AGL-1390))
- **console,assist:** the assistant uses the org's brand, at no extra cached prefix ([AGL-2352](https://linear.app/aglyn/issue/AGL-2352))
- **console,docs:** the idempotency-claims card gets its help, and the docs section behind it ([AGL-2365](https://linear.app/aglyn/issue/AGL-2365), [AGL-2329](https://linear.app/aglyn/issue/AGL-2329))
- **console:** the recorded-not-priced rollup fields get a reader ([AGL-2321](https://linear.app/aglyn/issue/AGL-2321), [AGL-1134](https://linear.app/aglyn/issue/AGL-1134))
- **marketing:** the tablet/mobile gutter gap is an unfinished frame re-cut ([AGL-2362](https://linear.app/aglyn/issue/AGL-2362), [AGL-2360](https://linear.app/aglyn/issue/AGL-2360), [AGL-1282](https://linear.app/aglyn/issue/AGL-1282))
- **console:** the Enterprise fee claim says WHICH sales are 0% again ([AGL-2365](https://linear.app/aglyn/issue/AGL-2365), [AGL-2315](https://linear.app/aglyn/issue/AGL-2315), [AGL-2297](https://linear.app/aglyn/issue/AGL-2297), [AGL-892](https://linear.app/aglyn/issue/AGL-892))
- **console:** the audit Archive card gets the help affordance its guard requires ([AGL-2365](https://linear.app/aglyn/issue/AGL-2365), [AGL-2324](https://linear.app/aglyn/issue/AGL-2324))
- **console:** the SSO password block reads the org's brand, at no extra read ([AGL-2352](https://linear.app/aglyn/issue/AGL-2352), [AGL-2319](https://linear.app/aglyn/issue/AGL-2319))
- **console,plugins:** marketplace and payout copy names the entity, not a literal ([AGL-2351](https://linear.app/aglyn/issue/AGL-2351), [AGL-2319](https://linear.app/aglyn/issue/AGL-2319), [AGL-2350](https://linear.app/aglyn/issue/AGL-2350))
- **commerce:** the restock prompt counts units the shelf lost, not units sold ([AGL-2325](https://linear.app/aglyn/issue/AGL-2325), [AGL-2149](https://linear.app/aglyn/issue/AGL-2149), [AGL-1807](https://linear.app/aglyn/issue/AGL-1807))
- **commerce:** local pickup is a collection choice, not a licence to ship anywhere ([AGL-2325](https://linear.app/aglyn/issue/AGL-2325))
- **docs:** drop the ignoreDeprecations value this app's TypeScript rejects ([AGL-2363](https://linear.app/aglyn/issue/AGL-2363))
- **docs:** the docs typecheck can run again, and the error it hid ([AGL-2363](https://linear.app/aglyn/issue/AGL-2363))
- **bookings:** cancelling a paid booking refunds the guest ([AGL-2315](https://linear.app/aglyn/issue/AGL-2315))
- **bookings:** refunding a paid booking reverses the seller share ([AGL-2315](https://linear.app/aglyn/issue/AGL-2315), [AGL-1696](https://linear.app/aglyn/issue/AGL-1696))
- **ci:** the cron workflow skips a route that is not in the deployed tree yet ([AGL-2359](https://linear.app/aglyn/issue/AGL-2359), [AGL-1996](https://linear.app/aglyn/issue/AGL-1996), [AGL-2010](https://linear.app/aglyn/issue/AGL-2010), [AGL-2134](https://linear.app/aglyn/issue/AGL-2134))
- **bookings:** a paid booking pays the merchant, not Aglyn's platform account ([AGL-2315](https://linear.app/aglyn/issue/AGL-2315), [AGL-2114](https://linear.app/aglyn/issue/AGL-2114), [AGL-2317](https://linear.app/aglyn/issue/AGL-2317))
- **console:** custom roles say what they do, and the 51st one exists ([AGL-2334](https://linear.app/aglyn/issue/AGL-2334))
- **console:** the success-manager card carries its own help affordance ([AGL-2332](https://linear.app/aglyn/issue/AGL-2332))
- **console:** the dataset-csv re-export does not drag a client barrel server-side ([AGL-2335](https://linear.app/aglyn/issue/AGL-2335))
- **console:** the two new staff surfaces satisfy their own coverage guards ([AGL-2310](https://linear.app/aglyn/issue/AGL-2310), [AGL-2318](https://linear.app/aglyn/issue/AGL-2318))
- **console:** a domain with no certificate is not serving, and finishes itself ([AGL-1996](https://linear.app/aglyn/issue/AGL-1996), [AGL-2010](https://linear.app/aglyn/issue/AGL-2010), [AGL-743](https://linear.app/aglyn/issue/AGL-743), [AGL-1993](https://linear.app/aglyn/issue/AGL-1993), [AGL-2084](https://linear.app/aglyn/issue/AGL-2084), [AGL-2134](https://linear.app/aglyn/issue/AGL-2134))
- **commerce:** the cancellation writer is text again, not a binary file ([AGL-2355](https://linear.app/aglyn/issue/AGL-2355), [AGL-2320](https://linear.app/aglyn/issue/AGL-2320))
- **commerce:** a stock decrement takes a lock, so two sales cannot take one unit ([AGL-2320](https://linear.app/aglyn/issue/AGL-2320), [AGL-1808](https://linear.app/aglyn/issue/AGL-1808), [AGL-1830](https://linear.app/aglyn/issue/AGL-1830), [AGL-1828](https://linear.app/aglyn/issue/AGL-1828), [AGL-2149](https://linear.app/aglyn/issue/AGL-2149))
- **console:** /api/hosts/create is rate limited, so a name grab is bounded ([AGL-1968](https://linear.app/aglyn/issue/AGL-1968), [AGL-2063](https://linear.app/aglyn/issue/AGL-2063), [AGL-147](https://linear.app/aglyn/issue/AGL-147), [AGL-794](https://linear.app/aglyn/issue/AGL-794))
- **console:** the lockdown spec's navigation mock covers what the page reaches ([AGL-2009](https://linear.app/aglyn/issue/AGL-2009), [AGL-2105](https://linear.app/aglyn/issue/AGL-2105))
- **tools,plugins-mui:** the container-width ban gets a detector that can fail ([AGL-1296](https://linear.app/aglyn/issue/AGL-1296), [AGL-1298](https://linear.app/aglyn/issue/AGL-1298))
- **tools:** the pricing reconciler reconciles before it writes, and can fail ([AGL-1278](https://linear.app/aglyn/issue/AGL-1278), [AGL-2133](https://linear.app/aglyn/issue/AGL-2133))
- **tools:** the colour ratchet reads the file through the parser, not a scanner ([AGL-2354](https://linear.app/aglyn/issue/AGL-2354), [AGL-2278](https://linear.app/aglyn/issue/AGL-2278), [AGL-2319](https://linear.app/aglyn/issue/AGL-2319), [AGL-2350](https://linear.app/aglyn/issue/AGL-2350), [AGL-2004](https://linear.app/aglyn/issue/AGL-2004), [AGL-2279](https://linear.app/aglyn/issue/AGL-2279))
- **console:** the screen-cap alert names the sites that are over ([AGL-2321](https://linear.app/aglyn/issue/AGL-2321), [AGL-1390](https://linear.app/aglyn/issue/AGL-1390), [AGL-1440](https://linear.app/aglyn/issue/AGL-1440), [AGL-2052](https://linear.app/aglyn/issue/AGL-2052))
- **aglyn,plugins-mui,tenant:** heading anchors reach every renderer that publishes them ([AGL-1162](https://linear.app/aglyn/issue/AGL-1162), [AGL-2116](https://linear.app/aglyn/issue/AGL-2116))
- **aglyn:** widen searchIndex before reading its length ([AGL-2353](https://linear.app/aglyn/issue/AGL-2353))
- **tenant:** a missing URL serves the site's own 404 screen, still as a 404 ([AGL-2342](https://linear.app/aglyn/issue/AGL-2342), [AGL-87](https://linear.app/aglyn/issue/AGL-87), [AGL-2187](https://linear.app/aglyn/issue/AGL-2187))
- **marketplace:** the install warns before a future update eats a customization ([AGL-2339](https://linear.app/aglyn/issue/AGL-2339))
- **console:** an agency past its 50th workspace can reach the rest ([AGL-2336](https://linear.app/aglyn/issue/AGL-2336))
- **plugins-mui,aglyn:** the search empty state admits every truncation, not just paging ([AGL-1516](https://linear.app/aglyn/issue/AGL-1516))
- **tools:** the brand ratchet reads JSX text, via the parser not a scanner ([AGL-2350](https://linear.app/aglyn/issue/AGL-2350), [AGL-2278](https://linear.app/aglyn/issue/AGL-2278), [AGL-2319](https://linear.app/aglyn/issue/AGL-2319))
- **marketplace:** a renamed publisher handle stops breaking every existing link ([AGL-2312](https://linear.app/aglyn/issue/AGL-2312))
- **console:** user-visible copy reads the configured brand, not "Aglyn" ([AGL-2319](https://linear.app/aglyn/issue/AGL-2319), [AGL-2278](https://linear.app/aglyn/issue/AGL-2278), [AGL-2309](https://linear.app/aglyn/issue/AGL-2309))
- **plugins-mui:** a split summary's chevron is named from the label the renderer emits ([AGL-2349](https://linear.app/aglyn/issue/AGL-2349), [AGL-1232](https://linear.app/aglyn/issue/AGL-1232))
- **console:** the refund-reversal recovery queue reaches a human ([AGL-2309](https://linear.app/aglyn/issue/AGL-2309))
- **tools:** a skipped console half stops reading as a passing wire run ([AGL-2348](https://linear.app/aglyn/issue/AGL-2348), [AGL-1800](https://linear.app/aglyn/issue/AGL-1800))
- **billing:** the webhook's GA4 revenue beacons are scheduled, not abandoned ([AGL-2346](https://linear.app/aglyn/issue/AGL-2346), [AGL-1133](https://linear.app/aglyn/issue/AGL-1133), [AGL-1850](https://linear.app/aglyn/issue/AGL-1850), [AGL-1851](https://linear.app/aglyn/issue/AGL-1851), [AGL-1637](https://linear.app/aglyn/issue/AGL-1637))
- **tools:** a deferred @aglyn import in a spec stops reddening another app ([AGL-2347](https://linear.app/aglyn/issue/AGL-2347), [AGL-2313](https://linear.app/aglyn/issue/AGL-2313), [AGL-949](https://linear.app/aglyn/issue/AGL-949), [AGL-1329](https://linear.app/aglyn/issue/AGL-1329))
- **console:** three specs become modules, and Stack takes justifyContent via sx ([AGL-2345](https://linear.app/aglyn/issue/AGL-2345))
- **marketplace:** the publish gate cites its own issue, and stops breaking lint ([AGL-2282](https://linear.app/aglyn/issue/AGL-2282), [AGL-2252](https://linear.app/aglyn/issue/AGL-2252))
- **inbox:** a lead row says where it came from and who it is ([AGL-2338](https://linear.app/aglyn/issue/AGL-2338), [AGL-109](https://linear.app/aglyn/issue/AGL-109), [AGL-2303](https://linear.app/aglyn/issue/AGL-2303))
- **console:** the passkey refusal a real user gets now says what to do ([AGL-1417](https://linear.app/aglyn/issue/AGL-1417))
- **console,aglyn:** a rejection withdraws the offer and the realm trust ([AGL-2306](https://linear.app/aglyn/issue/AGL-2306), [AGL-1016](https://linear.app/aglyn/issue/AGL-1016), [AGL-1085](https://linear.app/aglyn/issue/AGL-1085))
- **tenant:** the kill switch reaches remote server bundles ([AGL-2307](https://linear.app/aglyn/issue/AGL-2307))
- **aglyn,marketplace:** the kill-switch document is adopted, not rebuilt ([AGL-2305](https://linear.app/aglyn/issue/AGL-2305), [AGL-1085](https://linear.app/aglyn/issue/AGL-1085))
- **console:** the webhook health probe counts the collection it writes ([AGL-2308](https://linear.app/aglyn/issue/AGL-2308), [AGL-2040](https://linear.app/aglyn/issue/AGL-2040))
- **tools:** the DOMPurify dismissals get a guard, and a reason that is true ([AGL-2300](https://linear.app/aglyn/issue/AGL-2300), [AGL-2051](https://linear.app/aglyn/issue/AGL-2051))
- **console:** the team-seat meter counts the invites the gate counts ([AGL-2304](https://linear.app/aglyn/issue/AGL-2304), [AGL-2068](https://linear.app/aglyn/issue/AGL-2068))
- **marketing:** campaign merge tags resolve against fields that exist ([AGL-2303](https://linear.app/aglyn/issue/AGL-2303))
- **api:** a /v1 create that fills a plan band is retriable again ([AGL-2296](https://linear.app/aglyn/issue/AGL-2296), [AGL-2276](https://linear.app/aglyn/issue/AGL-2276))
- **tenant:** the edit-context fallback stops letting a catalog shadow a blog ([AGL-1845](https://linear.app/aglyn/issue/AGL-1845), [AGL-954](https://linear.app/aglyn/issue/AGL-954))
- **marketplace,console:** a partial refund pulls the publisher's share back ([AGL-2299](https://linear.app/aglyn/issue/AGL-2299), [AGL-1554](https://linear.app/aglyn/issue/AGL-1554), [AGL-2148](https://linear.app/aglyn/issue/AGL-2148))
- **commerce:** the zone matcher reads codes it did not write itself ([AGL-2298](https://linear.app/aglyn/issue/AGL-2298))
- **console:** the Enterprise card ticks only what the org actually holds ([AGL-2297](https://linear.app/aglyn/issue/AGL-2297))
- **commerce:** delete the dead flat fee constant and two stale docblock claims ([AGL-2295](https://linear.app/aglyn/issue/AGL-2295), [AGL-470](https://linear.app/aglyn/issue/AGL-470))
- **console:** the churn report reads the free text customers typed ([AGL-2294](https://linear.app/aglyn/issue/AGL-2294), [AGL-2248](https://linear.app/aglyn/issue/AGL-2248), [AGL-1978](https://linear.app/aglyn/issue/AGL-1978))
- **console,billing:** a fee-percentage override is capped at 100 ([AGL-2293](https://linear.app/aglyn/issue/AGL-2293), [AGL-1543](https://linear.app/aglyn/issue/AGL-1543))
- **console:** the customer audit feed fetches an ordered window ([AGL-2292](https://linear.app/aglyn/issue/AGL-2292))
- **commerce:** the tax-ledger spec models the renewal's fee re-price ([AGL-2289](https://linear.app/aglyn/issue/AGL-2289))
- **marketplace:** takedown and privacy reach every install door ([AGL-2290](https://linear.app/aglyn/issue/AGL-2290), [AGL-948](https://linear.app/aglyn/issue/AGL-948), [AGL-968](https://linear.app/aglyn/issue/AGL-968), [AGL-658](https://linear.app/aglyn/issue/AGL-658))
- **marketplace,aglyn:** a switched-off listing is not for sale ([AGL-2288](https://linear.app/aglyn/issue/AGL-2288))
- **commerce:** a subscription's platform fee follows the plan ([AGL-2289](https://linear.app/aglyn/issue/AGL-2289), [AGL-2071](https://linear.app/aglyn/issue/AGL-2071))
- **console:** the audit log reads the scope and actorEmail it is written ([AGL-2287](https://linear.app/aglyn/issue/AGL-2287), [AGL-1652](https://linear.app/aglyn/issue/AGL-1652))
- **console,tenant:** every media-picker field accepts what its own Browse writes ([AGL-2286](https://linear.app/aglyn/issue/AGL-2286), [AGL-2247](https://linear.app/aglyn/issue/AGL-2247))
- **commerce:** a non-numeric cart quantity stops locking the shopper out ([AGL-2285](https://linear.app/aglyn/issue/AGL-2285), [AGL-2229](https://linear.app/aglyn/issue/AGL-2229))
- **commerce:** the packing slip and POS receipt escape what they interpolate ([AGL-2283](https://linear.app/aglyn/issue/AGL-2283), [AGL-2268](https://linear.app/aglyn/issue/AGL-2268))
- **console:** the SSO enforcement spec spells four spaces as {4} ([AGL-2284](https://linear.app/aglyn/issue/AGL-2284), [AGL-2254](https://linear.app/aglyn/issue/AGL-2254))
- **tools:** the brand ratchet exempts generated docs prose by PATH, not directory ([AGL-2279](https://linear.app/aglyn/issue/AGL-2279), [AGL-2213](https://linear.app/aglyn/issue/AGL-2213), [AGL-2281](https://linear.app/aglyn/issue/AGL-2281), [AGL-2016](https://linear.app/aglyn/issue/AGL-2016))
- **billing:** the discount-margin model sees Assist provider spend ([AGL-2280](https://linear.app/aglyn/issue/AGL-2280), [AGL-1134](https://linear.app/aglyn/issue/AGL-1134))
- **tools:** the brand detector reads a regex as a regex, not a string ([AGL-2278](https://linear.app/aglyn/issue/AGL-2278), [AGL-2281](https://linear.app/aglyn/issue/AGL-2281))
- **marketplace:** every publish door asks for the publisher agreement ([AGL-2282](https://linear.app/aglyn/issue/AGL-2282), [AGL-1077](https://linear.app/aglyn/issue/AGL-1077))
- **commerce:** the digital download limit becomes a limit ([AGL-2275](https://linear.app/aglyn/issue/AGL-2275))
- **commerce:** a hand-issued gift card counts toward cost ([AGL-2273](https://linear.app/aglyn/issue/AGL-2273), [AGL-1438](https://linear.app/aglyn/issue/AGL-1438), [AGL-2226](https://linear.app/aglyn/issue/AGL-2226))
- **console:** the cron-wiring guard unquotes a shell word ([AGL-2272](https://linear.app/aglyn/issue/AGL-2272), [AGL-2219](https://linear.app/aglyn/issue/AGL-2219))
- **console:** the white-label tab title stops reading the platform brand ([AGL-2270](https://linear.app/aglyn/issue/AGL-2270), [AGL-2170](https://linear.app/aglyn/issue/AGL-2170))
- **rules:** the inventory ledger becomes append-only ([AGL-2269](https://linear.app/aglyn/issue/AGL-2269), [AGL-2149](https://linear.app/aglyn/issue/AGL-2149), [AGL-1367](https://linear.app/aglyn/issue/AGL-1367), [AGL-2038](https://linear.app/aglyn/issue/AGL-2038))
- **commerce:** the supplier callback becomes one transaction, and a GET moves nothing ([AGL-2268](https://linear.app/aglyn/issue/AGL-2268), [AGL-1808](https://linear.app/aglyn/issue/AGL-1808))
- **console:** the subprocessor gate classifies AGL-2240's two guard files ([AGL-2240](https://linear.app/aglyn/issue/AGL-2240), [AGL-2263](https://linear.app/aglyn/issue/AGL-2263), [AGL-2104](https://linear.app/aglyn/issue/AGL-2104))
- **commerce:** the register and draft orders gate on an allowlist of roles ([AGL-2262](https://linear.app/aglyn/issue/AGL-2262))
- **console:** a JIT sign-in spends a seat only when there is one ([AGL-2259](https://linear.app/aglyn/issue/AGL-2259), [AGL-1113](https://linear.app/aglyn/issue/AGL-1113))
- **console,assist:** the signal board header reads the configured brand ([AGL-2153](https://linear.app/aglyn/issue/AGL-2153), [AGL-2260](https://linear.app/aglyn/issue/AGL-2260))
- **commerce:** two console help excerpts read the configured brand ([AGL-2260](https://linear.app/aglyn/issue/AGL-2260))
- **commerce:** an unreadable org no longer cancels a healthy merchant's subscribers ([AGL-2258](https://linear.app/aglyn/issue/AGL-2258), [AGL-2071](https://linear.app/aglyn/issue/AGL-2071))
- **commerce:** a platform fee that rounds to zero is charged, not dropped ([AGL-2256](https://linear.app/aglyn/issue/AGL-2256))
- **commerce:** annotate the fetch mock so its Stripe overrides type-check ([AGL-2255](https://linear.app/aglyn/issue/AGL-2255), [AGL-2242](https://linear.app/aglyn/issue/AGL-2242), [AGL-2244](https://linear.app/aglyn/issue/AGL-2244))
- **console,tenant:** every dataset-record writer meets both caps ([AGL-2253](https://linear.app/aglyn/issue/AGL-2253), [AGL-2163](https://linear.app/aglyn/issue/AGL-2163))
- **console,billing:** a Free org stops being offered a budget that cannot fire ([AGL-2250](https://linear.app/aglyn/issue/AGL-2250), [AGL-2135](https://linear.app/aglyn/issue/AGL-2135))
- **console:** the branding save accepts what its own media picker writes ([AGL-2247](https://linear.app/aglyn/issue/AGL-2247), [AGL-2230](https://linear.app/aglyn/issue/AGL-2230))
- **commerce:** a type-less product pays the PHYSICAL fee on every door ([AGL-2251](https://linear.app/aglyn/issue/AGL-2251))
- **console,billing:** the template cap becomes visible, and the quota class gets a guard ([AGL-2246](https://linear.app/aglyn/issue/AGL-2246), [AGL-2079](https://linear.app/aglyn/issue/AGL-2079))
- **commerce:** a cancelled order's payment link is expired, not left payable ([AGL-2244](https://linear.app/aglyn/issue/AGL-2244))
- **aglyn:** the host-subcollection guard annotates Dirent[], not ReturnType ([AGL-2243](https://linear.app/aglyn/issue/AGL-2243))
- **commerce:** two spec fixtures stop modelling shapes the product cannot produce ([AGL-2242](https://linear.app/aglyn/issue/AGL-2242), [AGL-2136](https://linear.app/aglyn/issue/AGL-2136), [AGL-2149](https://linear.app/aglyn/issue/AGL-2149))
- **json-editor,color-picker:** stop holding dependencies to unagreed strictness ([AGL-2241](https://linear.app/aglyn/issue/AGL-2241), [AGL-2196](https://linear.app/aglyn/issue/AGL-2196))
- **console,assist:** the done event stops counting the message twice ([AGL-2238](https://linear.app/aglyn/issue/AGL-2238), [AGL-2057](https://linear.app/aglyn/issue/AGL-2057))
- **console,billing:** the alerts stop reaching nobody quietly ([AGL-2234](https://linear.app/aglyn/issue/AGL-2234), [AGL-2052](https://linear.app/aglyn/issue/AGL-2052))
- **workflows:** the inbound webhook run meets the monthly cap ([AGL-2228](https://linear.app/aglyn/issue/AGL-2228), [AGL-149](https://linear.app/aglyn/issue/AGL-149))
- **rules:** the order rule becomes the allowlist its own comment describes ([AGL-2237](https://linear.app/aglyn/issue/AGL-2237), [AGL-1795](https://linear.app/aglyn/issue/AGL-1795))
- **console:** a free plan's resource caps survive concurrent creates ([AGL-2231](https://linear.app/aglyn/issue/AGL-2231), [AGL-1383](https://linear.app/aglyn/issue/AGL-1383))
- **commerce:** a cart no rate can price is refused, not shipped free ([AGL-2232](https://linear.app/aglyn/issue/AGL-2232))
- **commerce:** the abandoned-cart and restock passes run, and both queues are visible ([AGL-2227](https://linear.app/aglyn/issue/AGL-2227))
- **email:** the brand logo resolves to a fetchable URL instead of a media: ref ([AGL-2230](https://linear.app/aglyn/issue/AGL-2230), [AGL-2139](https://linear.app/aglyn/issue/AGL-2139), [AGL-2038](https://linear.app/aglyn/issue/AGL-2038), [AGL-2002](https://linear.app/aglyn/issue/AGL-2002), [AGL-1224](https://linear.app/aglyn/issue/AGL-1224))
- **console,billing:** the usage sweep stops silently ending at 500 orgs ([AGL-2220](https://linear.app/aglyn/issue/AGL-2220), [AGL-1141](https://linear.app/aglyn/issue/AGL-1141))
- **console:** the bandwidth help tip stops breaking two usage specs ([AGL-2201](https://linear.app/aglyn/issue/AGL-2201))
- **commerce:** a non-finite money part no longer NaNs an order's totals ([AGL-2229](https://linear.app/aglyn/issue/AGL-2229))
- **console,billing:** roll up the month in progress, so a usage budget can speak ([AGL-2219](https://linear.app/aglyn/issue/AGL-2219))
- **selfhost:** the last two staff surfaces stop naming Aglyn's own resources ([AGL-2196](https://linear.app/aglyn/issue/AGL-2196))
- **selfhost:** burn down the ratchet's remaining host literals ([AGL-2202](https://linear.app/aglyn/issue/AGL-2202), [AGL-2195](https://linear.app/aglyn/issue/AGL-2195), [AGL-949](https://linear.app/aglyn/issue/AGL-949))
- **plugins,console,tenant:** presets seed the spelling the panel can edit ([AGL-2208](https://linear.app/aglyn/issue/AGL-2208), [AGL-2207](https://linear.app/aglyn/issue/AGL-2207))
- **aglyn,besigner:** an instance override replaces the alias it overrides ([AGL-2209](https://linear.app/aglyn/issue/AGL-2209), [AGL-1306](https://linear.app/aglyn/issue/AGL-1306), [AGL-1332](https://linear.app/aglyn/issue/AGL-1332), [AGL-2207](https://linear.app/aglyn/issue/AGL-2207), [AGL-1346](https://linear.app/aglyn/issue/AGL-1346))
- **besigner:** the styles panel reads and clears MUI's sx aliases ([AGL-2207](https://linear.app/aglyn/issue/AGL-2207), [AGL-1346](https://linear.app/aglyn/issue/AGL-1346))
- **console:** the site allowance reads Unlimited, not Infinity ([AGL-2223](https://linear.app/aglyn/issue/AGL-2223), [AGL-2166](https://linear.app/aglyn/issue/AGL-2166))
- **workflows,runtime:** a workflow run reaches the table built to show it ([AGL-2222](https://linear.app/aglyn/issue/AGL-2222), [AGL-2171](https://linear.app/aglyn/issue/AGL-2171))
- **selfhost:** the standalone flag reaches the stage that actually runs ([AGL-2221](https://linear.app/aglyn/issue/AGL-2221), [AGL-2177](https://linear.app/aglyn/issue/AGL-2177))
- **console:** a page's help icon opens the section it is standing in front of ([AGL-2200](https://linear.app/aglyn/issue/AGL-2200), [AGL-2130](https://linear.app/aglyn/issue/AGL-2130))
- **selfhost:** each site on the operator apex resolves to its own tenant host ([AGL-2217](https://linear.app/aglyn/issue/AGL-2217), [AGL-2177](https://linear.app/aglyn/issue/AGL-2177))
- **selfhost:** the SSO-domain refusal names the platform brand ([AGL-2214](https://linear.app/aglyn/issue/AGL-2214))
- **selfhost:** the CSP first-party set includes the operator's hosts ([AGL-2198](https://linear.app/aglyn/issue/AGL-2198))
- **besigner:** the picker's global Escape stands down while the author is typing ([AGL-2212](https://linear.app/aglyn/issue/AGL-2212), [AGL-2211](https://linear.app/aglyn/issue/AGL-2211))
- **besigner:** the raw JSON editor's Cmd+C/V/A edit text, not canvas elements ([AGL-2211](https://linear.app/aglyn/issue/AGL-2211))
- **selfhost:** the editor-presence hint and the signup helper read the workspace domain ([AGL-2197](https://linear.app/aglyn/issue/AGL-2197))
- **selfhost:** our own addresses and services stop being compiled in ([AGL-2196](https://linear.app/aglyn/issue/AGL-2196))
- **selfhost:** the tenant apex comes from config on every surface ([AGL-2195](https://linear.app/aglyn/issue/AGL-2195))
- **console:** the naming sweep exempts the report-an-issue doc's forum link ([AGL-2185](https://linear.app/aglyn/issue/AGL-2185), [AGL-975](https://linear.app/aglyn/issue/AGL-975))
- **console:** the checkout spec sends the Idempotency-Key its client always sends ([AGL-2163](https://linear.app/aglyn/issue/AGL-2163))
- **console:** the form-submissions spec stops mocking a closed world ([AGL-2163](https://linear.app/aglyn/issue/AGL-2163))
- **console:** regenerate the stale Assist docs index
- **tools:** the brand ratchet counts TRACKED files, and re-baselines onto main ([AGL-2170](https://linear.app/aglyn/issue/AGL-2170), [AGL-2025](https://linear.app/aglyn/issue/AGL-2025), [AGL-2169](https://linear.app/aglyn/issue/AGL-2169))
- **tenant:** /api/host publishes an allow-list, not the host document ([AGL-2192](https://linear.app/aglyn/issue/AGL-2192), [AGL-2191](https://linear.app/aglyn/issue/AGL-2191), [AGL-1501](https://linear.app/aglyn/issue/AGL-1501))
- **tenant:** /api/screen publishes an allow-list, not the screen document ([AGL-2191](https://linear.app/aglyn/issue/AGL-2191), [AGL-87](https://linear.app/aglyn/issue/AGL-87), [AGL-794](https://linear.app/aglyn/issue/AGL-794))
- **tenant,console,docs:** the fallback 404 is navigable ([AGL-2187](https://linear.app/aglyn/issue/AGL-2187), [AGL-2101](https://linear.app/aglyn/issue/AGL-2101))
- **docs,console:** the enterprise story stops contradicting the product ([AGL-2189](https://linear.app/aglyn/issue/AGL-2189))
- **marketplace,tenant:** restore closers my conflict unions swallowed
- **console:** console:test was RED on main — six closed-world mocks ([AGL-2190](https://linear.app/aglyn/issue/AGL-2190))
- **console,aglyn:** the signup clickwrap links to the operator's terms, not Aglyn's ([AGL-2017](https://linear.app/aglyn/issue/AGL-2017), [AGL-2016](https://linear.app/aglyn/issue/AGL-2016))
- **console,besigner,docs:** the docs origin becomes one value under one name ([AGL-2186](https://linear.app/aglyn/issue/AGL-2186), [AGL-733](https://linear.app/aglyn/issue/AGL-733))
- **tenant:** our favicon leaves the browser tab of every white-label customer's site ([AGL-2183](https://linear.app/aglyn/issue/AGL-2183), [AGL-1421](https://linear.app/aglyn/issue/AGL-1421))
- **console:** a webhook that failed mid-dispatch keeps its idempotency claim ([AGL-2157](https://linear.app/aglyn/issue/AGL-2157), [AGL-498](https://linear.app/aglyn/issue/AGL-498))
- **commerce:** buy-now charges what it records, and a booking cannot be crowded out ([AGL-2159](https://linear.app/aglyn/issue/AGL-2159), [AGL-1711](https://linear.app/aglyn/issue/AGL-1711), [AGL-1793](https://linear.app/aglyn/issue/AGL-1793), [AGL-1732](https://linear.app/aglyn/issue/AGL-1732))
- **console:** plugin page tabs print the nav label, not the URL slug ([AGL-2184](https://linear.app/aglyn/issue/AGL-2184))
- **console,aglyn:** the unread `allowed` fields refuse, the no-op claim is audible, the return shows all three buckets ([AGL-2163](https://linear.app/aglyn/issue/AGL-2163), [AGL-1904](https://linear.app/aglyn/issue/AGL-1904), [AGL-2137](https://linear.app/aglyn/issue/AGL-2137))
- **console,tenant,aglyn:** domain verification stops failing open on self-host ([AGL-2180](https://linear.app/aglyn/issue/AGL-2180), [AGL-2177](https://linear.app/aglyn/issue/AGL-2177), [AGL-733](https://linear.app/aglyn/issue/AGL-733))
- **console:** the funnel downsell warns what the customer will be over ([AGL-2154](https://linear.app/aglyn/issue/AGL-2154), [AGL-483](https://linear.app/aglyn/issue/AGL-483), [AGL-1863](https://linear.app/aglyn/issue/AGL-1863))
- **console:** three tier-visibility defects on the plan grid ([AGL-2156](https://linear.app/aglyn/issue/AGL-2156), [AGL-532](https://linear.app/aglyn/issue/AGL-532), [AGL-1422](https://linear.app/aglyn/issue/AGL-1422))
- **build:** the build id moves to the bundler-agnostic env block ([AGL-2181](https://linear.app/aglyn/issue/AGL-2181), [AGL-2091](https://linear.app/aglyn/issue/AGL-2091))
- **commerce:** a paid storefront order keeps its keys, its stock and its refund route ([AGL-2149](https://linear.app/aglyn/issue/AGL-2149), [AGL-1825](https://linear.app/aglyn/issue/AGL-1825), [AGL-1807](https://linear.app/aglyn/issue/AGL-1807), [AGL-308](https://linear.app/aglyn/issue/AGL-308))
- **console,marketplace:** the seller ledger reports the real payout and a refunded buyer can re-buy ([AGL-2158](https://linear.app/aglyn/issue/AGL-2158), [AGL-1544](https://linear.app/aglyn/issue/AGL-1544), [AGL-1639](https://linear.app/aglyn/issue/AGL-1639), [AGL-2140](https://linear.app/aglyn/issue/AGL-2140), [AGL-1546](https://linear.app/aglyn/issue/AGL-1546), [AGL-1699](https://linear.app/aglyn/issue/AGL-1699))
- **cloud,console,tenant,docs:** a self-host deployment stops calling and redirecting to our infrastructure ([AGL-2176](https://linear.app/aglyn/issue/AGL-2176))
- **tenant:** a self-host container serves published sites instead of 307ing every visitor to us ([AGL-2177](https://linear.app/aglyn/issue/AGL-2177))
- **console:** a downgrade clears a pending cancel, and a failed swap stops lying ([AGL-2151](https://linear.app/aglyn/issue/AGL-2151), [AGL-2144](https://linear.app/aglyn/issue/AGL-2144))
- **console:** a downgrade schedule no longer freezes and truncates the items ([AGL-2150](https://linear.app/aglyn/issue/AGL-2150), [AGL-2146](https://linear.app/aglyn/issue/AGL-2146))
- **marketplace:** the refund orphan store closes the pre-purchase window ([AGL-2148](https://linear.app/aglyn/issue/AGL-2148), [AGL-1994](https://linear.app/aglyn/issue/AGL-1994), [AGL-2140](https://linear.app/aglyn/issue/AGL-2140))
- **console,aglyn,besigner,plugins,tools:** the wizard stops handing out Aglyn's DNS records ([AGL-2037](https://linear.app/aglyn/issue/AGL-2037), [AGL-2172](https://linear.app/aglyn/issue/AGL-2172), [AGL-733](https://linear.app/aglyn/issue/AGL-733), [AGL-2121](https://linear.app/aglyn/issue/AGL-2121))
- **docs,console:** a self-hosted docs build must not report to Aglyn ([AGL-2124](https://linear.app/aglyn/issue/AGL-2124))
- **tools:** the release bump writes the lockfile too, and a guard reads it ([AGL-2108](https://linear.app/aglyn/issue/AGL-2108), [AGL-2089](https://linear.app/aglyn/issue/AGL-2089), [AGL-2107](https://linear.app/aglyn/issue/AGL-2107))
- **aglyn,tenant:** TENANT_APEX is configuration, not our infrastructure ([AGL-2121](https://linear.app/aglyn/issue/AGL-2121), [AGL-2022](https://linear.app/aglyn/issue/AGL-2022))
- **aglyn,console,email:** white-label email stops reverting to Aglyn ([AGL-2139](https://linear.app/aglyn/issue/AGL-2139))
- **console:** the quota guard's docblock stops failing lint ([AGL-2133](https://linear.app/aglyn/issue/AGL-2133))
- **tools:** re-baseline the colour ratchet after two refactors moved colours between files ([AGL-2169](https://linear.app/aglyn/issue/AGL-2169), [AGL-2074](https://linear.app/aglyn/issue/AGL-2074), [AGL-2026](https://linear.app/aglyn/issue/AGL-2026))
- **aglyn,console,tools:** retire totalSiteSizeMb rather than leaving a phantom control ([AGL-2133](https://linear.app/aglyn/issue/AGL-2133), [AGL-1635](https://linear.app/aglyn/issue/AGL-1635), [AGL-678](https://linear.app/aglyn/issue/AGL-678), [AGL-1370](https://linear.app/aglyn/issue/AGL-1370), [AGL-1789](https://linear.app/aglyn/issue/AGL-1789))
- **console,docs:** the help guard counts cards, not files, and the editor gets its own ([AGL-2130](https://linear.app/aglyn/issue/AGL-2130), [AGL-899](https://linear.app/aglyn/issue/AGL-899), [AGL-2127](https://linear.app/aglyn/issue/AGL-2127), [AGL-2167](https://linear.app/aglyn/issue/AGL-2167))
- **console:** a super-only staff control stops offering itself to support ([AGL-2131](https://linear.app/aglyn/issue/AGL-2131), [AGL-2113](https://linear.app/aglyn/issue/AGL-2113))
- **console:** every icon-only button has a name, and a guard that says so ([AGL-2128](https://linear.app/aglyn/issue/AGL-2128))
- **console:** the traffic delta follows the range you picked ([AGL-2160](https://linear.app/aglyn/issue/AGL-2160))
- **console,cloud:** a claim-less staff token stops resolving to super ([AGL-2131](https://linear.app/aglyn/issue/AGL-2131), [AGL-206](https://linear.app/aglyn/issue/AGL-206), [AGL-495](https://linear.app/aglyn/issue/AGL-495))
- **aglyn,email,console:** white-label email stops being a from-name and nothing else ([AGL-2139](https://linear.app/aglyn/issue/AGL-2139))
- **docs,console,repo:** a self-hosted docs build stops reporting its readers to us ([AGL-2124](https://linear.app/aglyn/issue/AGL-2124), [AGL-2064](https://linear.app/aglyn/issue/AGL-2064))
- **marketing,console:** a scheduled campaign now actually sends ([AGL-2134](https://linear.app/aglyn/issue/AGL-2134))
- **aglyn,tenant:** the tenant apex is configuration everywhere, not just in the console's links ([AGL-2121](https://linear.app/aglyn/issue/AGL-2121), [AGL-2022](https://linear.app/aglyn/issue/AGL-2022))

### Reverted

- **repo:** back out two files my own commit swept in from the shared index ([AGL-2365](https://linear.app/aglyn/issue/AGL-2365), [AGL-2324](https://linear.app/aglyn/issue/AGL-2324))
- drop this branch's AGL-2143, superseded on main by 6e4d7938f ([AGL-2143](https://linear.app/aglyn/issue/AGL-2143))

### Changed

- **aglyn:** the revocation type stops claiming nothing reads its reason ([AGL-2328](https://linear.app/aglyn/issue/AGL-2328))

### Documentation

- **handoff:** record the session — gate blind spots, shared-checkout hazards, promotion state
- **ci:** nx-ci.yml is ACTIVE — correct 13 comments that said otherwise ([AGL-2381](https://linear.app/aglyn/issue/AGL-2381))
- **bookings:** paid bookings need Stripe connected, carry the digital rate, and refund ([AGL-2315](https://linear.app/aglyn/issue/AGL-2315))
- **marketing:** the container invariant is stock xl, not a 1280 column ([AGL-2360](https://linear.app/aglyn/issue/AGL-2360), [AGL-1298](https://linear.app/aglyn/issue/AGL-1298), [AGL-2362](https://linear.app/aglyn/issue/AGL-2362))
- **api:** the API overview catches up with contact writes and the usage endpoint ([AGL-2277](https://linear.app/aglyn/issue/AGL-2277), [AGL-2276](https://linear.app/aglyn/issue/AGL-2276))
- **analytics:** the GA4 env verdict is stale and manufactured a false finding ([AGL-1636](https://linear.app/aglyn/issue/AGL-1636), [AGL-1850](https://linear.app/aglyn/issue/AGL-1850), [AGL-1851](https://linear.app/aglyn/issue/AGL-1851), [AGL-2124](https://linear.app/aglyn/issue/AGL-2124), [AGL-1637](https://linear.app/aglyn/issue/AGL-1637))
- **api:** the datasets page stops promising unenforced record and storage quotas ([AGL-2302](https://linear.app/aglyn/issue/AGL-2302), [AGL-2253](https://linear.app/aglyn/issue/AGL-2253), [AGL-2296](https://linear.app/aglyn/issue/AGL-2296))
- **tools,console:** the SSO sweep script stops denying that a writer exists ([AGL-2254](https://linear.app/aglyn/issue/AGL-2254), [AGL-1210](https://linear.app/aglyn/issue/AGL-1210))
- **whats-new,api:** the batch reaches What's New, and a docblock stops lying ([AGL-2224](https://linear.app/aglyn/issue/AGL-2224))
- **selfhost,white-label,api:** four wrong rows, a missing page, a wrong contract ([AGL-2218](https://linear.app/aglyn/issue/AGL-2218), [AGL-2177](https://linear.app/aglyn/issue/AGL-2177), [AGL-2180](https://linear.app/aglyn/issue/AGL-2180), [AGL-2139](https://linear.app/aglyn/issue/AGL-2139))
- **console,besigner,workflows,forms:** four surfaces, and two stale pages ([AGL-2216](https://linear.app/aglyn/issue/AGL-2216))
- **media,commerce,marketplace:** three shipped screens get written down ([AGL-2215](https://linear.app/aglyn/issue/AGL-2215))
- **marketing:** popup frequency, the recipient count, and when a schedule fires ([AGL-2206](https://linear.app/aglyn/issue/AGL-2206))
- **analytics,console:** the traffic card, the growth figure and dwell time ([AGL-2203](https://linear.app/aglyn/issue/AGL-2203), [AGL-2160](https://linear.app/aglyn/issue/AGL-2160), [AGL-2182](https://linear.app/aglyn/issue/AGL-2182))
- **billing,console:** bandwidth gets a page, and the meter gets a help tip ([AGL-2201](https://linear.app/aglyn/issue/AGL-2201), [AGL-2070](https://linear.app/aglyn/issue/AGL-2070))
- **staff-console:** coupons and the do-not-contact list get documented ([AGL-2199](https://linear.app/aglyn/issue/AGL-2199))
- **selfhost:** scope the Linear key to "Create issues" on one team ([AGL-2185](https://linear.app/aglyn/issue/AGL-2185))
- **guides:** the Marketplace walkthrough carries its shot list ([AGL-2129](https://linear.app/aglyn/issue/AGL-2129), [AGL-2123](https://linear.app/aglyn/issue/AGL-2123), [AGL-773](https://linear.app/aglyn/issue/AGL-773))
- **guides:** the Marketplace gets the beginner half of the ladder ([AGL-2129](https://linear.app/aglyn/issue/AGL-2129))
- **marketplace:** the switchboard is Plugins, and the docs said both ([AGL-2123](https://linear.app/aglyn/issue/AGL-2123), [AGL-800](https://linear.app/aglyn/issue/AGL-800), [AGL-1599](https://linear.app/aglyn/issue/AGL-1599))

<details>
<summary>Also in this release: 20 test, 3 chore</summary>

- **aglyn:** classify the stock-reconciliation marker the catch-all leaves open ([AGL-2365](https://linear.app/aglyn/issue/AGL-2365), [AGL-2358](https://linear.app/aglyn/issue/AGL-2358), [AGL-2038](https://linear.app/aglyn/issue/AGL-2038), [AGL-1775](https://linear.app/aglyn/issue/AGL-1775), [AGL-2042](https://linear.app/aglyn/issue/AGL-2042), [AGL-2324](https://linear.app/aglyn/issue/AGL-2324))
- **aglyn:** the success-manager mailer takes its self-host ratchet row ([AGL-2365](https://linear.app/aglyn/issue/AGL-2365), [AGL-2332](https://linear.app/aglyn/issue/AGL-2332))
- **console:** the quota sweep's negative control names its one string mention ([AGL-2365](https://linear.app/aglyn/issue/AGL-2365), [AGL-1278](https://linear.app/aglyn/issue/AGL-1278))
- **console:** the photo-route spec runs the real CDN-path check ([AGL-2365](https://linear.app/aglyn/issue/AGL-2365), [AGL-2286](https://linear.app/aglyn/issue/AGL-2286))
- **console:** two webhook suites get the after() double the other eight have ([AGL-2365](https://linear.app/aglyn/issue/AGL-2365), [AGL-2346](https://linear.app/aglyn/issue/AGL-2346))
- **aglyn:** the branding guard can see the four account-scoped senders ([AGL-2326](https://linear.app/aglyn/issue/AGL-2326), [AGL-2352](https://linear.app/aglyn/issue/AGL-2352), [AGL-2319](https://linear.app/aglyn/issue/AGL-2319))
- **console:** the staff-mention guard counts the brand, not the literal ([AGL-2365](https://linear.app/aglyn/issue/AGL-2365), [AGL-847](https://linear.app/aglyn/issue/AGL-847), [AGL-2319](https://linear.app/aglyn/issue/AGL-2319), [AGL-2153](https://linear.app/aglyn/issue/AGL-2153))
- **console:** the password-reset spec carries the brand and the cost meter ([AGL-2365](https://linear.app/aglyn/issue/AGL-2365), [AGL-2319](https://linear.app/aglyn/issue/AGL-2319), [AGL-1438](https://linear.app/aglyn/issue/AGL-1438))
- **console:** five brand-aware card specs mock the branding hook ([AGL-2365](https://linear.app/aglyn/issue/AGL-2365), [AGL-2319](https://linear.app/aglyn/issue/AGL-2319))
- **tools:** baseline the one row AGL-2309 added while the sweep was running ([AGL-2309](https://linear.app/aglyn/issue/AGL-2309), [AGL-2319](https://linear.app/aglyn/issue/AGL-2319))
- **aglyn:** the branding guard covers the tab title and stops blinding itself ([AGL-2311](https://linear.app/aglyn/issue/AGL-2311), [AGL-2270](https://linear.app/aglyn/issue/AGL-2270), [AGL-2286](https://linear.app/aglyn/issue/AGL-2286))
- **shared:** pin deepmerge-ts's contract at the vendor boundary that owns it ([AGL-2301](https://linear.app/aglyn/issue/AGL-2301))
- **console:** the lockdown sweep reads a RETURN, not an import line ([AGL-1506](https://linear.app/aglyn/issue/AGL-1506))
- **tools:** re-baseline the brand ratchet, three stale rows and two corrected counts ([AGL-2281](https://linear.app/aglyn/issue/AGL-2281), [AGL-2278](https://linear.app/aglyn/issue/AGL-2278), [AGL-2279](https://linear.app/aglyn/issue/AGL-2279), [AGL-2260](https://linear.app/aglyn/issue/AGL-2260), [AGL-2016](https://linear.app/aglyn/issue/AGL-2016))
- **console:** the content-entry mock stops being a closed world ([AGL-2274](https://linear.app/aglyn/issue/AGL-2274), [AGL-2195](https://linear.app/aglyn/issue/AGL-2195), [AGL-2103](https://linear.app/aglyn/issue/AGL-2103), [AGL-2105](https://linear.app/aglyn/issue/AGL-2105), [AGL-2106](https://linear.app/aglyn/issue/AGL-2106))
- **console:** two usage-sweep doubles learn to page ([AGL-2271](https://linear.app/aglyn/issue/AGL-2271), [AGL-2220](https://linear.app/aglyn/issue/AGL-2220))
- **assist:** two guards that were satisfied by the wrong thing ([AGL-2245](https://linear.app/aglyn/issue/AGL-2245))
- **console:** the downgrade confirm gate is driven, not just declared ([AGL-2233](https://linear.app/aglyn/issue/AGL-2233), [AGL-1859](https://linear.app/aglyn/issue/AGL-1859))
- **renderer:** a published document keeps its alias spelling AND its styling ([AGL-2207](https://linear.app/aglyn/issue/AGL-2207), [AGL-2208](https://linear.app/aglyn/issue/AGL-2208))
- **console:** a besigner document source may not seed an sx alias ([AGL-2210](https://linear.app/aglyn/issue/AGL-2210), [AGL-2208](https://linear.app/aglyn/issue/AGL-2208), [AGL-1346](https://linear.app/aglyn/issue/AGL-1346), [AGL-2116](https://linear.app/aglyn/issue/AGL-2116))
- **tools:** assert the demo org is several businesses, not one cloned ([AGL-1734](https://linear.app/aglyn/issue/AGL-1734), [AGL-1822](https://linear.app/aglyn/issue/AGL-1822), [AGL-1816](https://linear.app/aglyn/issue/AGL-1816))
- **release:** regenerate the lockfile for 1.0.0-beta.2 ([AGL-2108](https://linear.app/aglyn/issue/AGL-2108))
- **console:** the Assist specs ask for the button, not the label ([AGL-2128](https://linear.app/aglyn/issue/AGL-2128), [AGL-1988](https://linear.app/aglyn/issue/AGL-1988), [AGL-1934](https://linear.app/aglyn/issue/AGL-1934))

</details>

## v1.0.0-beta.2 — 2026-08-19

[Compare with the previous release](https://github.com/aglyn/aglyn/compare/origin/production...v1.0.0-beta.2)

### Added

- **console:** the 404 self-diagnosis stops being a curl ([AGL-2119](https://linear.app/aglyn/issue/AGL-2119), [AGL-1993](https://linear.app/aglyn/issue/AGL-1993), [AGL-847](https://linear.app/aglyn/issue/AGL-847))
- **console,plugins:** an enforced quota is visible before it refuses ([AGL-2113](https://linear.app/aglyn/issue/AGL-2113), [AGL-1290](https://linear.app/aglyn/issue/AGL-1290), [AGL-1716](https://linear.app/aglyn/issue/AGL-1716))

### Fixed

- **console:** the erasure queue is reachable, and GET stops deleting ([AGL-2165](https://linear.app/aglyn/issue/AGL-2165), [AGL-2062](https://linear.app/aglyn/issue/AGL-2062))
- **console:** broadcast and firestore-export record why ([AGL-2162](https://linear.app/aglyn/issue/AGL-2162))
- **console:** a downgrade stops cancelling the coupon that retained the customer ([AGL-2146](https://linear.app/aglyn/issue/AGL-2146))
- **bookings:** the paid-booking checkout gets its idempotency key ([AGL-2147](https://linear.app/aglyn/issue/AGL-2147), [AGL-1697](https://linear.app/aglyn/issue/AGL-1697))
- **commerce:** refuse a sale the store's own tax settings cannot be honoured for ([AGL-2145](https://linear.app/aglyn/issue/AGL-2145))
- **console:** a downgrade that already happened stops calling itself pending ([AGL-2144](https://linear.app/aglyn/issue/AGL-2144))
- **stripe:** the Connect destination the merchant-readiness handler needs ([AGL-2122](https://linear.app/aglyn/issue/AGL-2122), [AGL-1997](https://linear.app/aglyn/issue/AGL-1997), [AGL-1551](https://linear.app/aglyn/issue/AGL-1551), [AGL-2120](https://linear.app/aglyn/issue/AGL-2120))
- **console:** the tier ladder gets a guard, and stops recommending a downgrade ([AGL-2142](https://linear.app/aglyn/issue/AGL-2142), [AGL-1859](https://linear.app/aglyn/issue/AGL-1859), [AGL-1117](https://linear.app/aglyn/issue/AGL-1117))
- **marketplace:** an abandoned transfer reversal is recorded, not lost ([AGL-2140](https://linear.app/aglyn/issue/AGL-2140))
- **console:** marketplace sales tax reaches the tax return ([AGL-2137](https://linear.app/aglyn/issue/AGL-2137))
- **console:** the self-serve winback runs the margin guardrail ([AGL-2118](https://linear.app/aglyn/issue/AGL-2118))
- **aglyn:** a malformed fee override falls back to the plan rate, never 0 ([AGL-2114](https://linear.app/aglyn/issue/AGL-2114), [AGL-1543](https://linear.app/aglyn/issue/AGL-1543))
- **commerce:** a coupon and a gift card both reach the cart session ([AGL-2112](https://linear.app/aglyn/issue/AGL-2112), [AGL-1714](https://linear.app/aglyn/issue/AGL-1714))
- **commerce:** POS card sales carry the platform fee ([AGL-2110](https://linear.app/aglyn/issue/AGL-2110), [AGL-2111](https://linear.app/aglyn/issue/AGL-2111))
- **marketplace:** a session redelivery no longer erases a refund ([AGL-2109](https://linear.app/aglyn/issue/AGL-2109))
- **console:** staff impersonation records why ([AGL-2125](https://linear.app/aglyn/issue/AGL-2125))
- **cloud:** the AGL-2038 authoring test calls the parser that replaced its constant ([AGL-2038](https://linear.app/aglyn/issue/AGL-2038), [AGL-2138](https://linear.app/aglyn/issue/AGL-2138), [AGL-2002](https://linear.app/aglyn/issue/AGL-2002))
- **console:** a winback we cannot price is not reported as a priced save ([AGL-1865](https://linear.app/aglyn/issue/AGL-1865))
- **console:** a subscription chargeback reverses the revenue row ([AGL-2120](https://linear.app/aglyn/issue/AGL-2120), [AGL-1787](https://linear.app/aglyn/issue/AGL-1787))
- **console:** the winback offer stops eating the promo it was meant to add to ([AGL-2117](https://linear.app/aglyn/issue/AGL-2117))
- **console:** the surface-coverage guard stops counting a mention as a caller ([AGL-2115](https://linear.app/aglyn/issue/AGL-2115), [AGL-1900](https://linear.app/aglyn/issue/AGL-1900), [AGL-1947](https://linear.app/aglyn/issue/AGL-1947))
- **tools:** the colour ratchet reads what git tracks, not what is on disk ([AGL-2109](https://linear.app/aglyn/issue/AGL-2109), [AGL-2025](https://linear.app/aglyn/issue/AGL-2025), [AGL-2002](https://linear.app/aglyn/issue/AGL-2002), [AGL-2026](https://linear.app/aglyn/issue/AGL-2026))
- **deps:** cloud/functions had no brace-expansion override at all ([AGL-2107](https://linear.app/aglyn/issue/AGL-2107))
- **deps:** the brace-expansion override band never covered 1.x or 2.x ([AGL-2107](https://linear.app/aglyn/issue/AGL-2107), [AGL-2051](https://linear.app/aglyn/issue/AGL-2051), [AGL-2089](https://linear.app/aglyn/issue/AGL-2089), [AGL-2108](https://linear.app/aglyn/issue/AGL-2108))

### Documentation

- **handoff:** promoted, deployed and tagged v1.0.0-beta.1 — and the gate's blind spot
- **runbooks:** the support runbook exists, and the breach one stops 404ing ([AGL-2141](https://linear.app/aglyn/issue/AGL-2141))

<details>
<summary>Also in this release: 4 test</summary>

- **console:** the no-community sweep exempts the support runbook ([AGL-2141](https://linear.app/aglyn/issue/AGL-2141))
- **console:** no two routes may share a page_title ([AGL-2164](https://linear.app/aglyn/issue/AGL-2164), [AGL-2060](https://linear.app/aglyn/issue/AGL-2060), [AGL-2087](https://linear.app/aglyn/issue/AGL-2087), [AGL-1059](https://linear.app/aglyn/issue/AGL-1059))
- **console:** the free tier's cap is proven through report-usage itself ([AGL-2135](https://linear.app/aglyn/issue/AGL-2135))
- **console,docs:** the funnel's four GA4 events could all be deleted silently ([AGL-1865](https://linear.app/aglyn/issue/AGL-1865))

</details>

## v1.0.0-beta.1 — 2026-08-18

### Added

- **tools:** real repo versioning — semver bump, release tags, generated CHANGELOG ([AGL-2089](https://linear.app/aglyn/issue/AGL-2089), [AGL-1776](https://linear.app/aglyn/issue/AGL-1776), [AGL-1777](https://linear.app/aglyn/issue/AGL-1777))
- **console:** tell a publisher what Aglyn keeps, where they set the price ([AGL-2078](https://linear.app/aglyn/issue/AGL-2078))
- **console:** the scope-drift repair gets somewhere for a human to perform it ([AGL-2062](https://linear.app/aglyn/issue/AGL-2062))
- **console,billing:** the usage budget is a card a customer can actually set and see ([AGL-1528](https://linear.app/aglyn/issue/AGL-1528))
- **console:** the review queue can LIST a plugin, the step that makes it installable ([AGL-2059](https://linear.app/aglyn/issue/AGL-2059))
- **console,billing:** budget alerts fire from the cron, and every usage alert now actually emails ([AGL-1528](https://linear.app/aglyn/issue/AGL-1528), [AGL-2052](https://linear.app/aglyn/issue/AGL-2052), [AGL-1371](https://linear.app/aglyn/issue/AGL-1371))
- **console:** a private file can finally be fetched — the DAM calls the signing route ([AGL-2055](https://linear.app/aglyn/issue/AGL-2055), [AGL-1051](https://linear.app/aglyn/issue/AGL-1051))
- **console,billing:** per-org usage budgets — the GCP billing-budget shape, in one pure module ([AGL-1528](https://linear.app/aglyn/issue/AGL-1528), [AGL-1371](https://linear.app/aglyn/issue/AGL-1371))

### Fixed

- **docs,analytics:** docs.aglyn.com stamps our own reading too ([AGL-2064](https://linear.app/aglyn/issue/AGL-2064), [AGL-1582](https://linear.app/aglyn/issue/AGL-1582), [AGL-1595](https://linear.app/aglyn/issue/AGL-1595))
- **console,tenant,analytics:** localhost and preview builds stop reporting into the live property ([AGL-2067](https://linear.app/aglyn/issue/AGL-2067), [AGL-1608](https://linear.app/aglyn/issue/AGL-1608), [AGL-1979](https://linear.app/aglyn/issue/AGL-1979), [AGL-2087](https://linear.app/aglyn/issue/AGL-2087))
- **tenant:** the platform version headers leaked through white-label ([AGL-2088](https://linear.app/aglyn/issue/AGL-2088))
- **tenant:** the provider-free status page is legible in dark mode ([AGL-2074](https://linear.app/aglyn/issue/AGL-2074))
- **console,analytics:** every route titles itself, and a guard that says so ([AGL-2060](https://linear.app/aglyn/issue/AGL-2060), [AGL-1059](https://linear.app/aglyn/issue/AGL-1059))
- **tenant:** a customer site never falls through to the framework's error page ([AGL-2074](https://linear.app/aglyn/issue/AGL-2074), [AGL-131](https://linear.app/aglyn/issue/AGL-131), [AGL-1354](https://linear.app/aglyn/issue/AGL-1354))
- **console,analytics:** page_view reports the page, not the notification count ([AGL-2060](https://linear.app/aglyn/issue/AGL-2060))
- **console,analytics:** a browser we declare ours stays ours, whoever signs in ([AGL-2065](https://linear.app/aglyn/issue/AGL-2065), [AGL-1582](https://linear.app/aglyn/issue/AGL-1582), [AGL-664](https://linear.app/aglyn/issue/AGL-664))
- **tenant,analytics:** the marketing surface stamps our own traffic ([AGL-2064](https://linear.app/aglyn/issue/AGL-2064), [AGL-1582](https://linear.app/aglyn/issue/AGL-1582))
- **repo:** the Webfile number is operator config, not a handoff note ([AGL-2053](https://linear.app/aglyn/issue/AGL-2053), [AGL-2021](https://linear.app/aglyn/issue/AGL-2021))
- **console,billing:** the free site limit is claimed transactionally, not counted then written ([AGL-2063](https://linear.app/aglyn/issue/AGL-2063))
- **console,assist:** the free assist cap is spent before the tokens, not after ([AGL-2057](https://linear.app/aglyn/issue/AGL-2057))
- **commerce:** the Analytics tab asks the entitlement its own dashboard widget asks ([AGL-2056](https://linear.app/aglyn/issue/AGL-2056), [AGL-1938](https://linear.app/aglyn/issue/AGL-1938))
- **deps,console:** monaco-editor 0.56.0 replaces the DOMPurify 3.2.7 we serve ([AGL-2051](https://linear.app/aglyn/issue/AGL-2051), [AGL-1779](https://linear.app/aglyn/issue/AGL-1779))
- **aglyn,tenant,console:** operator identity is configuration, and a DMCA notice reaches whoever actually hosts the content ([AGL-2016](https://linear.app/aglyn/issue/AGL-2016), [AGL-2021](https://linear.app/aglyn/issue/AGL-2021), [AGL-2037](https://linear.app/aglyn/issue/AGL-2037), [AGL-2022](https://linear.app/aglyn/issue/AGL-2022), [AGL-2014](https://linear.app/aglyn/issue/AGL-2014), [AGL-2017](https://linear.app/aglyn/issue/AGL-2017))
- **console:** gate the billing webhook on livemode ([AGL-2040](https://linear.app/aglyn/issue/AGL-2040), [AGL-547](https://linear.app/aglyn/issue/AGL-547), [AGL-1951](https://linear.app/aglyn/issue/AGL-1951))
- **console,billing:** metered storage bills by default; the cap is the customer's ([AGL-1886](https://linear.app/aglyn/issue/AGL-1886), [AGL-1957](https://linear.app/aglyn/issue/AGL-1957))
- **console:** the tenant apex is configuration, not our infrastructure ([AGL-2022](https://linear.app/aglyn/issue/AGL-2022), [AGL-1919](https://linear.app/aglyn/issue/AGL-1919))
- **ci:** the emulator-guards runner works on Linux too, not just macOS ([AGL-2002](https://linear.app/aglyn/issue/AGL-2002))
- **marketing:** the POS register allowance is PER SITE in the generated pricing tables ([AGL-1279](https://linear.app/aglyn/issue/AGL-1279), [AGL-1775](https://linear.app/aglyn/issue/AGL-1775), [AGL-2034](https://linear.app/aglyn/issue/AGL-2034))
- **console:** keep the org identity when merging the billing doc ([AGL-1991](https://linear.app/aglyn/issue/AGL-1991), [AGL-1028](https://linear.app/aglyn/issue/AGL-1028), [AGL-1527](https://linear.app/aglyn/issue/AGL-1527))
- **cloud:** the rules suite was dead at import, on the same parser bug as AGL-2004 ([AGL-2004](https://linear.app/aglyn/issue/AGL-2004), [AGL-2002](https://linear.app/aglyn/issue/AGL-2002))
- **repo:** synthesise the personal data committed to a public repo ([AGL-2029](https://linear.app/aglyn/issue/AGL-2029), [AGL-2021](https://linear.app/aglyn/issue/AGL-2021))
- **aglyn:** retire the stale addBusinessDays disambiguation, and a type predicate that lied ([AGL-1983](https://linear.app/aglyn/issue/AGL-1983))
- **console:** the TX registration is operator config, not public source ([AGL-2021](https://linear.app/aglyn/issue/AGL-2021))

### Changed

- **console:** one shared inverse for the unread tab badge ([AGL-2060](https://linear.app/aglyn/issue/AGL-2060))
- **cloud:** one comment stripper for one bug, shared shape with AGL-2004 ([AGL-2004](https://linear.app/aglyn/issue/AGL-2004))

### Documentation

- **analytics:** the page_title dimension, both defects and what is left ([AGL-2060](https://linear.app/aglyn/issue/AGL-2060))
- **handoff:** close 2026-08-18 — the decisions, the restated mandate, six agents in flight
- **claude:** /release carries the 2026-08-18 restated mandate verbatim

<details>
<summary>Also in this release: 4 test, 1 ci</summary>

- **console:** the no-community sweep exempts a verbatim quote, narrowly ([AGL-2066](https://linear.app/aglyn/issue/AGL-2066), [AGL-975](https://linear.app/aglyn/issue/AGL-975))
- **console:** stub the budget card in the lockdown spec, and document the budget env vars ([AGL-1528](https://linear.app/aglyn/issue/AGL-1528), [AGL-1957](https://linear.app/aglyn/issue/AGL-1957))
- **tenant:** the quarantine upload spec follows the constant that became config ([AGL-2016](https://linear.app/aglyn/issue/AGL-2016))
- **guards:** the rules suite and 18 emulator specs get a workflow that runs them ([AGL-1778](https://linear.app/aglyn/issue/AGL-1778), [AGL-1804](https://linear.app/aglyn/issue/AGL-1804), [AGL-2002](https://linear.app/aglyn/issue/AGL-2002))
- **cloud:** the host deny floor now names `registers`, the twice-clobbered one ([AGL-1354](https://linear.app/aglyn/issue/AGL-1354), [AGL-1367](https://linear.app/aglyn/issue/AGL-1367), [AGL-2002](https://linear.app/aglyn/issue/AGL-2002))

</details>

No release has been cut yet under this scheme. The first one will appear here.

Roughly 2000 issues of work predate it, and the deployed commit for each of
those cannot be established after the fact, so that history is deliberately
**not** reconstructed and **not** retroactively tagged. The [Linear
project](https://linear.app/aglyn/team/AGL) is the record for that period.

See [docs/RELEASING.md](docs/RELEASING.md) for how a release is cut (AGL-2089).
