---
sidebar_position: 5
title: Zapier
description: Send your site's orders, bookings, contacts and form submissions to thousands of apps with Zapier, and add contacts or mark orders shipped from them. Rolling out.
unlisted: true
---

# Zapier

:::caution Rolling out
The Aglyn app on Zapier is **not yet published**. Until it is, no **Zapier** card
appears on your site's setup page and Aglyn is not listed in Zapier's app directory.
:::

Zapier connects Aglyn to thousands of other apps without code. A **Zap** starts on a
trigger — something that happened on your site — and runs actions in other apps; or it
starts somewhere else and acts in Aglyn.

## Connect Aglyn to Zapier

Zapier signs in to Aglyn with an **API key** from your organization, so you choose
exactly what it can read and do.

1. In Aglyn, open your organization's settings and create an API key — name it
   *Zapier*, so you can tell it apart later. Give it the [scopes](#what-each-needs)
   your Zaps need, plus `sites:read` so Zapier can list your sites.
2. In Zapier, start a Zap and choose **Aglyn**.
3. When Zapier asks you to connect an account, paste the key.

API keys are part of plans that include API access. Each trigger and action also needs
what the matching part of Aglyn needs on your plan: commerce for orders, bookings for
bookings, the CRM for contacts.

## Triggers

Each trigger starts a Zap for one site, which you pick when you set it up. Aglyn sends
the event to Zapier as it happens — usually within a minute — and tries again with
backoff for most of a day if Zapier does not answer.

| Trigger | Starts a Zap when |
| --- | --- |
| **New Paid Order** | An order is paid: a storefront checkout, a buy-now, a payment link, a sale at the register, or a subscription renewal. |
| **Updated Order** | An order is shipped, delivered, refunded or canceled. Choose which. A partial shipment or refund starts it once each time. |
| **New Booking** | A booking is confirmed: a free one when it is made, a paid one when its payment lands. |
| **Updated Booking** | A booking is rescheduled or canceled. Choose which. |
| **New Contact** | A new person is added to your contacts — from a form, a booking, a purchase, or the API. |
| **New Form Submission** | Someone submits a form on the site. Optionally, only one form. |

Each sends the record as the [REST API](/api) shows it — an order with its line items,
totals, customer and shipping address; a booking with its service, time and guest; a
contact; or a submission with every field — so a later step can use any field.

## Actions and searches

| Action | What it does |
| --- | --- |
| **Create Contact** | Adds a person to your contacts, with their name, tags and notes, and — for a site you choose — their phone number and lifecycle stage. An address already in your contacts is refused; use **Find or Create Contact** instead. |
| **Update Contact** | Changes a contact's name, tags, notes, phone number or lifecycle stage. |
| **Mark Order Shipped** | Records a shipment on an order — marks it shipped or delivered, with the carrier and tracking number — and tells the buyer unless you turn that off. It never cancels or refunds an order. |
| **Find Contact** | Looks a contact up by email address. Add **Create if not found** to make it a find-or-create. |
| **Find Order** | Looks an order up on a site by its id. |

## What each needs

| Trigger, action or search | API key scope |
| --- | --- |
| New Paid Order, Updated Order, Find Order | `orders:read` |
| Mark Order Shipped | `orders:write` |
| New Booking, Updated Booking | `bookings:read` |
| New Contact, Find Contact | `contacts:read` |
| Create Contact, Update Contact | `contacts:write` |
| New Form Submission | `forms:read` |
| Choosing a site | `sites:read` |

## See and disconnect your Zaps

The **Zapier** card on a site's setup page lists every Zap that takes the site's
records: what it takes, the API key it connected with, and when it was last sent
something. A site admin can **Disconnect** one there, and it stops receiving events at
once.

A Zap also stops receiving events when:

- you turn it off or delete it in Zapier;
- you revoke the API key it connected with — every Zap on that key stops;
- your plan no longer includes what it reads (it resumes when the plan does).
