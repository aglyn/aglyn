---
sidebar_position: 4
title: Insights
description: Ask Aglyn AI a question about your site's figures in plain words, and get answers where every number is traced to the figure it comes from — plus weekly insights by email.
---

# Insights

Ask a question about your own numbers — *"which pages brought in the most visitors, and did
anything change?"* or *"what is the average order total by state?"* — and Aglyn AI answers
from your site's figures. It never guesses a number: every insight links to the rows it was
read from, and an insight whose numbers cannot be found in those rows is left out.

:::info Availability
Insights are part of Aglyn AI, which is released gradually. This page applies as insights reach
your workspace. Asking a question uses AI credits, like any AI job.
:::

## Asking a question

Open the **Assist** panel on one of these pages and choose **Ask about your numbers** under
**AI jobs**:

- a site's **Analytics** page — traffic, top pages, where visits came from, forms, bookings,
  campaigns, A/B tests and store sales;
- a site's **CRM → Reports** page — the same figures, for questions about where people came
  from and what they did;
- a site's **Data** page, or your organization's **Data** page — your datasets.

Type your question, pick the window it covers (the last 7, 14, 30 or 90 days), and choose
**Ask**. Answers usually take about a minute. You can close the dialog while you wait: the
answer stays under **AI jobs**, where **View answer** opens it again.

## How an answer is made

1. **The figures are read, never written.** Aglyn AI chooses which of your figures answer the
   question — for example your traffic and your top pages — and Aglyn reads them the same way
   the console's own cards do. AI never writes a database query and never sees a single
   visitor, contact, order, booking or submission: only totals, counts and rates.
2. **Each insight cites its rows.** Choose **Show the figures** under an insight to see the
   rows it was written from, and follow the link to the page those figures come from.
3. **Untraceable insights are left out.** Every number an insight writes must appear in a row
   it cites — as the table shows it, or rounded. An insight that adds figures together, works
   out a rate of its own, says a figure rose when it fell, or names a person is left out, and
   the answer says how many were.

When your figures cannot answer part of a question, the answer says so in one sentence rather
than filling the gap.

## Asking about datasets

On a **Data** page, a question can summarize a dataset — how many records it holds, how many
fill each field, and for a number field its lowest, average and highest value — or group its
records by one field, such as the average order total by state.

- A site's **Data** page reads only the datasets shared with that site, and your organization's
  **Data** page reads the datasets you can see.
- A breakdown reads up to the first 2,000 records of a dataset and says so when there are more.
- Group by a field many records share, such as a state, a status or a category. A field with more
  than 60 different values, such as a name or an order number, can't be grouped by.
- Groups of fewer than three records are counted together as **Other**. No record is ever sent to
  AI.

## Weekly insights

In the **Ask about your numbers** dialog, turn on **Send me weekly insights for this workspace
every Monday**. Each Monday, Aglyn AI writes a few insights for up to five of your busiest sites
you can reach: the change in traffic, the most viewed page, the form that turned the most views
into submissions, a campaign that did better than the rest, and any day that stood out — only
those the figures support.

- They arrive as a notification and an email, and are listed under **AI jobs**.
- Each site's weekly insights are an AI job and use AI credits. When your workspace has used its
  AI credits for the month, that week's insights are skipped without a message.
- Turn them off from the same dialog, or under **Weekly insights** on the
  [Notifications](../../getting-started/console-tour.md#daily-digests) page. Muting
  **Forms & bookings** there silences the notification but not the email.
- Weekly insights are made only for people who can run AI jobs on the site.

## Privacy

- Only totals, counts, rates and labels are sent to the AI provider: page paths, referring
  sites and campaign tags; the names of forms, services, products and A/B tests; the subjects of
  campaign emails; and for a dataset, its field names and types and, in a breakdown, the values
  that at least three records share. Email addresses and phone numbers are removed from every
  label before anything is sent.
- An answer is kept with your workspace for 180 days, like other AI jobs. Only the person who
  asked can open it; weekly insights can be opened by the people who reach the site.
- Nothing is changed, published or sent to your contacts. The weekly email goes only to people
  in your workspace who asked for it.
