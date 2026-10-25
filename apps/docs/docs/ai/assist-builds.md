---
sidebar_position: 3.5
title: Build from Assist chat
description: "Ask Aglyn Assist for what you need in one message — pages, a form, an email, products, a booking service, an automation — and it shows one plan card. Confirm it and one job builds every part as a draft."
---

# Build from Assist chat

:::note Beta
**Aglyn AI is in beta.** It is available today on every plan that includes it,
and it is still changing as we improve it. Beta means you can use it now, while
what it builds and the steps on this page may still change.
:::

The [Aglyn Assist](../getting-started/aglyn-assist.md) chat answers questions. On a site
with AI generation, it also **builds**: describe what you need in one message, such as
*"add a pricing page and a quote request form, and a welcome email for people who send
it"*, and Assist plans all of it at once and builds it in one job.

## Ask or build {#ask-or-build}

Assist decides from your message whether you are asking or asking for something to be made:

- **A question**, such as *how do I connect a domain?*, gets an answer from the docs.
- **A change to the page you have open** in the Besigner gets a
  [proposed edit](../getting-started/aglyn-assist.md#edits-in-the-besigner).
- **Something to make** gets a **plan card** in the chat.

It builds only on a site, and only what your plan includes and the site has turned on.
When you ask for something it cannot make from the chat, it says so plainly and plans the
rest.

## What one request can build {#what-it-can-build}

One message can ask for any mix of:

- **pages**: home, about, services, contact, pricing, a landing page;
- **a header and footer** shared by the pages;
- **a form**: a contact form, a quote request, a sign-up form;
- **a reusable component**: a card or block placed on several pages;
- **an email design**, such as a welcome, a reply or an announcement, and **an email
  campaign**, drafted and left unsent;
- **a page template** for blog posts, products or authors;
- **an automation**: when a form is sent, do something;
- **a site function** that works out a value, such as a price or a quote, and **site
  variables**, such as a phone number kept in one place;
- **products** to sell, with a description, tags and options;
- **a booking service** visitors can book online, with its length, hours and price;
- **events** on the site's calendar, each with its date and time, place, description and a
  cover photo, published so the Event List on your pages shows them. They need the Event
  Calendar add-on. See [Events Calendar](../content-and-data/events/overview.md#ask-aglyn-ai);
- **an announcement bar** or **a popup**;
- **an A/B test** of a page or of an email's subject line;
- **a funnel** that counts visits from one step to the next;
- **CRM setup**: a [deal pipeline](./crm-by-ai.md#set-up-the-crm) with its stages,
  [custom fields](./crm-by-ai.md#set-up-the-crm) on contacts, companies, deals or leads, and
  new values for a [picklist](./crm-by-ai.md#set-up-the-crm) such as lead status or source.
  These are saved straight to your CRM, as they are when you set them up yourself;
- **a change to a page or layout** the site already has, saved as a new version visitors do
  not see until you publish it;
- **redirects**: send an old address to a page you have, change where a redirect goes, or
  stop one, such as *redirect /old-menu to /menu*. See
  [Redirects](../building-sites/redirects/overview.md#ask-aglyn-ai);
- **a change to the site's settings**: its name, search title and description, title
  pattern, favicon, logo or social image (from images already in your media library), its
  language, time zone, business name, description, phone, contact email or address, or the
  cookie banner's mode. For example, *rename my site to Juniper Clay Studio* or *make the
  site Spanish*.
- **tracking tags**: connect or remove Google Analytics, Google Tag Manager, or the Meta,
  Google Ads, LinkedIn, TikTok or Pinterest tag by the ID you give, such as *connect Google
  Analytics G-4R7KX2PQ9Z*. See
  [The Tracking card](../marketing-and-automation/analytics/overview.md#ask-aglyn-ai).
- **organizing your media library**: file pictures already in this site's library in a
  folder, add or remove tags, rename a file, or write its alt text, such as *put kiln.jpg
  and wheel.jpg in a Studio folder* or *write the missing alt text from the captions*. See
  [Media library](../content-and-data/media/overview.md#ask-aglyn-ai).
- **who can see the site**: turn maintenance mode on or off, hide the site from search
  engines or allow them again, or set pages to Public, Unlisted or Members only, such as
  *make my site private until launch* or *hide the pricing page*. Maintenance mode needs
  the admin role on the site. Assist never sets a page password. See
  [Make your site private](../building-sites/site-protection/make-your-site-private.md#ask-aglyn-ai).
- **store setup**: shipping zones and rates, local pickup, local delivery and sales tax,
  such as *free shipping over $50, otherwise $5 flat in the US*. See
  [Shipping](../commerce-and-bookings/commerce/shipping.md#ask-aglyn-ai),
  [Pickup & local delivery](../commerce-and-bookings/commerce/pickup-and-local-delivery.md#ask-aglyn-ai)
  and [Tax settings](../commerce-and-bookings/commerce/overview.md#tax-settings). Store
  setup needs the admin or editor role on the site.

One build holds up to 16 things and 8 pages. On the Free plan it holds 2 pages, and some
parts, such as templates, campaigns, automations, products and edits to existing pages,
need a paid plan. The card says when your request goes past a limit; ask for the rest in a
second message.

## The plan card {#the-plan-card}

The card shows **Planning what to build on this site…** while the plan is made, then the
**Proposed plan**, one line per part:

- **Reuses** something the site already has, and what for;
- **Creates** something new, and why nothing you have will do;
- **Builds the page** with its title, address, layout and sections;
- any video player a page will carry, and what loading it costs your visitors.

Under the lines is the **Estimated cost**, such as *About 106 credits (up to 650)*: about
what builds like it cost, and the most it can cost. What the build costs is what its steps
spend. On the Free plan the card also says how many free credits you have left this month.
If you asked for the new pages to go live, a **Publish the new pages when they are built**
box is there too, unticked until you tick it.

If the build will likely use more than your credits left, the card says so instead of
offering **Confirm plan**, and gives you three choices: **Build what fits** (it builds what
your credits cover and pauses, then **Resume** carries on), **Build the home page first**
(only the home page and what it needs), or **Upgrade**. See
[Before a job starts](./ai-credits.md#before-a-job-starts).

Nothing is built while the card waits. The plan follows
[the building rules](./how-aglyn-ai-builds.md#the-building-rules), and a plan that breaks
them, or asks for more than your plan includes, is stopped before you are asked to confirm
it.

## Confirm the plan {#confirm-the-plan}

**Confirm plan** builds it. The card then shows **Building each part in turn** and a row per
part, such as *Page: Pricing — building*, that reads **built**, **building**, **waiting**,
**failed** or **not built**. You can close the chat; the job keeps going, and
**Open in AI jobs** follows it in the [AI jobs](./ai-jobs-and-activity.md#ai-jobs-in-assist)
list.

Confirming checks your permissions and credits again, so a plan confirmed after your
credits ran out waits instead of building.

## One job, many parts {#one-job-many-parts}

Everything in the plan is built by one job, each part by the same builder that makes it on
its own page, in the order the parts need each other: the layout and the form before the
page that places them.

- **Each part stands on its own.** A part that fails does not undo the others. What depends
  on it is built without it, or not built, and the card says which.
- **Everything is a draft.** Pages are unpublished drafts unless you ticked the publish box.
  Products have no photo and the price you stated, if any. Booking services and funnels are
  drafts to activate. Overlays and automations are switched off, A/B tests are stopped, and
  campaigns are unsent and aimed at nobody. The exceptions are a **redirect**, **CRM
  setup**, **store setup**, **site settings**, **tracking tags**, **privacy changes** and
  **media library changes**: a redirect rule, a CRM pipeline, custom field or picklist
  value, the shipping, pickup, delivery and tax settings, the site's settings, its tracking
  tags, who can see it and a file's folder, tags, name and alt text have no draft, so they work as soon as the build saves
  them, as they do when you save them yourself. The plan card lists each one before you confirm, and Aglyn AI uses only the
  prices and rates you state.
- **Names are your own.** A new variable or function never takes a name the site already
  uses.
- **Settings are saved live.** A change to the site's settings has no draft: like a save in
  Settings, it reaches your live site as soon as that part is built. Making the site
  Spanish sets its language; it does not translate the pages. A value that cannot be used,
  such as an email address that is not one, is named on the card and the rest are saved.
  Assist never changes your site's address, domain, members, billing, plugins or cookie
  banner as a settings change. Tracking IDs change only as a tracking change, by the ID you
  give, and who can see the site only as a privacy change.

When it is done the card says how many parts were built, such as *5 of 6 built; 1 failed*.
**Try again what failed** builds only the parts that failed, and shows what that is likely
to cost.

If your credits run out partway, the card says **Paused**. What is built so far is kept.
Choose **Resume** after you upgrade or when your credits renew, and it carries on with the
next part.

To change something it made, ask in the chat, such as *make the about page shorter*.
Assist opens that draft and proposes the change there.

## When a build makes your site a store {#a-store}

When you ask Assist to *add a shop* or *make this a store*, and the build makes products,
a product page template or a Shop page, it also adds the pages every store needs. It adds
only the ones your site does not already have:

- **Your account** at `/account`, where shoppers sign in, see their orders and find what
  they saved;
- **Your cart** at `/cart`;
- **Shipping & returns**, **Privacy policy** and **Terms of sale**, as drafts with the
  details only you know left in [brackets] for you to fill in.

A page you already have stands in for its store page, at its own address or by what it is
called. For example, an existing *Privacy Policy* page at `/privacy-policy` is used, and no
second one is added. The plan card lists the pages it will add as *added for your store
automatically*. They are built without AI and use no credits. The account and cart pages are
hidden from search engines. Your site's user accounts are turned on so that shoppers can
sign in, unless you turned them off.

The header links the account page, and the cart page too if the header has no cart. The
footer links the account and policy pages. If the build makes a header and footer, they
come with these links. If it doesn't, Aglyn adds them to your site's existing layout as a
new draft version. Links already there are not added again. The version you have live is
not changed: the new one goes live when the build publishes, or when you publish it. If
your header or footer has no list of links to add to, the layout is left as it is, and
**Finish your store** asks you to add the links yourself.

This needs a plan that includes a store, with **Commerce** on for the site, and the editor
role. When the build is done, the card shows **Finish your store**: connect payments, review
your products, set shipping and tax, and fill in your policies. The payments step is marked
done when your workspace's Stripe account already takes payments.

## What it costs {#what-it-costs}

A build spends [AI credits](./ai-credits.md) for each part it makes, and the card shows the
estimate before you confirm. Products, booking services, overlays, A/B tests, funnels,
variables and CRM setup cost almost nothing, and redirects, store setup, settings, tracking
tags and privacy changes cost nothing. If the build fails because of something on our side, the
credits are given back, and the card says so. See
[Credits given back](./ai-credits.md#credits-given-back).

## Who can use it {#who-can-use-it}

Building from the chat needs AI generation on your plan, the **Generate with AI**
permission, and AI on for the site. See [Who can use Aglyn AI](./overview.md#who-can-use-it).

## Related

- [Aglyn Assist](../getting-started/aglyn-assist.md)
- [How Aglyn AI builds](./how-aglyn-ai-builds.md)
- [AI jobs and activity](./ai-jobs-and-activity.md)
- [Create with AI on every list](./create-with-ai.md)
