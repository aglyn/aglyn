---
sidebar_position: 2
title: Cookie consent
description: Ask visitors before analytics runs — or track immediately where the law allows, with an always-available opt-out. Your Google Analytics and Tag Manager tags never load for a visitor whose recorded state does not grant them.
---

# Cookie consent

If your site uses **Google Analytics** or **Google Tag Manager**, Aglyn manages
visitor consent for you. The control is real, not decoration: whenever a
visitor's recorded state does not grant analytics, the script **never loads** —
it is not loaded and then suppressed.

## How it works

Consent UI appears only on sites that use a **consent-gated feature** — today, a
configured Google Analytics measurement ID or a Google Tag Manager container ID.
Either one is enough. A site with neither has nothing to consent to, so its
visitors never see anything.

Your site's **consent mode** (Site setup → SEO → Cookie consent) decides how
visitors are handled:

- **Geo-conditional** (recommended, and the behavior when you have never touched
  the setting): visitors in **prior-consent regions** — the EU/EEA, the UK, and any
  visitor whose region cannot be determined — see a consent banner first, and
  analytics loads only after they allow it. Visitors everywhere else (for example
  the US) are **tracked from their first visit** with no banner; their state is
  recorded as *implied consent*, and the persistent **Your Privacy Choices**
  control lets them opt out at any time.
- **Opt-in everywhere**: every visitor, everywhere, sees the prior-consent banner.

The banner offers **Allow**, **Decline**, and **Preferences** side by side — no
dark patterns, and declining is one click, same as allowing.

**Advertising is a second, separate question — and it is off until you turn it
on.** By default Aglyn asks your visitors about analytics and nothing else, and
tells Google that advertising storage is denied for every visitor, in both
directions. If you have Google Ads linked to your GA4 property and you need a
basis for advertising storage, turn on **Also ask visitors about advertising
storage** in **Site setup → SEO → Cookie consent**. The switch needs a Google
tag of some kind — a measurement ID or a container ID — to do anything; there is
no advertising storage to ask about without one.

Turning it on **grants nothing by itself**. It adds a second question, with its
own checkbox, to the banner and to the preferences panel, so that a visitor has
somewhere to say yes. Until one does, nothing changes — in either consent mode,
for visitors anywhere in the world.

Built-in Aglyn analytics are unaffected by all of this: the pageview beacon is
**cookieless** and stores no visitor identifier, so it needs no consent.

## What needs consent

**Consent-gated** — held back unless the visitor's recorded state grants analytics:

- **Google Analytics** (your configured measurement ID) and every event Aglyn
  sends to it — see [Google Analytics events](./google-analytics.md).
- **Google Tag Manager** (your configured container ID). The container is gated
  the same way and never more loosely, so it cannot be used to install a tag
  that runs before consent.
- **Core Web Vitals reporting**. Page-speed metrics reach your property only
  through the same tag, and are discarded rather than held if consent is
  refused while a page is open.
- **Cross-visit A/B test identity**: without an analytics grant, experiment variant
  assignment is remembered only for the visit (sessionStorage) instead of across
  visits.
- **Remembering the campaign a visitor first arrived from.** Reading the
  campaign on the click itself needs no grant; keeping it across visits does.
- **Advertising storage** (`ad_storage`, `ad_user_data`, `ad_personalization`),
  on sites that have turned the advertising question on. **Where it starts
  depends on the visitor's region**, and it is the same split analytics uses:
  - **Prior-consent regions.** The EU/EEA, the UK, and any visitor whose region
    cannot be determined see the banner first, and advertising storage is denied
    until they tick that specific box. Not objecting is never a yes here.
  - **Everywhere else.** Advertising runs from their first visit, alongside
    analytics, on the same implied basis — these visitors see no banner, and
    **Your Privacy Choices** is where they turn it off. That is the opt-out
    posture the Privacy Policy and the Cookie Policy both describe.
  - A visitor who **declines**, opts out, or arrives with a **Global Privacy
    Control** signal gets no advertising storage anywhere in the world. A
    refusal outranks the regional default; the default only ever fills a
    silence.
  - A visitor who clicked **Allow** on an analytics-only banner before you
    turned the question on reads as *never asked*, not as a yes. They see the
    new question the next time they are asked.
  - Advertising cannot outlive analytics. Unticking analytics while leaving
    advertising ticked is a refusal of both, and every refusal path — Decline,
    Decline all, an opt-out, a GPC signal — withdraws the two together. There
    is no state in which advertising is granted and analytics is not.
  - Switch the question back off and any advertising grants already on file
    stop counting immediately; they are re-derived on every read, not trusted
    as stored.

**Always on (strictly necessary)** — these keep working regardless of the choice,
because the site cannot function without them:

- Shopping cart and member sign-in cookies.
- Popup and announcement "don't show this again" stamps (stored locally, never
  transmitted).
- The stored consent state itself.

## Your Privacy Choices — the persistent control {#privacy-choices--the-persistent-control}

Whenever consent management is active, every page of your site shows a small
**Your Privacy Choices** control. Visitors use it to change their state **in
either direction** at any time — opt out after being tracked by default, or
allow analytics after declining. If your site asks about advertising, that
choice lives in the same panel, on its own checkbox. In geo-conditional mode
this control is the *only* opt-out surface visitors in implied-consent regions
see, which is why it is shown by the platform on every page rather than
depending on your template.

The wording is deliberate and you should not expect it to be configurable.
Once a site shares personal information for cross-context behavioral
advertising, California's CPRA requires an opt-out link with that exact title,
so Aglyn ships it as the title on every site rather than as a preference an
individual site could get wrong.

You can also link any element (a footer link, for example) to `#aglyn-consent` —
clicking it opens the same preferences panel.

## Where the choice is kept {#where-the-choice-is-kept}

A visitor's choice is stored in their **browser's local storage**, under a key
that includes your site's id. Three consequences worth knowing before you answer
a visitor's question about it:

- **It is per site.** A yes on one site is not a yes on another, even when the
  two share a preview address.
- **It does not expire.** Nothing re-asks a visitor on a schedule. Clearing site
  data resets them to undecided, and they are then handled by your consent mode
  as if for the first time.
- **What was granted is re-derived from the recorded decision on every read**,
  never trusted as a stored flag. That is why turning the advertising question
  off makes existing advertising grants stop counting immediately.

**Withdrawing consent removes the cookies too.** When a visitor opts out or
declines, Aglyn deletes the Google analytics and advertising cookies it can
reach (`_ga`, `_gid`, `_gcl` and their variants) across your domain and its
parent, and tells any tag still resident on the page to stop measuring. A
visitor who checks their cookie list after opting out sees them gone, which is
the behavior to describe if one asks.

## Global Privacy Control

Browsers can send the **Global Privacy Control** (GPC) signal. Aglyn honors it as
an **automatic opt-out**: a visitor sending GPC is never tracked by default, in
either mode, and their state is recorded as a GPC opt-out. If they explicitly
allow analytics in Your Privacy Choices, that specific choice takes precedence
over the blanket signal.

## Previewing what visitors see

You configure from one country; your visitors come from many. In any screen's
**Preview**, use the **Consent preview** picker (top right) to view your site
as-if-from the EU, the US, an unknown region, or a GPC-sending browser — the real
banner, driven by the real rules, with nothing saved. On a published page you can
append `?aglynConsent=ask` to any URL to see the prior-consent banner as an EU
visitor would (this override can only ever show *more* consent UI, never less, so
it is safe to share).

## Turn the banner off

The switch at the top of the Cookie consent card turns the whole tool off. That
means Google Analytics loads for **every** visitor without being asked — do this
only if you run your own consent solution, and remember you remain responsible for
the consent your visitors' jurisdictions require.
