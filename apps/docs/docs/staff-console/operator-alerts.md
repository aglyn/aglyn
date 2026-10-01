---
sidebar_position: 10
title: Operator alerts
description: 'Every event an install operator must hear about: which alerts exist, where they go (email and an optional webhook), how staff switch them or batch them daily, and how health checks alert on their own.'
---

# Operator alerts

:::warning Staff only
This page lives at **Staff → Operator alerts** and requires a staff claim. Anyone on
staff can read it; changing a setting or sending a test takes the **super** staff role,
and every change is written to the admin audit log.
:::

An operator alert is an event whoever runs the install has to hear about: a card
dispute lost on a subscription, a data erasure that failed, a health check that went
red, a webhook failing its signature. Each one is a row in one registry, and every row
is delivered the same way, whether the install is Aglyn's own cloud, a self-hosted
deployment or an application built on the open-source packages.

## Where alerts go {#channels}

Every alert does three things, in order:

1. **Writes a console notification** for every staff member, in the bell. This
   always happens, whatever the settings below say.
2. **Emails the operator**, as the **Operator alert** system email, which you can
   redesign on [Staff → System emails](overview.md#system-emails). The address is
   `STAFF_ALERT_EMAIL`; when that is unset, the operator support address
   (`NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL`); when that is unset too, every staff
   account's own address. A preview deployment never falls back past the first.
3. **Posts to the out-of-band webhook**, when `OPERATOR_ALERT_WEBHOOK_URL` is set.
   The body is JSON with a Slack-compatible `text` field, so a Slack incoming webhook
   works as is. With `OPERATOR_ALERT_WEBHOOK_SECRET` set, each post carries
   `x-operator-alert-timestamp` and `x-operator-alert-signature`: `sha256=` followed
   by the hex HMAC-SHA256 of `{timestamp}.{body}` under the secret.

The webhook exists for the failures email cannot report: the mail provider down, or
rejecting its key. Without it, those alerts reach only the console bell.

The page shows which of the three email sources is in use and whether the webhook is
set. **Send test** on any row sends one `[Test]` alert of that type to the inbox and
the webhook, past every switch, so you can prove both reach you.

## Switching alerts {#settings}

Every row has two controls:

- **On**: off keeps the console notification and sends no email and no webhook
  post.
- **Delivery**: **Immediate** sends it as it happens. **Daily digest** batches it
  into one email and one webhook post a day, sent after the hour you choose at the
  top of the page (UTC).

Until you change them, the coded defaults apply:

| Tier | Default |
|---|---|
| **Must know** | On, immediate. Money moving with nobody looking, a legal duty, data not erased. |
| **Should know** | On, and immediate unless the row says otherwise. New support tickets and replies go to the digest. |
| **Routine** | On, in the digest. Listings waiting for review, resources missing a sharing scope. |

A row you set back to its default is removed from the stored settings, so the page
only ever holds the answers staff actually gave.

**In the bell, the tier sets the color.** A must-know alert is red, a should-know
alert amber, and a routine one blue (see [how urgent each notification
is](../getting-started/console-tour.md#notification-levels)). A few alerts name
their own color because their tone and importance differ. A degraded health check
is a must-know, but it is amber because degraded is not down. A recovery is green.
Support tickets are blue. The color changes nothing about delivery: the switches
above decide that.

**Repeats are told once.** Each alert names what makes two raises the same event (a
dispute, a workspace and month, a sending domain), and a repeat inside the alert's
window is counted rather than sent again. The next alert that does go out says how
many it held back. The endpoints anyone on the internet can reach (a webhook failing
its signature) alert only once the failures recur.

## The alerts {#alert-list}

Plugins add their own rows: an install without the commerce plugin shows no commerce
alerts.

| Area | Alert | Tier |
|---|---|---|
| Security | Urgent abuse, fraud or risk alert: phishing, card testing, a flagged payment, a held phishing email | Must |
| Security | An automatic security hold on a new workspace that published a phishing page | Must |
| Billing | Card dispute with no owner; billing webhook half applied | Must |
| Billing | Subscription dispute lost; Stripe billing a workspace that does not exist; a closed month's metered usage not reported to Stripe | Must |
| Billing | Billing webhook failing its signature check; a delivery that moved nothing | Must |
| Data protection | A person's erasure failed; a workspace's erasure failed; the database export failed | Must |
| Legal | DMCA counter-notice; a DMCA takedown, impersonation or illegal-content report | Must |
| Operations | A health check went degraded | Must |
| Operations | A health check recovered; a reaper stuck; a plugin job, consent group change, publish outbox or sending-domain provisioning failing; the bandwidth ceiling reached | Should |
| Billing | Automatic billing lock; an invoice voided or uncollectible; a connected account's payout or transfer failed; a workspace's payment failed | Should |
| Security | Staff access granted or a role raised; a plugin verifier regression | Should |
| Support | A ticket past its response time; new tickets and replies (digest) | Should |
| Email deliverability | Send-rate governor saturated or unavailable; a recipient gateway blocking a shared domain; the email provider rejecting the key or the shared pool unhealthy | Should |
| Payments *(commerce)* | A chargeback that could not be routed; sales tax not reversed; a seller's share not reversed; a platform fee correction refused | Must |
| Email deliverability *(marketing)* | The events webhook failing, unconfigured or rejecting signatures, so bounces go unsuppressed | Must |
| Email deliverability *(marketing)* | Campaigns blocked by the reputation breaker | Should |
| Operations *(AI)* | The platform's AI provider refusing its key or out of credit | Should |
| Routine | A plugin listing waiting for review; resources missing a sharing scope | Routine |

These stay in the console bell and never email: new subscriptions, cancellations,
plan changes, sign-ups, new workspaces, impersonation, and successful backups.

## Health checks alert on their own {#health}

Every health endpoint remembers its last verdict. When one goes from healthy to
degraded, the **Health check degraded** alert goes out once. When it comes back,
**Health check recovered** goes out once. A check that flaps across the line inside an
hour is told once, not on every swing. The page lists each check's current state and
since when.

Nothing has to be watching for this to work. The **operator alerts tick**
(`/api/admin/operator-alerts/tick`, every 15 minutes) asks every health endpoint on
the console's own origin. It also asks the published-site runtime's endpoints when
`OPERATOR_HEALTH_TENANT_ORIGIN` names one of your sites. The same tick flags support
tickets past their response time and sends the daily digest.

:::caution The tick cannot report its own death
If the scheduler stops, the tick stops with it, and so does every alert that depends
on the sweep. Point an external uptime monitor at `/api/health/crons`: it records its
own state on every read, and the tick is one of the jobs it watches. The webhook is
the other safety net: a channel that normally hears something every day and goes
quiet is a signal too.
:::

## Self-hosting {#self-hosting}

Nothing here is specific to Aglyn's cloud. The environment variables are listed in
[Self-hosting environment](../developers/self-hosting-environment.md). Schedule
`/api/admin/operator-alerts/tick` every 15 minutes with the rest of your
[scheduled jobs](../developers/self-hosting-environment.md#cron).
