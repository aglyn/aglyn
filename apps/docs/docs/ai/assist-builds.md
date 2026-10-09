---
sidebar_position: 3.5
title: Build from Assist chat
description: "Ask Aglyn Assist for what you need in one message — pages, a form, an email, products, a booking service, an automation — and it shows one plan card. Confirm it and one job builds every part as a draft."
---

# Build from Assist chat

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
- **an announcement bar** or **a popup**;
- **an A/B test** of a page or of an email's subject line;
- **a funnel** that counts visits from one step to the next;
- **a change to a page or layout** the site already has, saved as a new version visitors do
  not see until you publish it.

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

Under the lines is the **Estimated cost** in credits. It is an estimate: what the build
costs is what its steps spend. If you asked for the new pages to go live, a
**Publish the new pages when they are built** box is there too, unticked until you tick it.

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
  campaigns are unsent and aimed at nobody.
- **Names are your own.** A new variable or function never takes a name the site already
  uses.

When it is done the card says how many parts were built, such as *5 of 6 built; 1 failed*.
**Try again what failed** builds only the parts that failed.

To change something it made, ask in the chat, such as *make the about page shorter*.
Assist opens that draft and proposes the change there.

## What it costs {#what-it-costs}

A build spends [AI credits](./ai-credits.md) for each part it makes, and the card shows the
estimate before you confirm. Products, booking services, overlays, A/B tests, funnels and
variables cost almost nothing. If the build fails because of something on our side, the
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
