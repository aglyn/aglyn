---
sidebar_position: 5
title: Funnels
description: Measure how visitors move through the steps you care about — pages, forms, bookings, cart and orders — with drop-off, conversion and time between steps, and build or explain a funnel with Aglyn AI.
---

# Funnels

A funnel is an ordered list of two to eight steps you expect a visitor to take on your site
— say, *viewed a pricing page → viewed the sign-up page → submitted the sign-up form*. Aglyn
counts how many visits reached each step in that order, how many dropped off between steps,
and how long the steps took.

Funnels are on your site's **Analytics** page, below the traffic cards.

:::info Plan availability
Funnels come with per-page analytics, on **Pro** and higher plans. On other plans the
Funnels card says so and shows nothing else.
:::

## What a step can be {#step-types}

Only things your site already sees happen:

| Step | Matches |
| --- | --- |
| **Viewed a page** | A page at an exact path, or a path and everything under it (`/blog` and `/blog/any-post`) |
| **Submitted a form** | A successful submission of one form, or of any form |
| **Made a booking** | A booking for one service, or any booking — a free one when it is confirmed, a paid one when its payment settles |
| **Added a product to the cart** | One product, or any product |
| **Placed an order** | A storefront order that was paid |
| **Clicked a bar or popup** | A click on one announcement bar or popup, or any |
| **Custom event** | An event an interaction sends with **Send an analytics event**, by its name |

The step pickers list your site's real pages, forms, services, products and overlays, and a
funnel can only be saved with steps your site has.

## How a visit moves through a funnel {#how-it-counts}

For each visit, Aglyn looks at its steps in time order. A visit reaches step 1 the first time
it matches step 1, reaches step 2 the first time it matches step 2 *after that*, and so on.
A step done before the step ahead of it does not count, and a visit counts once per step no
matter how often it repeats one.

The results show, over the dates you pick (up to 90 days):

- **Visits** at each step, as a bar, with the share of the previous step that reached it and
  the share of all visits that entered the funnel.
- **Drop-off** — the visits at the previous step that never reached this one.
- **Median time** from the previous step to this one.
- **Completed** — the share of visits that entered and reached the last step.
- **By source** — the same entered/completed counts by where the visit arrived from: its
  `utm_source` (and `utm_campaign`) when the link had them, otherwise the site that referred
  it, otherwise *Direct*.

A visit belongs to the range it started in. Results are kept for a few minutes (a day for a
range that has ended) so reopening the card is quick; **Refresh** recomputes them.

## What counts as a visit, and its limits {#what-is-a-visit}

A **visit is one browser tab on your site, until it is closed.** When a visitor's first step
is recorded, their browser makes up a random visit id and keeps it in that tab's session
storage — not a cookie, not shared with other sites, never derived from their address or
device. Every step that tab takes is recorded under that id.

That means:

- **Two tabs are two visits,** and a visitor who closes the tab and comes back tomorrow is a
  new visit. Nothing links one visit to another, or to a person.
- **Consent comes first.** The visit id leaves the browser, so it is analytics storage: a
  step is recorded only once the visitor's [cookie consent](cookie-consent.md) allows
  analytics. A visitor who declines, opts out or sends Global Privacy Control is never
  recorded, and steps taken before someone accepts are not recorded later. Funnels
  therefore count fewer visits than the traffic panel, and in regions where your site asks
  first, noticeably fewer.
- **Recording starts with your first funnel.** A site with no funnels records nothing.
  Saving the first funnel turns recording on, and earlier visits cannot be measured.
  Deleting the last funnel turns it off.
- **Up to 60 steps per visit** are recorded; a very long visit stops adding steps after that.
- **Visits are kept for 90 days** and then deleted automatically.
- **Very busy sites:** a result reads at most the 20,000 most recent visits in the range and
  says so when it stops there.
- Visits from preview builds and from browsers marked as your own traffic are not recorded,
  the same as page views.

## Create a funnel {#create}

1. Open your site's **Analytics** page and find **Funnels**.
2. Select **New funnel**, name it, and add steps with the pickers.
3. **Save**. Saving needs a site admin or editor.

### Create with AI {#create-with-ai}

When Aglyn AI is available to your workspace, **Create with AI** turns a description —
*"people who read a blog post, then booked a consultation"* — into a draft funnel. The draft
uses only the pages, forms, services, products and bars or popups your site has; a step the
model suggests that your site does not have is left out and listed. Nothing is saved until
you review the draft and select **Save**. It uses AI credits like other generation.

## Ask AI about a funnel {#ask-ai}

On a funnel's results, **Ask AI about this funnel** opens [Insights](insights.md) with a
question about that funnel. Aglyn AI reads the funnel's figures — visits, drop-off and time
at each step, and every funnel's completion rate — and every number in the answer links back
to them.
