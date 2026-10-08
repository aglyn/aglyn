---
sidebar_position: 5
title: Funnels
description: See how visitors move through the steps you care about, where they drop off and how long each step takes; build or explain a funnel with Aglyn AI, and follow up with people who dropped off.
---

# Funnels

A funnel is an ordered list of two to eight steps you expect a visitor to take on your site
— say, *viewed a pricing page → viewed the sign-up page → submitted the sign-up form*. Aglyn
counts how many visitors reached each step in that order, how many dropped off between
steps, and how long the steps took.

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
| **Email from the site** | A person who [identified themselves](#identified-visitors) opened an email your site sent them, or clicked a link in one, when your email service reports it |

The step pickers list your site's real pages, forms, services, products and overlays, and a
funnel can only be saved with steps your site has.

An **Email from the site** step is what lets a funnel show whether a follow-up worked — for
example *submitted the quote form → opened an email from the site → made a booking*. It only
ever counts people who submitted a form, because an email can only be tied to them.

## How a visit moves through a funnel {#how-it-counts}

For each visit, Aglyn looks at its steps in time order. A visit reaches step 1 the first time
it matches step 1, reaches step 2 the first time it matches step 2 *after that*, and so on.
A step done before the step ahead of it does not count, and a visit counts once per step no
matter how often it repeats one.

The results show, over the dates you pick (up to 90 days):

- **Visitors** at each step, as a bar, with the share of the previous step that reached it and
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
  new visit. Nothing links one visit to another, or to a person — unless the visitor
  identifies themselves by submitting a form (see [below](#identified-visitors)).
- **Consent comes first.** The visit id leaves the browser, so it is analytics storage: a
  step is recorded only once the visitor's [cookie consent](cookie-consent.md) allows
  analytics. A visitor who declines, opts out or sends Global Privacy Control is never
  recorded, and steps taken before someone accepts are not recorded later. Funnels
  therefore count fewer visits than the traffic panel, and in regions where your site asks
  first, noticeably fewer.
- **Recording starts with your first funnel.** A site with no funnels records nothing.
  Saving the first funnel turns recording on, and earlier visits cannot be measured.
  Deleting the last funnel turns it off. A [draft funnel](#drafts) never turns recording on.
- **Up to 60 steps per visit** are recorded; a very long visit stops adding steps after that.
- **Visits are kept for 90 days** and then deleted automatically.
- **Very busy sites:** a result reads at most the 20,000 most recent visits in the range and
  says so when it stops there.
- Visits from preview builds and from browsers marked as your own traffic are not recorded,
  the same as page views.

## Visitors who submitted a form {#identified-visitors}

When a visitor submits a form on your site during a recorded visit, that visit is tied to the
email address they typed in the form. From then on:

- **All their recorded visits count as one visitor,** so someone who submitted a quote form
  in one tab and booked in another the next day reaches both steps.
- **Emails your site sends them can be funnel steps** — opened, or a link clicked.
- **They can be followed up** when they drop off (see [Act on a drop-off](#act-on-drop-off)).

Anonymous visitors are never tied to anyone. A visit is only tied to an address while the
visitor's consent allows analytics, the address goes when the visit expires after 90 days,
and erasing a person from your workspace deletes every visit tied to them.

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

### Draft funnels {#drafts}

When Aglyn AI builds part of your site from one request, it can set a funnel up too. That
funnel arrives as a **draft**, marked *Draft* on the Funnels card, and changes nothing on your
live site: it does not turn recording on, it has no results, Insights does not read it, and
it cannot be followed up on. Its steps use only pages your site already publishes, and forms,
services, products or bars and popups your site has — including ones the same request made.

Select the draft to review its steps, edit it if you like (it stays a draft), then select
**Activate**. Activating checks every step against your site again, makes the funnel live and
turns recording on if it was off, so it counts visits from then on. Activating needs a site
admin or editor. A draft counts towards the 20 funnels a site keeps.

## Act on a drop-off {#act-on-drop-off}

Below each step after the first, **Act on this drop-off** drafts an automation for the
people who reached the step before it and did not go on. Pick:

- **After** — how long to wait for them to go on: 1 hour, 1 day, 3 days or 7 days.
- **Then** — send them a follow-up email, or create a CRM task for your team.

The automation is saved **switched off** on your site's **Automation** page. Edit its words
there, then switch it on. It starts on the trigger **Left a funnel**, with conditions for this
funnel, this step and this wait, and it can use the funnel's name, the step's name, the next
step's name and the person's `email`.

Who it reaches:

- **Only people who submitted a form on your site.** Anonymous visitors are never followed up.
- **Only once per person,** for each funnel, step and wait, and only if they had not reached
  the next step in **any** of their recorded visits.
- A follow-up **email is a mailing**, not a reply: it carries its unsubscribe link and is never
  sent to someone who unsubscribed or whose address is suppressed.
- People who dropped off in the last wait period before you created the automation are
  included; earlier ones are not.

Aglyn checks for drop-offs every 15 minutes, so a follow-up can arrive up to a quarter of an
hour after its wait. Drafting needs a site admin or editor and a plan that includes
automations. Add an **Email from the site** step after the step you follow up on to see in the
funnel how many people the follow-up brought back.

## Ask AI about a funnel {#ask-ai}

On a funnel's results, **Ask AI about this funnel** opens [Insights](insights.md) with a
question about that funnel. Aglyn AI reads the funnel's figures — visitors, drop-off and time
at each step, and every funnel's completion rate — and every number in the answer links back
to them.
