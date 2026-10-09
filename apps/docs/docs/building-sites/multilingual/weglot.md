---
sidebar_position: 4
title: Translate with Weglot
description: Translate your published site in the visitor's browser with your own Weglot account, and what that does and does not do for search.
---

# Translate with Weglot

If you already use [Weglot](https://www.weglot.com), Aglyn can load it on your
published pages with your own Weglot account. Weglot translates each page in the
visitor's browser, and a language switcher lets visitors pick their language.

:::info Plan availability
**Business** and above, the same plans as [Multilingual](overview.md). On other
plans, nothing is added to your pages.

You need your own Weglot account. Weglot's plan decides how many words and
languages you can translate, and Weglot bills you for it. Aglyn charges nothing
extra.
:::

## Translated pages are for visitors, not search engines {#seo}

Weglot's JavaScript translation runs **after** the page loads, at the same address as
the original. Search engines index your site in the language it is written in, so
**the translations may not rank in other languages.**

Aglyn adds no `hreflang` tags for Weglot's languages, and it does not support Weglot's
subdomain or subdirectory setups. Those setups give each language its own address,
which needs DNS and server routing your Aglyn site does not provide.

If a language needs to rank in search, use Aglyn's own
[locale variants](add-a-locale.md). Each variant is a real page at its own address
with `hreflang` tags. You can use both on one site: Weglot for languages you want
to offer visitors, and locale variants for languages that need to rank. Don't set
up the same language both ways.

## Before you start {#before-you-start}

1. In Weglot, create a project for your site. Set its original language and the
   languages you want to translate into.
2. Copy the project's **API key** from Weglot's project settings. It starts with
   `wg_`. Weglot designed this key to be public, and it appears in your pages'
   source.

## Turn it on {#turn-it-on}

1. Go to **Sites → your site → Admin → Plugins**. On the **Site plugins** card, switch
   on **Weglot translation** and press **Save site plugins**. It starts off on every
   site.
2. On that card, select **Weglot translation** to open the plugin's page for this site.
3. On the **Weglot translation settings** card, enter:
   - **Translate this site with Weglot**: on.
   - **Weglot API key**: the `wg_` key you copied.
   - **Language your site is written in**: a code such as `en`. It must match the
     original language of your Weglot project.
   - **Languages to translate into**: codes separated by commas, such as
     `fr, es, de`. Use the same languages as in your Weglot project.
   - **Language switcher**: **Matches your site's theme** (Aglyn's switcher, drawn
     with your theme) or **Weglot's own switcher**.
   - **Switcher position**: bottom right or bottom left.
4. Press **Save site settings**. Your published pages update right away.

## Weglot translation settings {#settings}

The settings card holds your Weglot API key, your site's language, the languages to
translate into, and which switcher visitors see and where.

To give every site in a workspace the same settings, set them on the plugin's
workspace page under **Plugins**. Each site follows those settings unless you change
a field on that site's page. Each site still has to switch the plugin on. A
workspace save reaches published pages when their cache next refreshes (within an
hour). A save on a site's own page updates that site right away.

The settings card won't save while translation is on and a field can't be used, such
as a key that doesn't start with `wg_`, or a target language that is the same as your
site's language.

## What visitors see {#what-visitors-see}

- **The switcher** appears in the corner you picked. Aglyn's switcher lists each
  language by its own name (Français, Español). Once Weglot has loaded, it lists only
  languages your Weglot project actually serves.
- **Choosing a language** translates the page. Weglot remembers the choice, so the
  visitor's next pages and later visits open in that language.
- **Weglot's own options**, such as redirecting visitors by their browser language,
  come from your Weglot dashboard.

Weglot doesn't run in the Besigner or in the console's page preview. To check it,
open your published site.

## How it affects page speed {#page-speed}

Weglot's script is about 73 KB compressed and comes from Weglot's servers. Aglyn never
lets it hold up the first view of your page:

- **Visitors who chose a translated language before** get the script as soon as the
  page starts loading, without blocking it. Until the translation arrives, Weglot hides
  the text instead of showing the original language first.
- **Everyone else** gets the script after the page has loaded and the browser is idle.
  Most of these visitors read your site in its own language. If they pick a language
  before then, Weglot loads right away.

Visitors redirected by Weglot's browser-language option may see the original text
briefly on their first visit, because Weglot loads after the page. Later visits load
it early.

## Cookies and privacy {#cookies-and-privacy}

Weglot stores these in the visitor's browser:

- `wglang`: the language they chose.
- `wg-translations` and `wg-slugs`: a cache of the translations already fetched.
- `WG_CHOOSE_ORIGINAL`: a cookie that lasts one month. Weglot sets it only when your
  project redirects by browser language and the visitor picks the original language.

None of these measure visitors or show them ads. They remember a choice the visitor
made and serve the translation they asked for. That's why Weglot is in the
[always on (strictly necessary)](../../marketing-and-automation/analytics/cookie-consent.md#what-needs-consent)
group and is not held back by the cookie banner.

To translate a page, the visitor's browser sends Weglot the page's text, its address,
the chosen language and the browser's language. If your Weglot project counts page
views, the browser also reports each page view to Weglot. You chose Weglot as your
vendor, so Aglyn's servers never contact it.

## Security {#security}

Your site's security policy allows Weglot's addresses (`cdn.weglot.com`,
`cdn-api-weglot.com` and `api.weglot.com`) only while Weglot is switched on and
enabled for that site. Every other site's policy blocks them.

## Turn it off {#turn-it-off}

You can turn off **Translate this site with Weglot** in the settings, or switch the
plugin off on the **Site plugins** card. Either way, the script and the switcher stop
loading on your pages. Your settings stay saved, and your Weglot account keeps its
translations.

## Related

- [Multilingual](overview.md): locale variants and `hreflang`.
- [Cookie consent](../../marketing-and-automation/analytics/cookie-consent.md)
- [Plugins & Marketplace](../../developers/plugins/overview.md#configure-site):
  how site settings follow the workspace.
