---
sidebar_position: 3
title: Generate a website from a prompt
description: "Generate a website from a prompt: describe a business and an Aglyn AI build job plans a small site — pages, navigation, layout, contact form and palette — then builds it. A guided start publishes it."
---

# Generate a website from a prompt

An AI build job can scaffold a whole site from a brief, such as *"a neighborhood dog groomer
that takes bookings"*. The job proposes a **plan** first — the pages it will build with their
addresses and navigation, the layout they share, a contact form, and a palette suggestion made
from your theme — and builds nothing until you confirm it.

Everything it then builds follows [the building rules](./how-aglyn-ai-builds.md), because each
piece is built by the same job that builds it on its own: the pages by the page job, the
layout by the layout job, the form by the [form job](./generate-a-form.md). A scaffold is
those jobs run in order, not a different way of building.

## Starting a new site from a few questions

A site you have just created opens on its **Setup** page, and **Start your site**
opens over it with one question first: **how do you want to start?**

- **Start from the starter site** gives the site a ready-made home page with a
  header, footer and contact form, live at its address, for you to edit.
- **Start with AI** asks a few questions instead: what kind of site you are
  creating, who it is for, which of the starter shapes you like, and where your
  contact form's submissions should go. It writes the brief for you and plans the
  site from it. **Back** returns to the first question.

Each answer changes what gets built. Who the site is for is who every page's
search listing is written for, and who the contact form asks its questions of.
Where submissions go is the form's routing: **the Inbox**, or the Inbox and a
lead in CRM for every message that carries an email address. You can change that
on the form itself afterwards.

**Skip** is in the bar at the top on both steps, and so are the close control and
the Escape key. Before a site is being planned, all three do what the starter
card does: the site gets the starter home page, and nothing else is created — no
job, no half-built site behind you — and the site does not ask again. Once the
site is being planned they only close the window; the job carries on.

Until one of those happens, a site that started this way has no page yet, and its
address shows a short **coming soon** page with the site's name, which search
engines are asked not to index.

Every question, step and button of the guided start is walked through on
[Start a new site with AI](./start-with-ai.md).

### On the Free plan

A Free workspace's AI start builds **one or two pages**: the home page and the one
page your business most needs, such as services, booking or contact. Paid plans
can generate more pages. The questions show what the start can cost at most out of
the 300 AI credits a Free workspace has each month, and a Free start keeps the
site's theme and drafts no welcome email.

### If the plan does not work out

If a plan cannot be made, you see one sentence saying so and what to do.
**Try again** is turned off, with the reason, when the credits left this month
cannot cover another plan. **Use the starter site instead** gives the site the
starter home page, as long as the job has not built anything yet.

When a job fails because of something on our side — a plan that could not be
made, an AI provider error, a step that timed out — the credits it used are
given back: all of them if it built nothing, or the failed step's if it had
already built some pages, which you keep. This happens up to three times a day.
Canceling a job yourself is not given back; you pay for what ran until then.

## What a scaffold builds

- **Four to eight pages** (one or two on the Free plan), each with its sections, its
  address and its search title and description. A brief that asks for a bigger site
  is several jobs. On a site that still has the starter home page untouched, the
  plan's home page takes its place at `/` when you publish it.
- **A shared layout** for the header, navigation and footer every page sits in.
- **A contact form**, created on the Forms page and placed on the page that needs it. It
  counts toward your plan's saved forms; when the site has no room for another, the
  pages are built without one.
- **A palette suggestion** built from your theme's own colors, which you apply in the Theme
  section — or do not.
- **A welcome email draft**, when you ask for one, written to the people the site
  is for and saying what became of the message it answers.
- **The site's own search title and description**, from what you said the site is
  and who it is for. They are the fallback every page without its own publishes,
  and they wait on the site's **SEO** section under *The listing your answers
  describe* — **Put in the form** stages them there, and the form's Update saves
  them.
- **A navigation entry** per page, proposed for you to add. The live navigation is not
  touched.

## What is published

A new site started from **Start with AI** publishes its pages when the job finishes, so the
site is live at its address. A page that cannot be published stays a draft, and the
**Building your site** page names it with the reason.

Every other scaffold — a site generated for an existing site, or for several sites at once —
publishes nothing: every page arrives as an **unpublished draft**, and no address on your live
site resolves to a new page until you publish it, through the same buttons you always use.

Either way the palette waits in the Theme section until you save it, the welcome email is
not sent, and the navigation entries are proposals for you to add.

## What it costs, before it starts

A scaffold is far more work than a single page, so the plan shows an **estimated cost in
credits** beside the button that confirms it. It is an estimate: what the job really costs is
what each of its steps spends, and you can watch that add up on the job while it runs.

If your workspace runs out of credits partway through, the job stops and waits rather than
failing. What it had already built stays, and it carries on from there once there are credits
again. You can also cancel it at any point and keep what it made.

## Watching it build

A new site started from **Start with AI** has no plan to approve: the plan is made
and the building starts straight away. **Plan my site** takes you to the site's
**Building your site** page, which shows each step as it happens — planning your
pages, then writing each page — and the credits used so far. **What we're
building** opens the plan: every page and its sections.

When it is done the page says **Your site is live** and how many credits the site
used, with **View your site**, which opens your live site in a new tab, and
**Edit your pages**, which opens the site's **Pages** list. If a page could not be
published, the page lists it with the reason, and it waits as a draft in **Edit
your pages** for you to fix and publish. If it stops instead, the page says why
and what you can do, and whether the credits were given back.

**AI jobs** in the trail above the heading opens the site's **AI jobs** page:
every job that worked on the site, newest first, with what kind of job it was,
its brief, where it stands and the credits it used. Each one opens its own page.

You do not have to wait on the page. It keeps its own address, so you can come
back to it, and the notification you get when the site is built or stops opens
it. While it works, the **AI** chip in the top bar says what it is doing. See
[Finding your AI jobs](./how-aglyn-ai-builds.md#finding-your-ai-jobs).

Every other planned job — a page, a form, a site generated for an existing site —
still stops after its plan: it shows the plan with its estimate and **Confirm
plan**, and builds nothing until you confirm it.

## Generate for several sites at once

On the **Sites** page of your organization, **Generate for several sites** runs one brief
across many of your sites, changing the business name, the city and the brand for each. It is
available on the plans that hold enough sites for it to be useful.

Pick the sites, fill in each one's details, and the card shows what one site is estimated to
cost and what the whole run is. Each site then becomes its own job: each proposes its own
plan, each waits for you to confirm it, and each builds only drafts. The card's table shows
where every site in the run has got to, with a link into each.

**Where do form submissions go?** is asked once for the whole run, in the same two answers
the guided start offers, and it routes the contact form on every site the run builds. You can
change it on any one of those forms afterwards.

You only see the sites you may build on, and a site you cannot is named rather than skipped
quietly.
