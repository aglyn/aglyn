---
sidebar_position: 15
title: Bookings
description: Read a site's bookings over the API — the service, the time, the guest and what they paid — to sync a calendar, a CRM or a spreadsheet.
---

# Bookings

Read the bookings a site has taken, so you can copy appointments into a calendar,
a CRM or a spreadsheet, or report on them. The API is **read-only**: moving or
canceling a booking tells the guest and can refund them, so it stays in the console.

Bookings belong to a **site**, because each site offers its own services.

:::info Requires bookings on your plan
These endpoints need the `bookings:read` scope **and** a plan that includes
bookings. If your plan doesn't, they answer `403 plan_required` with `code:
"bookings"` — see [Errors](#errors).
:::

## The booking object

```json
{
  "id": "b7Qn2kV0xP",
  "object": "booking",
  "serviceId": "svc_consult",
  "serviceName": "30-minute consultation",
  "status": "confirmed",
  "name": "Avery Chen",
  "email": "avery@example.com",
  "phone": "+15125550123",
  "address": null,
  "startsAt": "2026-10-14T15:00:00.000Z",
  "endsAt": "2026-10-14T15:30:00.000Z",
  "timeZone": "America/Chicago",
  "currency": "usd",
  "paidCents": 5413,
  "taxCents": 413,
  "refundedCents": 0,
  "checkedIn": false,
  "checkedInAt": null,
  "rescheduledFrom": null,
  "created": "2026-10-07T18:22:10.000Z"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Opaque booking id. |
| `object` | string | Always `"booking"`. |
| `serviceId` / `serviceName` | string \| null | The service booked, and its name when it was booked. |
| `status` | string | `confirmed`; `pendingPayment` — a paid booking whose checkout is still open; `expired` — that checkout ran out and the slot was released; or `canceled`. |
| `name` / `email` | string \| null | The guest. |
| `phone` / `address` | string \| object \| null | Present when the service asked for them. |
| `startsAt` / `endsAt` | string \| null | ISO 8601, UTC. |
| `timeZone` | string \| null | The zone the booking was made in, e.g. `America/Chicago`. |
| `currency` | string | Always `usd`. |
| `paidCents` | integer | What the guest paid, tax included. `0` for a free booking. |
| `taxCents` | integer | The tax inside `paidCents`. |
| `refundedCents` | integer | Refunded so far. A booking refunded in full is `canceled`. |
| `checkedIn` / `checkedInAt` | boolean / string \| null | Whether, and when, the guest was checked in. |
| `rescheduledFrom` | string \| null | Where a moved booking started before its latest move. |
| `created` | string \| null | ISO 8601. |

## Endpoints

### List bookings

`GET /v1/sites/{siteId}/bookings` — scope `bookings:read`.
[Paginated](../conventions.md#pagination), ordered by id.

| Query | Notes |
| --- | --- |
| `status` | `confirmed`, `pendingPayment` or `canceled`. An expired checkout is stored as `pendingPayment` and reads as `expired`; any other value is a `400`. |
| `serviceId` | Bookings of one service. |
| `limit`, `cursor` | [Standard pagination](../conventions.md#pagination). |

```bash
curl "https://app.aglyn.com/api/v1/sites/s_main/bookings?status=confirmed" \
  -H "Authorization: Bearer aglyn_sk_…"
```

### Retrieve a booking

`GET /v1/sites/{siteId}/bookings/{bookingId}` — scope `bookings:read`.

Returns a booking object, or `404 not_found` (`"No such booking"`).

## Errors

| Status | `type` | When |
| --- | --- | --- |
| `400` | `bad_request` | An unknown `status` (`code: "validation_failed"`). |
| `403` | `insufficient_scope` | Key lacks `bookings:read`. |
| `403` | `plan_required` | Plan no longer includes bookings (`code: "bookings"`). |
| `404` | `not_found` | Unknown or unowned site; unknown booking. |
| `405` | `method_not_allowed` | Anything other than `GET`. |

## Related

- [Bookings](/commerce-and-bookings/bookings/overview) — services, hours and bookings in the console.
- [Conventions](../conventions.md) — pagination, ordering, errors.
