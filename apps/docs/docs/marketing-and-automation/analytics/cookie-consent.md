---
sidebar_position: 2
title: Cookie consent
description: Ask visitors before analytics runs — or track immediately where the law allows, with an always-available opt-out. Google Analytics never loads for a visitor whose recorded state does not grant it.
---

# Cookie consent

If your site uses **Google Analytics**, Aglyn manages visitor consent for you. The
control is real, not decoration: whenever a visitor's recorded state does not grant
analytics, the Google Analytics script **never loads** — it is not loaded and then
suppressed.

## How it works

Consent UI appears only on sites that use a **consent-gated feature** — today, a
configured Google Analytics ID. A site with no analytics has nothing to consent to,
so its visitors never see anything.

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
storage** in **Site setup → SEO → Cookie consent**. The switch needs a
configured Google Analytics ID to do anything — there is no advertising storage
to ask about without a tag.

Advertising then follows **the same consent mode as analytics** — it is a second
question, not a second rulebook. It gets its own checkbox on the banner and in
the preferences panel, so a visitor can allow analytics and refuse advertising.
In **opt-in everywhere** mode, and for EU/UK and unknown-region visitors in
geo-conditional mode, advertising storage stays denied until someone explicitly
allows it. Everywhere else in geo-conditional mode it is granted by the same
implied default that grants analytics, and **Your Privacy Choices** is the
opt-out — so on a geo-conditional site, turning this on does start advertising
storage for those visitors.

Built-in Aglyn analytics are unaffected by all of this: the pageview beacon is
**cookieless** and stores no visitor identifier, so it needs no consent.

## What needs consent

**Consent-gated** — held back unless the visitor's recorded state grants analytics:

- **Google Analytics** (your configured measurement ID), including the overlay and
  experiment events Aglyn mirrors into it.
- **Cross-visit A/B test identity**: without an analytics grant, experiment variant
  assignment is remembered only for the visit (sessionStorage) instead of across
  visits.
- **Advertising storage** (`ad_storage`, `ad_user_data`, `ad_personalization`),
  on sites that have turned the advertising question on. It follows the same
  posture as analytics, and never a looser one:
  - **Prior-consent regions always need an explicit yes.** The EU/EEA, the UK,
    and any visitor whose region cannot be determined see the banner first, and
    advertising storage is denied until they tick that specific box. This holds
    however your site is configured — an implied state cannot be recorded for
    those visitors at all, so there is no path by which one is defaulted into
    advertising.
  - **Elsewhere, the implied default covers advertising too.** In
    geo-conditional mode a visitor outside those regions is granted analytics
    *and* advertising from their first visit, without a banner, exactly as
    analytics alone worked before — because the laws that apply there (for
    example California's CPRA) regulate advertising on an opt-out basis. **Your
    Privacy Choices** is their opt-out, and Global Privacy Control is honored
    automatically. Choose **Opt-in everywhere** if you would rather ask every
    visitor.
  - A visitor who already has a recorded state from before you turned the
    question on reads as *never asked*, not as a yes — their existing choice
    stands until they change it in Your Privacy Choices.
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
