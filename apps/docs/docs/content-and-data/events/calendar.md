---
sidebar_position: 2
title: Calendar, categories and repeating events
description: Show your events by month, week or list, filter them by category, repeat an event every week, sell tickets from it, and let visitors add it to their own calendar. Rolling out.
---

# Calendar, categories and repeating events

:::caution Rolling out
The new events calendar is **rolling out**, so your workspace may not have it yet.
Until it does, the Events page and the Event List element work as described in
[Events Calendar](./overview.md), and the elements on this page show nothing on your site.
:::

The new events calendar builds on the [Events Calendar](./overview.md) add-on. It adds:

- a **Calendar** element with month, week and list views,
- **categories** with your own colors, which visitors filter by,
- **repeating events**, such as a practice every Thursday,
- a **Tickets** button on an event, from a store product or a booking service,
- **Add to calendar** for visitors, and a calendar they can subscribe to,
- an **Event details** element for an event page you design once,
- your events in your site's **search**.

## Categories {#categories}

The **Categories** card sits under the Events card on the **Events** page.

1. Select **Add category**.
2. Type a name, such as *MX Training* or *Kids Camp*.
3. Pick a color. The chip on the Calendar and the dot beside each of its events use it.
4. Select **Save category**.

Use the arrows to change the order the chips appear in. **Delete** takes the category
off every event in it; the events stay. A site can have up to 30 categories.

In the event editor, tap a category chip to put the event in it, and tap it again to
take it out. An event can be in more than one category.

## Repeating events {#repeating-events}

In the event editor, set **Repeats**:

- **Does not repeat**: a one-off event.
- **Daily**, **Weekly** or **Monthly, on the same date**.

Then fill in what applies:

- **Every**: every 1 to 52 days, weeks or months. *Every 2 weeks* is every other week.
- **On** (weekly only): the days of the week it is held. Leave them all off to repeat on
  the day it starts.
- **Ends**: **Never**, **On a date** (the last day it can happen), or **After a number of
  times**.
- **Skip a date**: pick a date and select **Skip** for a day it is not held, such as a
  holiday. Each skipped date shows as a chip; remove the chip to hold it again.

**Starts** and **Ends** at the top of the editor are the first time it happens. Every
date after it keeps the same time of day, also on the days the clocks change.

A monthly event on the 31st skips months that have no 31st.

## The Calendar element {#calendar-element}

In the Besigner, add **Calendar** from the element list to any page. In its attributes:

- **Heading**: shown above the calendar. Leave it empty for none.
- **Opens on**: **Month**, **Week** or **List**, for computers and tablets.
- **List days**: how many days the list view shows at once. The default is 60.
- **Hide category filters**, **Hide search** and **Hide subscribe link**.

Visitors move between dates with **Today** and the arrows, switch views, filter by
category, and search the events by their words. Phones always get the list, grouped by
day, because a month grid is too small to read on a phone.

Selecting an event opens its details: the date and time, how it repeats, the place, the
description, its categories, the **Tickets** button, **Add to calendar**, and its next
dates.

**Subscribe to this calendar** adds the whole calendar to the visitor's calendar app,
which keeps it up to date. With a category chosen, they subscribe to that category only.

## Event details page {#event-details-page}

You can give events a page of their own instead of the window over the calendar.

1. Make a page, such as **/event**, and design it like any other page.
2. Add the **Event details** element where the event should show. Its **When there is
   no event** attribute is what the page says when it is opened without an event.
3. In your site's plugin settings for **Events Calendar**, set **Event details page
   path** to the page, such as `/event`.

Links to an event from site search then open that page on the event. Set **Calendar
page path** to the page that holds your Calendar, such as `/events`, so links that do
not use an event page open the Calendar on that event.

## Tickets {#tickets}

In the event editor, set **Tickets**:

- **A product from your store**: pick the product. **Get tickets** puts it in the
  visitor's cart. When the product asks for the day it is used, the event's date is
  filled in. A product with options to choose opens its product page instead.
- **A booking service**: pick the service. **Book** opens your booking page on that
  service. Set your booking page in the Bookings plugin settings.

**Button label** changes the button's words. The price the store or the service shows
appears beside the button.

## Add to calendar {#add-to-calendar}

Each event's details have two buttons:

- **Add to Google Calendar** opens Google Calendar with the event filled in.
- **Apple or Outlook (.ics)** downloads the event as a calendar file.

## Site search {#site-search}

Your site's search finds your published events by their title, description, place and
category, each at its next date in the coming six months. Search also finds:

- **Booking services**, linked to your booking page on the service.
- **Stays** (cabins, RV sites and campsites), linked to the page you name for each one.
  On the stay's editor in **Reservations**, set **Page on your site** to the page that
  holds its booking widget, such as `/cabins/lakeside`. A stay without a page is not a
  search result.

## Import and export {#import-and-export}

Events files gain five columns:

| Column | What it holds |
| -- | -- |
| **Categories** | Category names, separated by commas. A name the site has no category for is reported in the dry run and left off; add categories on the Events page first. |
| **Repeats** | The repeat rule as calendar apps write it, such as `FREQ=WEEKLY;BYDAY=TH;UNTIL=20270301`. Blank means it does not repeat. Daily, weekly and monthly rules are read. |
| **Skip dates** | Dates the event is not held, as `2026-11-26`, separated by commas. |
| **Time zone** | The zone a repeating event keeps its time in, such as `America/Chicago`. |
| **Tickets** | `product:` or `service:` followed by the product's or service's ID. |

## Aglyn AI {#aglyn-ai}

When Aglyn AI adds events for you, it can make one event that repeats (a weekly
practice, say) instead of one event per date, and put it in one of your categories when
one fits.
