# Changelog

Every released version of the Aglyn platform, newest first. A version names a
commit that was **promoted to `production` and verified deployed** — see
[docs/RELEASING.md](docs/RELEASING.md) for how one is cut.

This is the engineering record. The customer-facing changelog is published as
content on the marketing site and is written separately.

<!-- releases below -->

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
- **console:** the screen version view takes Zach's card spans, and Raw JSON collapses ([AGL-2486](https://linear.app/aglyn/issue/AGL-2486))
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
