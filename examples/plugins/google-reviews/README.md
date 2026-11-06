# Google reviews

Show your Google star rating and your latest Google reviews on your website.
They come straight from your Google Business Profile and stay up to date on
their own, so you never copy a review by hand again.

## What you get

- **A "Google reviews" element** to place on any page. It shows:
  - your average rating, in stars, and how many reviews you have on Google;
  - a card for each review, with the reviewer's name, their stars, the date
    and what they wrote, plus your reply when you have written one;
  - a **Review us on Google** link, so happy customers can leave a review in
    one tap.
- **Your rating, review count and review link, for use anywhere on the site**,
  for example in a hero line or a footer (see *Use your rating in any text*
  below).

Only real reviews are shown. Until your site is connected, and if no review
matches your settings, the element shows nothing to visitors.

## Before you start

- Your site needs the **Starter plan or higher**.
- You need a **Google Business Profile** for your business, and to be able to
  sign in to Google as one of its owners or managers.

## Set it up

1. **Install** Google reviews from the Marketplace.
2. Open the plugin's page for your site and select **Connect**. Google asks you
   to sign in and to let Aglyn see your Business Profile. Allow it.
3. **Choose your account**, then **choose your location** (the business whose
   reviews you want to show).
4. Your reviews arrive, usually within the hour. After that they refresh about
   every 6 hours, and **Sync now** fetches them straight away.
5. In the Besigner, add the **Google reviews** element to a page and publish.

## Settings

Select the element in the Besigner to change these:

| Setting | What it does | Starts as |
| --- | --- | --- |
| How many reviews | How many review cards to show, newest first (up to 50) | 6 |
| Minimum stars | Show only reviews with at least this many stars | Any rating |
| Layout | **Grid** of cards, a **List** one under another, or a **Carousel** row visitors swipe sideways | Grid |
| Reviewer image | Each reviewer's **Initials**, or their **Google photo** | Initials |
| Show the rating summary? | Your average rating and review count above the cards | On |
| Show your replies? | Your reply under a review, when you have written one on Google | On |

The cards use your site's own colors, fonts and dark mode. Reviewers who
chose to stay anonymous on Google always show initials. The rating summary
always shows Google's own average and count, whatever you choose for minimum
stars.

## Use your rating in any text

Google reviews adds three values to your site that you can put in any text,
button or link, on any page:

- **rating**: your average Google rating, as Google reports it (for example
  4.8);
- **reviewCount**: how many reviews you have on Google;
- **reviewUrl**: the page where a customer leaves you a Google review.

In the Besigner, select the field you are typing in and use its **`{x}`**
insert button to pick one. A line like "Rated 4.8 by 44 customers on Google"
then keeps itself up to date. A value shows nothing until your site is
connected.

## What it reads, and from where

Aglyn connects to Google for you. The plugin itself never sees your Google
password or sign-in, and never contacts Google on its own.

- **Permission asked for:** manage your Business Profile
  (`https://www.googleapis.com/auth/business.manage`), the one permission
  Google's Business Profile API has; it has no read-only one. Aglyn only ever
  reads with it: it never replies to, changes or removes anything on your
  profile.
- **What Aglyn reads:**
  - the accounts and business locations your Google sign-in can see, so you can
    pick one;
  - for the location you pick, its "leave a review" link;
  - its average rating, its review count and its 50 newest reviews (each
    reviewer's name and photo link, the stars, the review text, the date, and
    your reply).
- **From these Google addresses only:**
  - `mybusinessaccountmanagement.googleapis.com` (your accounts);
  - `mybusinessbusinessinformation.googleapis.com` (your locations and review
    link);
  - `mybusiness.googleapis.com` (your reviews).
- **Shown on your site:** what the element and the three values display. If
  you choose Google photos, they load from `lh3.googleusercontent.com`.
- **Kept:** only the latest copy, replaced at every refresh, and stored with
  your site.
- **Disconnect** at any time from the plugin's page for your site. That removes
  what was last brought in from your site. You can also remove Aglyn's access in
  your Google Account's security settings.

Reviews are shown with their reviewer's name, as on Google, and the element
says they are from Google.

## License

Apache-2.0.
