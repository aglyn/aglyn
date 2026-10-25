---
sidebar_position: 2.75
title: Bring my site
description: Bring the website you have now into Aglyn, its pages, words and photos, in waves you review and start yourself, once you have proved the site is yours.
---

# Bring my site

**Bring my site** moves the website you have now into a new Aglyn site. Aglyn AI
reads each of its pages and rewrites it in your new site's design, keeping its words,
facts and photos. Pages come in a few at a time, in **waves**. You review each wave
before you start the next.

It is included on every paid plan. On the Free plan the card is shown but turned off,
with a link to upgrade.

## Start {#start}

1. Open **Sites** and choose **Create site**.
2. Fill in your new site's **Site name** and **Subdomain**.
3. Choose **Bring my site**.

No site is created yet. The close control and the Escape key close the window and
create nothing.

## Your current website {#your-current-website}

Under **Website address**, type the address people use to reach your site today,
for example `example.com`, and choose **Next**. Leave out `www.`: the site's two
names are treated as one site.

You need to prove the site is yours before anything is read from it. This makes
sure only a site you own can be brought in.

## Prove it is yours {#prove-it-is-yours}

Use **one** of these three ways. The status at the top shows **Verified** once one
of them works.

- **Add a DNS record.** At the company where your domain is registered, or wherever
  its DNS is managed, add a TXT record. Copy its **Name** and **Value** from the card,
  then choose **Check the DNS record**. A new record can take a few minutes to an hour
  to show up. If it is not found yet, the card says so and you can check again.
- **Add a tag to your home page.** In the builder your site uses today, open the
  setting for header code on your home page. It is often called **Custom code** or
  **Header code**. Paste the tag you copy from the card's **Tag** field, publish your
  site, then choose **Check my home page**.
- **Get a code by email.** Type the part of an email address that comes before the
  `@`. The part after it is always your site's domain. Choose **Send a code**, then
  type the six-digit code from the email and choose **Confirm the code**. A code
  stays valid for 15 minutes.

Once the site is verified, choose **Next**. A proof stays valid for 30 days.

## Read my site {#read-my-site}

Choose **Read my site**. Aglyn then:

- creates your new site, with nothing on it and nothing published;
- reads your current site as **AglynBot**, starting with its robots.txt file and its
  sitemap, and only on your own domain. Your current site is not changed.

Reading uses no AI credits. When it is done, **Your site is read** shows:

- what was found, grouped as your **Main pages** and each **collection**, such as a
  blog's posts;
- how many pages your plan includes, how many will be brought in, and in how many waves;
- each page's old address and its address on your new site;
- under **Not brought in**, every page that was left out and the reason.

## Waves {#waves}

- **The first wave** brings in your main pages: home, then the pages in your menu,
  then your other top-level pages. It also builds your new site's header and footer,
  with the menu linking those pages.
- **Each later wave** brings in up to 10 pages of one collection, for example
  **Blog, 1 of 3**.
- **Never past your plan.** Your main pages are kept first. If your site has more pages
  than your plan allows, the last pages of your collections are the ones left out, each
  listed with **Past your plan's page count**. **See plans** opens Billing.

To start a wave, choose its **Start** button, for example **Start Main pages**. Each wave
shows its cost before you start it. A page costs about 27 AI credits, the same as any page
Aglyn AI writes, and the header and footer cost about 29. Credits are used as each page is
written. A page that fails on our side gives its credits back.

While a wave runs, its page lists each page as it comes in. You can leave the page.
You are told when the wave is in.

## Review a wave {#review-a-wave}

When a wave is in, its page says so, for example **Main pages is in**, and shows:

- every page of the wave, with **Open draft**, its old and new address and how many photos
  were added;
- a page that could not be brought in, with the reason;
- how many AI credits the wave used.

Every page is a **draft**: nothing is published until you publish it. **Open your draft
pages** opens the site's Pages list. When you are ready for more, choose the next wave's
**Start** button. Nothing starts the next wave except you.

**Cancel** stops the import. The pages already brought in stay as drafts.

## Photos {#photos}

A page's photos are copied into your new site's media library and placed on that page
first. The same photo is stored only once, however many pages show it.

## What is never brought in {#never-brought-in}

- **Sign-in pages.** A page that asks for a password is left out, and so is a page AglynBot
  is asked not to read by robots.txt.
- **Code and forms.** Scripts, embedded frames and forms are never brought in.
- **Other websites.** Only pages on your own domain are read. A page that sends visitors to
  another website is left out.

## When an import waits for you {#when-an-import-waits}

- **Verify your site again.** A wave starts only while your proof is less than 30 days old.
  Choose **Verify again**, prove the site is yours once more, then start the wave again.
- **The day's limit.** A workspace can start 12 waves a day, counting each time a site is
  read. Start the wave again the next day.
- **The site could not be read.** If robots.txt could not be read, or no page answered,
  nothing is read. Choose **Read the site again** once your site is up. If your site's
  bot protection turned AglynBot away, see [When your site turns AglynBot away](#turned-away).
- **Out of AI credits.** The import pauses. Choose **Get more AI credits**, then **Resume**.

Every import is also logged for the Trust & Safety team's review.

## When your site turns AglynBot away {#turned-away}

Many hosts protect a site with bot protection or a firewall that turns away visitors it
takes for robots. If yours turns AglynBot away, the page is listed under **Not brought in**
as turned away by your site's bot protection or firewall. If it turns away every page,
nothing is read, and the import says so.

To bring those pages in:

1. Open your site's bot protection or firewall settings, wherever your host or your
   domain's security service keeps them.
2. Allow **AglynBot**. It reads only your own domain, and only pages robots.txt lets it read.
3. Bring the site in again. If nothing was read, choose **Read the site again**.
