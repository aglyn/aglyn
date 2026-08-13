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
  recorded as *implied consent*, and the persistent **Privacy choices** control
  lets them opt out at any time.
- **Opt-in everywhere**: every visitor, everywhere, sees the prior-consent banner.

The banner offers **Allow**, **Decline**, and **Preferences** side by side — no
dark patterns, and declining is one click, same as allowing.

Built-in Aglyn analytics are unaffected by all of this: the pageview beacon is
**cookieless** and stores no visitor identifier, so it needs no consent.

## What needs consent

**Consent-gated** — held back unless the visitor's recorded state grants analytics:

- **Google Analytics** (your configured measurement ID), including the overlay and
  experiment events Aglyn mirrors into it.
- **Cross-visit A/B test identity**: without an analytics grant, experiment variant
  assignment is remembered only for the visit (sessionStorage) instead of across
  visits.

**Always on (strictly necessary)** — these keep working regardless of the choice,
because the site cannot function without them:

- Shopping cart and member sign-in cookies.
- Popup and announcement "don't show this again" stamps (stored locally, never
  transmitted).
- The stored consent state itself.

## Privacy choices — the persistent control

Whenever consent management is active, every page of your site shows a small
**Privacy choices** control. Visitors use it to change their state **in either
direction** at any time — opt out after being tracked by default, or allow
analytics after declining. In geo-conditional mode this control is the *only*
opt-out surface visitors in implied-consent regions see, which is why it is shown
by the platform on every page rather than depending on your template.

You can also link any element (a footer link, for example) to `#aglyn-consent` —
clicking it opens the same preferences panel.

## Global Privacy Control

Browsers can send the **Global Privacy Control** (GPC) signal. Aglyn honors it as
an **automatic opt-out**: a visitor sending GPC is never tracked by default, in
either mode, and their state is recorded as a GPC opt-out. If they explicitly
allow analytics in Privacy choices, that specific choice takes precedence over the
blanket signal.

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
