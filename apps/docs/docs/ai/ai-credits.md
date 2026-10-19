---
sidebar_position: 11.9
title: AI credits
description: "Everything Aglyn AI does draws AI credits from one monthly pool: what each plan includes (300 on Free), what an Aglyn AI tier adds on top, what jobs cost, the check before a job starts, and when credits come back."
---

# AI credits

Every AI request, from an answer in the chat to a whole site, is paid for in **AI
credits** from one pool per workspace. There is no second meter for pictures, pages or
emails: they all draw on the same credits.

## Credits each month {#monthly-credits}

Each plan includes credits every month, and they pay for **all** of Aglyn AI: answers,
copy, and building pages, forms, emails, products and the rest. An
[Aglyn AI tier](#the-aglyn-ai-add-on) adds more on top:

| Plan | Included each month |
| --- | --- |
| Free | 300 |
| Starter | 750 |
| Pro | 2,750 |
| Business | 7,500 |
| Scale | 10,000 |
| Advanced | 13,000 |
| Agency | 58,000 |
| Enterprise | Set in your agreement |

The pool **resets on the first of each month** (UTC). Credits you did not use do not
carry over.

On a paid plan, credits past the pool are billed per 1,000 at your plan's rate, unless you
turn on the stop at the included band in **Billing**. See
[Billing & Plans](../workspace-and-billing/billing-and-plans/overview.md).

## The Free plan {#free-plan}

A Free workspace gets **300 AI credits a month** for the assistant and AI generation
together: enough to [start a site with AI](./start-with-ai.md) or try a few builds.

- The credits belong to the **person who owns the workspace**. If you own several Free
  workspaces, they share the 300.
- The 300 are a **hard stop**. When they are used, AI pauses until the first of the month
  or an upgrade, and **nothing is ever billed**.
- Free requests are also capped per day, and Free generation can pause for a day across all
  Free workspaces when the platform's daily limit is reached. Each message says when it
  starts again.
- A new account can use its credits straight away. There is no waiting period.

## Aglyn AI tiers {#the-aglyn-ai-add-on}

Need more than your plan includes? An **Aglyn AI tier** adds credits to the same pool every
month, **on top of** what your plan includes. You choose the tier on its own: any paid plan
can have any tier, and changing your plan keeps your tier.

| Tier | Adds each month |
| --- | --- |
| Spark | 4,000 |
| Boost | 9,000 |
| Plus | 19,000 |
| Max | 34,000 |
| Ultra | 49,000 |
| Studio | 149,000 |

A tier is bought once for the whole workspace. Free has no tiers, and on Enterprise more AI
is part of your agreement. Each tier's price is on
[aglyn.com/pricing](https://aglyn.com/pricing) and in **Billing** before you confirm. Moving
up is charged now, for the rest of the period; moving down or removing it takes effect at the
end of the period you have paid for. See
[Add-ons](../workspace-and-billing/billing-and-plans/add-ons.md#aglyn-ai).

## What things cost {#what-things-cost}

What a request costs depends on how much the AI reads and writes, so the figures below are
typical, not fixed: what jobs like it cost on real builds. Every job shows its estimate
before you confirm it.

| Request | Typical cost |
| --- | --- |
| An answer in the chat, a rewrite, a summary | A few credits |
| An answer quoted straight from the docs | Free |
| A vector illustration, icon or logo mark | About 4 credits a picture |
| A photo, art or design picture | About 108 credits a picture (about 75 on Free) |
| A new site's look | About 1 credit |
| A page from a brief | About 30 credits for a page of five sections (about 6 a section), plus planning |
| A layout (header and footer) | About 25 credits |
| A form | About 30 credits |
| A component or email design | About 30 credits |
| A new site started with AI, paid plan | About 160 for 3 pages to 300 for 8 |
| A new site started with AI, Free plan | About 115 for two pages, within the 300 Free credits |
| Products, booking services, overlays, A/B tests, funnels, variables in a chat build | Almost nothing |
| [Stock photos](./stock-photos.md) in an AI site | Nothing |

A model you choose with the **Model** switch can cost more or less than **Auto**; the switch
shows each model's cost. See [Choosing a model](./ai-allotments.md#choosing-a-model).

## Before a job starts {#before-a-job-starts}

Every job tells you what it will cost before it spends anything:

- **A plan** shows **Estimated cost: About N credits (up to M)** beside **Confirm plan**:
  about what jobs like it cost on real builds, and the most it can cost. What it really
  costs is what its steps spend, and you can watch that add up on the job. **Try again**
  shows the same for the parts it will run again.
- **On the Free plan**, a job is checked against the credits you have left this month, and
  the window or plan card shows how many that is. A job that will very likely fit starts
  with no question asked. One that will likely use more than you have left says so before
  it starts, for example *This build is about 106 credits (up to 650). You have 90 left, so
  it will build as much as it can and pause when your credits run out.* Nothing starts
  until you choose:
  - **Build what fits** builds as much as your credits cover, then pauses. Choose
    **Resume** after you upgrade or when your credits renew, and it carries on from where it
    stopped. Nothing it already built is built or charged again.
  - **Build the home page first** builds a smaller first version: the home page and what it
    needs, such as its layout and the form it shows. Ask for the rest later.
  - **Upgrade** opens **Billing**.

  With no free credits left at all, nothing can start until they renew or you upgrade.
- **A picture** shows its credits per picture and in total before **Create**.

## When credits run out {#when-credits-run-out}

- **A job that is building pauses** rather than failing. What it built so far is kept, and
  it carries on from there with **Resume** once there are credits again, or by itself within
  about an hour. See [Paused, or out of credits](./start-with-ai.md#paused-or-out-of-credits).
- **A new request** on a Free workspace, or on a paid workspace that stops at its band, is
  refused with a message saying when credits reset.

## Past the band {#past-the-band}

On a paid plan, AI keeps working past the included band, and the extra credits are billed
on your monthly invoice at your plan's rate per 1,000 credits. In **Billing → Usage** you
can instead:

- **stop at the included band**, so AI pauses there; or
- **set a ceiling**, so overage stops at an amount you choose.

Owners and admins are alerted on the way. See
[AI assist overage](../workspace-and-billing/billing-and-plans/overview.md#assist-overage).

## Credits given back {#credits-given-back}

When a job fails because of something on our side, such as an AI provider error, a step
that timed out, or a plan that still broke the building rules after being asked again, its
credits are given back automatically:

- **all of them**, if it built nothing;
- **the failed step's**, if it had already built something, which you keep.

The job says *This one's on us — you weren't charged.* and how many credits came back. Up
to three jobs a day are given back this way.

Credits are **not** given back when you cancel a job yourself (you pay for what ran until
then, and credits held for steps that never ran are released; see
[Cancel a job](./ai-jobs-and-activity.md#cancel-a-job)), or when the AI declines what the brief asked for. A picture that is declined or
does not come out is never charged in the first place.

## See your credits {#see-your-credits}

- **Billing → Usage → AI credits** shows the credits drawn this month against the
  pool, and how many of them your tier adds.
- **Who is generating what**, on the same page, lists each member's credits by month.
  See [Billing & Plans](../workspace-and-billing/billing-and-plans/overview.md#who-is-generating-what).
- **The usage line** in the assistant and the AI dialogs shows your own credits, the
  workspace's and your last request. See
  [Your usage while you work](./ai-allotments.md#usage-strip).
- **A site's AI jobs page** shows what each job used. See
  [AI jobs and activity](./ai-jobs-and-activity.md).

To give one member or one site its own monthly share, see
[AI allotments](./ai-allotments.md).

## Related

- [Aglyn AI overview](./overview.md#credits-and-caps)
- [AI allotments, usage and model choice](./ai-allotments.md)
- [Billing & Plans](../workspace-and-billing/billing-and-plans/overview.md)
