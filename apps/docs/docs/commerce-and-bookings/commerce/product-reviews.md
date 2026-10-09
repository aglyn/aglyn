---
sidebar_position: 4.3
title: Product reviews
description: Let customers rate and review your products, mark reviews from real buyers as verified, approve or reject each one before it is published, and reply in public.
---

# Product reviews

Product reviews let customers rate a product from one to five stars and write
about it on your site. Every review waits for you to approve it before anyone
else sees it, and a review from someone who bought the product is marked
**Verified buyer**.

Reviews are part of the **Pro** plan and above. On a lower plan the **Review
moderation** card offers an upgrade instead, and the review form on your site
does not accept new reviews. Anyone who can edit the site can moderate and
reply.

## Add reviews to your product pages {#add-the-reviews-block}

1. Open the site in Besigner and go to your product page.
2. Add the **Product reviews** element from the **Commerce** elements, below
   the product details.
3. Optionally, set its **Heading**. It reads **Reviews** when you leave it
   empty.
4. Leave **Product id** empty on a product page template, so the block shows
   the reviews of whichever product the page is showing. Choose a product only
   when you want the block to show that one product's reviews wherever you
   place it.
5. Publish the site.

The block shows the product's approved reviews, newest first, with the average
rating and how many reviews there are next to the heading, for example
**Reviews (4.5 ★ · 12)**. Under them is a **Write a review** form.

Approved reviews also give the product page its star rating in search results:
the product's structured data carries the same average and count the block
shows.

## How customers leave a review {#write-a-review}

The **Write a review** form asks for a star rating, the review (**What did you
think?**), a **Name** and an **Email (verifies your purchase)**. The review and
the email are required. A review is cut off at 2,000 characters and a name at
80; a review left without a name is shown as **Anonymous**.

After **Submit review**, the customer sees **Thanks — your review is awaiting
moderation.** Nothing is published until you approve it. If the form can't be
sent, the customer sees **Could not submit — check the fields.**

The email address is never shown on your site.

### Verified buyers {#verified-buyers}

When a review comes in, Aglyn looks for a paid order from the same email
address that includes the product. If it finds one, the review is marked
**Verified** on the card and **Verified buyer** on your site. A product the
customer was refunded for doesn't count.

## Moderate reviews {#review-moderation}

1. Open your site's **Products** page and choose **Promotions**.
2. Find the **Review moderation** card. It opens on **Pending** reviews, newest
   first. Use **Show** to switch to **Approved**, **Rejected** or **All**.
3. For each review, choose:
   - **Approve** to publish it on the product page;
   - **Reject** to keep it off your site.

You can change your mind later: an approved review can be rejected and a
rejected one approved. Your site picks up the change within a few minutes.
When the queue is empty, the card says **Nothing to moderate.**

### Reply to a review {#reply}

Select **Reply** under a review, type your answer and select **Save**. The reply
is public: it appears under the review on your site, after **Seller:**, once the
review is approved. Use **Edit reply** to change it, or clear the text and save
to remove it. A reply is cut off at 500 characters.

## Troubleshooting {#troubleshooting}

| What happens | What to do |
| -- | -- |
| The **Review moderation** card offers an upgrade | Reviews need the Pro plan or above. |
| Customers can't submit reviews | Check the workspace's plan includes reviews. Reviews submitted on a plan without them are refused. |
| An approved review doesn't show on the product page | Wait a few minutes and reload. Check the block's **Product id** is empty on a product template, or names the right product. |
| A real buyer's review isn't marked verified | They used a different email address from the one on their order, or the product was refunded. |
| The block shows **★★★★★ Product reviews render here** | That is its placeholder in Besigner. Reviews show on the published site. |

## Related

- [Product catalog](catalog.md)
- [Discounts and coupons](discounts-and-coupons.md)
- [Commerce](overview.md)
