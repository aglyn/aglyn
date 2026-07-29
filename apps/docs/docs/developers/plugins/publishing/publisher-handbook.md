---
sidebar_position: 1
title: Publisher handbook
description: Publishing to the Aglyn marketplace — from profile setup through listing authoring, review, updates, and getting paid.
---

# Publisher handbook

Everything a community publisher needs. The developer side (building the
bundle) is the [first-plugin guide](../guides/first-plugin.md); this is
the marketplace side.

![The plugin review queue](/img/plugins/plugin-reviews.png)

## Before your first publish

1. **Publisher profile** (Marketplace → Profile) — your handle and
   display name appear on every listing. Publishing is **organization-owned**:
   the listing belongs to your organization, not your personal account.
2. **Publisher agreement** (Marketplace → Profile) — accept it once, on
   behalf of the organization. See
   [The publisher agreement](#the-publisher-agreement).
3. **Plan**: publishing requires a Pro plan.
4. **Payouts** (paid listings only): complete Stripe Connect onboarding
   from **Marketplace → Payouts**. The platform fee is 20% (30% on free
   plans).

## The publisher agreement

Your **organization** — not you personally — is the publishing party, so
the organization accepts the **Marketplace Publisher Agreement** once,
from **Marketplace → Profile**. Only an owner or admin can accept it,
because only they can bind the organization, and we record who accepted
it and when.

It is a different thing from the
[pre-publish checklist](#before-you-publish), and they are not
interchangeable:

| | Publisher agreement | Pre-publish checklist |
| --- | --- | --- |
| About | The relationship | The bytes in this bundle |
| Scope | Your organization | One version |
| Asked | Once, and again when the terms change | Every publish, including a republish of the same version number |

The summary shown above the accept button is the part that tends to
surprise people later — the license you grant us to host, verify and
distribute; what you warrant about each version; that you cannot recall
code already installed; that we can disable a version everywhere without
notice if it looks dangerous; that review is a safety screen and not an
endorsement; and that on paid listings you are the seller. Read the full
agreement before accepting.

**If we change the agreement, publishing stops** until someone who can
bind your organization reads and accepts the new version. An older
acceptance is never carried forward — that is the whole reason the
agreement is versioned. Nothing already published is affected, and
reviewers can see which version each publisher is under.

## Where to publish from

Publishing lives at the organization level — **Marketplace → Publish**. Pick
a **source site**, then what to publish:

- **A component** — a reusable component from that site.
- **A layout** — a published layout from that site.
- **A dataset schema** — the field model of one of your organization's
  datasets. **Records are never published** — only the structure travels.
- **An email template** — a transactional email you've designed for that site
  (only emails that already have a saved design are offered).
- **This entire site** — its published screens and theme, as an installable
  template.

Dataset schemas are the one exception to the source-site picker: datasets
belong to the organization rather than to a site, so the picker is hidden and
the schema publishes from the org directly.

![Publishing from the organization Marketplace](/img/guides/marketplace-publish.png)

The per-site shortcuts still exist for convenience — the **Publish** actions
on a site's **Components** and **Layouts** pages, and **Publish as template**
on the **Setup** page — and open the same listing form.

### What installing each type does

Installing never changes a running site. What that means per type:

| Type | Where it lands | Live immediately? |
| --- | --- | --- |
| Component | The site's components | Yes, once you place it |
| Layout / Site template | The site's **Templates** library | No |
| Plugin | An org or per-site version pin | Yes |
| Dataset schema | A **new, empty** dataset in the org | Yes (it's new) |
| Email template | A **draft version** of that email | No |

Two details worth knowing before you publish one:

- A **dataset schema** installs as a brand-new dataset every time; it never
  merges into an existing one, since a schema change over existing rows would
  reinterpret live data. `reference` fields are relinked to the installing
  organization's datasets **by display name**, and any that can't be matched
  are degraded to plain text — the installer is told which ones.
- An **email template** installs as an inactive version of the same catalog
  email it was designed for. The site owner activates it in the email
  designer, so installing can't silently replace an email a site is already
  sending its customers. `emailHtml` blocks can't be published at all.

**Plugins are different**: a plugin is a code bundle, not a site artifact, so
it's published from your built bundle (below) rather than the source-site
picker.

## Publishing a version

Run the local verifier first — the publish API enforces the same checks
and rejects with the exact problem list:

```bash
node tools/scripts/verify-plugin-bundle.mjs dist/plugin.bundle.mjs manifest.json
```

The verifier parses your bundle rather than reading it as text, so it sees
what a source scan could not: property access computed at runtime on
`globalThis`/`window`/`document`, the `Function` constructor reached through
`.constructor()`, and `import()` with a specifier it cannot resolve. All of
those are refused.

**Declare every origin you call.** The verifier collects your `fetch`,
`XMLHttpRequest`, `WebSocket` and `sendBeacon` calls and diffs them against
`capabilities.network` in your manifest; an origin you call but do not
declare fails the publish. This is the same list your plugin's CSP is built
from, so an undeclared call would have been blocked at runtime anyway —
failing here means you find out at publish time instead of in production.
A URL your code only knows at runtime cannot be checked, so it is reported
as a warning and a reviewer will ask about it.

Calling through a local name does not change the answer: `const f = fetch`,
`const d = globalThis.fetch` and `const {fetch: h} = globalThis` are all
resolved back to `fetch`, and a URL kept in a constant — a plain string, a
template, or a concatenation of them — is read rather than shrugged at. What
is not read is a name that gets reassigned, shadowed by a parameter or
declared twice; there the value at the call site would be a guess, so the
call is reported as a URL known only at runtime.

If you hand a URL to a helper the checker cannot follow, it says so rather
than reporting no network calls — so declare the origins your plugin talks to
and the row goes quiet on its own.

Pass the manifest (as above, or leave it beside your bundle or one level up)
or the network checks can only warn locally while the publish API still
rejects.

It also warns — without failing — about things a reviewer will want
explained: machine-obfuscated `_0x…` identifiers, large embedded base64
blobs, and a bundle that is one unreadably long line. Minified code is fine;
these are the shapes minifiers do not produce.

The output lists **every area it checked**, not only the ones with findings,
with the same four states a reviewer sees on your submission:

| | Meaning |
| -- | -- |
| `✓` | The check ran and found nothing |
| `✕` | A refusal — the publish will fail |
| `?` | Worth explaining, but not a refusal |
| `—` | **Not checked.** Something stopped the check from running — a bundle that would not parse, or a network diff with no manifest |

A `—` is not a pass. If you see one, fix what stopped the check before you
submit, or a reviewer will ask you the same question with days of queue in
between.

Then publish it from the console: **Marketplace → Publish**, choose
**"A plugin (upload a bundle)"**, and follow **Publish a plugin…** to
`/<your-org>/marketplace/publish/plugin`. It is a page, not a dialog, so
you can link it, reload it, and leave it half-finished — what you have
typed is kept as a **local draft** until you publish or discard it.

The one thing the draft cannot keep is your **bundle and manifest
files**: a browser will not let a page hold a file across a reload, so
you re-choose them, and the page says so rather than pretending it is
ready to publish.

The sections are: **bundle and manifest** (choose the file or paste the
JSON), **listing** (name, description, category, README, changelog,
repository URL, license), **who can install it and for how much**, and
the pre-publish checklist. Publishing always publishes **sandboxed** — a reviewer
verifies and signs a version before it can run trusted.

The **README** here is the same rich-text editor you get when you edit the
listing later — toolbar, media picker, and a **Markdown source** toggle for
when you are pasting a README you wrote elsewhere. It is the document
reviewers read first and buyers read before running third-party code, so
it is worth the room.

Paste a repository README as-is. The editor renders **two heading sizes**
and clamps every `#` run onto them, so the `# Project Name` a README opens
with becomes the larger heading and `####` or deeper become the smaller
one — you do not have to re-level anything by hand.

The **changelog** has two audiences, and it is worth writing for both: the
reviewer, who compares this version against the last approved one, and
every installer who reads it on your listing's changelog tab before
deciding to update. On a **first** version there is nothing to compare
against — say what the plugin does instead, or leave it empty.

### Before you publish

The last section of the page asks you to confirm a short checklist, in
full view of the publish button, and **publishing is blocked until you
do**:

- The repository URL is public and contains the source for this bundle
- A license is included and you have the right to publish this code
- The README documents what data the plugin reads, stores or sends, and
  where it goes
- Every declared network host is required — the ones you don't use are
  gone
- You have tested **this version** on a site you control
- The changelog describes what changed since the last version — asked
  only when you're updating an existing listing

The first item has a field to go with it: **Repository URL** is asked
for on the publish form itself, and publishing is refused if you confirm
the item without filling it in — an attestation about a repository we
never collected is a statement about nothing. It's recorded on the
version too, so a reviewer opening v1.0.2 gets the repo you declared for
*those* bytes, even if you move the code later.

These aren't paperwork. They're the questions that send most submissions
back, so answering them up front is the fastest route through the queue.
Your answers are recorded against **that exact bundle** with your name
and the date, and the reviewer sees them beside their own checklist —
which also means republishing the same version number asks again, because
the bytes changed.

Each publish uploads your bundle (content-addressed by sha256 —
**immutable**; a new build is a new object), writes a version document
with your manifest and changelog, and bumps the listing's
`latestVersion`. To ship an update, bump `version` in the manifest and
upload again — see [Shipping a new version](#shipping-a-new-version).
There's a daily publish cap per publisher.

## Review: what happens after you publish

New plugin listings enter the queue as **submitted** and don't appear in
public browse until staff **list** them. Reviewers see your listing
content, declared capabilities, and a fresh static-verification run.
Outcomes:

- **Listed** — publicly browsable.
- **Verified ✅** — listed plus the quality badge.
- **Rejected** — you're notified with the reason; fix and republish.
- **Realm trust** (separate, rare): staff may additionally sign a version
  so it runs in the app realm instead of the sandbox — first-party-grade
  placement for plugins that earn it.

Speed the review up: a real README, a license, sane `capabilities`
(request only the network origins you use), and working links — which is
exactly what the pre-publish checklist above asks you to confirm. A
confirmation that turns out to be false is a dated statement by a named
publisher, and it's grounds for removal.

### Testing a version before it is approved

You can install **your own** unapproved version, on your own sites. That is
deliberate — the checklist asks you to confirm you tested *these exact
bytes*, and you cannot test a version you cannot install. Nobody else can
install it until a reviewer approves it, and a private listing is invisible
to everyone else regardless.

The install says so when that is what it is: the button reads **Install
unreviewed vX for testing**, and the confirmation spells out the part worth
pausing on — **every site you can install to is publicly reachable**. There
is no staging site here, so an unreviewed bundle installed to a real site
serves real visitors until you uninstall it. Prefer a site with no traffic,
and uninstall when you are done.

Your listing's **Review status** card warns you when an unapproved version
still has live installs, so a test install cannot quietly become permanent.

### Watching your own submission

Open your own listing and the **Review status** card — visible only to
you — answers what an email cannot:

- **Which version installs today**, from the newest *approved* version
  rather than the newest one you published. When they differ it says so:
  *"v1.0.3 is in review. New installs get v1.0.2 until it is approved,
  and anyone already running it stays where they are."*
- **Every version's state** in words — *In review*, *Approved*,
  *Rejected*, or *Published before review* for versions that predate
  per-version review and so carry no verdict at all.
- **Why a version was rejected**, on the version it belongs to.
- **What you confirmed** on the pre-publish checklist for those exact
  bytes, so you can see the claims you already made before making them
  again.

Two things it states that you would otherwise have to infer:

- **Editing your listing while a version is in review changes nothing
  about the review.** Name, description, README, screenshots and links go
  through a different path, because approval is about the bundle's bytes.
- **The bytes are never edited.** Changing them means publishing a new
  version — there is no "resubmit" for a rejected one.

**A rejection does not uninstall anything.** If you installed the version
to test it — which you are encouraged to do, and which only your own
organization can do before review — that install keeps running the
rejected bytes on your site. The rejection notice tells you when this
applies to you; uninstall it or roll back to an approved version. Review
can also stop a version outright, and then every site pinned to it renders
a placeholder instead of the plugin.

## Private plugins

Choose **Only this organization** under *Who can install this* when you
upload, and the listing becomes **private**: never browsable in the
marketplace by anyone, and installable only by your own organization's
sites. That last part is enforced when the install is requested, not by
hiding the page — knowing a private listing's id gets a stranger nowhere.

Private changes the **audience, not the bar**. Your bundle still runs on
Aglyn infrastructure and still reaches the host ABI, so it goes through
the same queue, the same reviewer checklist, the same static verifier,
and the same super-staff signature if it ever needs realm trust. Staff
see private submissions in the queue marked *Private*.

Private plugins are always free, and you find yours under
**Marketplace → Listings** rather than in Browse — **View** opens the
same detail page you install from.

**Going public later** takes no re-review: the bytes were already
approved, and who may install them was never part of that approval. It
does ask for what any marketplace listing needs first — a description, a
README, and a license — via **Make public** on the Listings row. Going
back to private is always available and takes effect immediately.

## Authoring your listing

Your listing IS your storefront — it renders on the detail page every
buyer sees. Editable at publish time or any time after, no republish
needed: open **Edit listing** on your own listing's detail page (the
whole page becomes the editor), or use the **Edit** action on
**Marketplace → Listings**.

| Field | Guidance |
| --- | --- |
| Name | The display name on every browse card and at the top of the detail page; ≤80 chars. A typo here is fixable without republishing — leaving it blank keeps the current name rather than clearing it. |
| Description | The one-line summary under the name on browse cards; ≤500 chars. |
| Body (About) | The main docs: what it does, setup, what it adds, data & permissions. Rich-text editor with headings, bold/italic, links, and inline images; ≤20k chars. |
| Preview image | The hero shown on browse cards and at the top of the detail page — pick it from your media library. |
| Logo | Square; pick from the media library or paste an https URL. |
| Screenshots | Up to 6, from the media library or https URLs; the detail page shows a gallery with click-to-zoom. |
| Categories | Up to 3 from the fixed taxonomy. |
| License | Short label (e.g. `MIT`) — listings without one get flagged in review. |
| Homepage / repository | Public links build trust; reviewers check them. The repository is asked for at publish and required — editing it here changes the listing, not what past versions declared. |

Be explicit about **data & permissions** in the README: what your plugin
reads/writes and every host in your manifest's network allowlist —
unverified sandbox listings show buyers a risk disclaimer, and good docs
are what overcomes it.

## Versioning & updates

### Shipping a new version

**Publish new version** on your listing — the button on the listing's own
detail page, or the action in the row menu on **Marketplace → Listings**.
It opens the same publish page bound to that listing, so you upload the
new bundle and manifest and write a changelog rather than describing a
listing you already own; name, description, README, license, repository
and price arrive filled in from the listing and are yours to edit.

What the page tells you, because it is the part worth knowing: **the
version that installs today keeps installing** until a reviewer approves
the new one. Nobody is upgraded onto unreviewed code, and nothing you
publish can change a version somebody already has.

Two things it will stop you on:

- **A mismatched manifest `id`.** An update is recognised by your
  publisher organization plus the manifest `id` — so a bundle carrying a
  different `id` would create a *separate listing*, not a new version.
  The page says so and refuses rather than letting you find out from a
  duplicate listing you cannot un-publish the bytes of.
- **The changelog confirmation.** On an update the pre-publish checklist
  asks for it up front, because here we know it applies.

**Who can install it** is fixed when the listing is created and a new
version never changes it — change that from the listing itself.

- Artifacts are immutable and installs pin `{version, sha256}` — you can
  never change the code a consumer runs; ship a new version instead.
- Users update explicitly (an *Update to vX* action appears when your
  `latestVersion` passes their pin). Write a changelog every publish —
  it renders in the detail page's **Version history** card, where every
  published version is listed with its changelog, a **Latest** marker,
  and a **Realm-trusted** chip on versions that carry it. That card is
  what a cautious buyer reads before installing, so a thin changelog
  costs you installs.
- Declare `hostAbi` in your manifest; when the platform bumps its ABI
  you'll rebuild against the new template and publish a compatible
  version (installs warn, loaders refuse, until you do).

## How installs work (the buyer side)

Browse is a catalogue — cards link to the **detail page**, which is the
only place an install happens. The buyer picks targets (**all sites**,
**selected sites**, or org-wide for plugins), confirms a dialog that
names exactly where the install lands, and the pin is written: your
exact `{version, sha256}` pinned to the site or org, the plugin enabled
for the workspace, loaded on their next visit. Buyers can uninstall from
the listing's own detail page (**Uninstall**, or **Uninstall org-wide**
for an org-scope pin) as well as from **Marketplace → Installed** —
removing the pin and disabling it. **Data your plugin created stays**, so
reinstalls resume cleanly. Paid listings require purchase before install;
you see sales in your publisher ledger.

The detail page shows two install figures side by side: **installs** is
the cumulative all-time total and only ever grows, while **active**
counts the organizations and sites that currently hold a pin — it goes
down when someone uninstalls. A big gap between the two is churn worth
investigating.

Every listing shows its **artifact type** as a chip — Plugin, Component,
Site template, Layout, Dataset schema, or Email template — so buyers know
what they're getting before they open it. Dataset schemas and email
templates read **"Added (v1) · add again"** rather than "Installed",
because adding one creates a *new* dataset or a *new* draft email each
time; re-adding is a legitimate action, not a no-op.

**Ratings and comments**: any signed-in user can comment on your
listing; star ratings are reserved for verified-email accounts in an
organization that actually installed it. The publishing organization can
never rate or comment on its own listing.

## Getting paid

One-time prices in whole USD (up to $1000). Purchases flow through the
platform's Stripe; your share (80%, or 70% on free plans) pays out via
your Connect account. The Marketplace → Sales tab tracks every sale.
