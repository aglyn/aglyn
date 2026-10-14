---
sidebar_position: 2.2
title: AI jobs and activity
description: "Review what Aglyn AI did: a site's AI jobs page lists every job with its kind, brief, status and credits, each job has its own page, and the AI filter in your activity logs records who started, applied or canceled what."
---

# AI jobs and activity

Everything Aglyn AI builds is done by an **AI job**, and every job is kept where you can
review it: what was asked, what was planned, what was built, what it cost and who
started it.

## The AI jobs page {#the-ai-jobs-page}

Each site has an **AI jobs** page: open it from **AI jobs** in the trail above a job's
page, or from **See this site's AI jobs**. It lists the 50 most recent jobs on the site,
newest first. Each row shows:

- the **kind** of job, such as a page, a form, a site or a build from the chat;
- its **status**;
- the **credits** it used and when it ran;
- the start of its **brief**, as you wrote it;
- whether credits were given back.

Each row opens the job's own page. The page needs the **Generate with AI** permission.

## Statuses {#statuses}

| Status | What it means |
| --- | --- |
| **Queued** | Waiting to start, usually for a moment. |
| **Planning** | Working out what to build. |
| **Plan ready** | Waiting for you to read the plan and choose **Confirm plan**. Nothing is built until you do. |
| **Building** | Building what the plan lists. |
| **Needs attention** | Stopped for something only you can change, such as credits or a plan to confirm. |
| **Done** | Finished. Its drafts are ready to open. |
| **Failed** | Stopped before it finished. The job says why, and whether its credits were given back. |
| **Canceled** | Canceled by a person. |

## One job's page {#one-jobs-page}

A job's page shows each step as it happens, with its own state (**Done**, **Waiting**,
**In progress**, **Paused**, **Not built** or **Couldn't be built**) and the credits each
step used. From there you can:

- **Confirm plan**, when a plan is waiting for you;
- **Resume** a job that paused for credits, or **Get more AI credits**;
- **Try again**, or **Try again what failed** to build only the parts that failed;
- **Cancel** a job that is still running (see [Cancel a job](#cancel-a-job));
- open what it built: **View your site**, **Edit your pages**, or the draft itself.

For a new site this is the **Building your site** page; see
[Start a new site with AI](./start-with-ai.md#building-your-site).

## AI jobs in Assist {#ai-jobs-in-assist}

The **AI jobs** list at the top of the [Assist](../getting-started/aglyn-assist.md) panel
follows the workspace's jobs wherever you are in the console. It opens on its own while
a job is running or waiting for you, counts the jobs that **need you** and are
**running**, and shows each job's steps, credits and plan, with **Cancel** while it runs.

The **AI** chip in the top bar, beside the notifications bell, appears while any job is
running or waiting: **AI · plan ready**, **AI · needs attention**, **AI · planning** or
**AI · working**. Choose it to open that job in the list.

A notification arrives when a plan is ready, when a job finishes and when it stops. Turn
them off under **AI job needs you**, **AI job finished** and **AI job stopped** in your
notification settings.

## Cancel a job {#cancel-a-job}

You can stop a job at any point before it finishes. **Cancel** is on:

- the job's own page, such as **Building your site**;
- each row of a site's **AI jobs** page, from the row's **⋮** menu (**Cancel job**);
- each running job in the **AI jobs** list in Assist, which the **AI** chip in the top bar
  opens.

Each asks first, in a **Cancel this AI job?** window. Choose **Cancel job** to stop, or
**Keep building** to let it carry on. Cancel needs the **Generate with AI** permission on
the site.

What happens when you cancel:

- **Nothing more runs.** If a step is in progress, it stops, or finishes if it is about to,
  and the job shows *Stopping* until it has. Nothing after it starts.
- **What it built stays, as drafts.** Pages, layouts and forms it already made are kept as
  unpublished drafts for you to open, edit or delete. A canceled job never publishes
  anything, so your live site is unchanged.
- **You pay only for what ran.** Credits held for the steps that did not run are released.
  The steps that finished stay charged, and the job says how much, for example
  *This job used 42 credits before it stopped.* A job you cancel is not counted as a
  failure, so it is not given back and you are not sent a "job stopped" notice.
- **It is recorded.** *Canceled an AI generation* is added to the site's activity, with
  who canceled it.

A canceled job shows **Canceled** in every list. A job that is already **Done** or
**Failed** cannot be canceled; its **Cancel** is turned off and says why.

### Cancel a new site {#cancel-a-new-site}

If you cancel a site you started with AI, the **Building your site** page says
**You canceled your site** and offers:

- **Start again**, which reopens the questions with your answers filled in, for a fresh job;
- **Use the starter site instead**, which gives the site the starter home page. It is
  offered only while the job had not built anything yet.

## AI activity {#ai-activity}

AI actions are recorded in the same activity logs as every other change, and each log has an
**AI** filter:

- **A site's activity**, under the site's **Admin → Activity**, lists the AI work on that
  site: *Started an AI generation*, *AI generated*, *Canceled an AI generation*,
  *AI generation paused for input*, *Applied AI edits*, *Applied AI SEO fixes as drafts* and
  *AI generated a section*.
- **The workspace's activity**, under **Team → Activity**, also lists the AI settings
  changed: the stop at the included band, the overage ceiling, an AI allotment, an AI
  permission, and the Aglyn AI add-on being added or removed.

Each entry names who did it, where and when. The workspace log needs the permission to
view the organization's activity.

## How long jobs are kept {#how-long-jobs-are-kept}

A job, with its brief, is kept for 180 days and then deleted. What it built is yours and
stays until you delete it. See [Privacy and Aglyn AI](./ai-privacy.md#how-long-it-is-kept).

## Related

- [How Aglyn AI builds](./how-aglyn-ai-builds.md#finding-your-ai-jobs)
- [AI credits](./ai-credits.md)
- [Build from Assist chat](./assist-builds.md)
