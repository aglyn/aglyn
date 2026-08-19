# Changelog

Every released version of the Aglyn platform, newest first. A version names a
commit that was **promoted to `production` and verified deployed** — see
[docs/RELEASING.md](docs/RELEASING.md) for how one is cut.

This is the engineering record. The customer-facing changelog is published as
content on the marketing site and is written separately.

<!-- releases below -->

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
- **handoff:** close 2026-08-18 — Zach's decisions, the restated mandate, six agents in flight
- **claude:** /release carries Zach's 2026-08-18 restated mandate verbatim

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
