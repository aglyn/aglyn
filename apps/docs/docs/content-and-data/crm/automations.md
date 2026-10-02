---
sidebar_position: 14
title: Automations for the CRM
description: The CRM events an automation can start on — a contact created or changing stage, a deal moved, won or lost, a task completed — the steps that tag, stage, assign, create a task or log an activity, and one-click recipes.
---

# Automations for the CRM

The [actions builder](../../marketing-and-automation/workflows-and-actions/actions-builder.md)
and [workflows](../../marketing-and-automation/workflows-and-actions/build-a-workflow.md)
can start on what happens in the CRM, and act on it. Every event below is
announced by the server path that performed the write, so a record written
straight into the database — by hand, by an import, or over the REST API —
announces nothing; what each event carries is in
[CRM events](../../marketing-and-automation/workflows-and-actions/actions-builder.md#crm-events).

## The events

| In the trigger picker | Fires when | Read more |
| --- | --- | --- |
| **Contact created** | A capture on your site made a **new** contact. A repeat visit by somebody already on the list is an interaction, not a new contact. The event carries the `lifecycleStage` the capture set — `lead` for a form or a booking request, `subscriber` for a sign-up or a newsletter opt-in, `customer` for an order — so a filter can pick the form captures out of the sign-ups — and `formId` when the capture came through a form, so a condition can pick one form's people out of every other door's. | [CRM events](../../marketing-and-automation/workflows-and-actions/actions-builder.md#crm-events) |
| **Contact changed stage** | A contact's lifecycle stage was moved — from the contact's page, from **Set stage** on the contacts table, or by another automation. Setting the stage a contact already has fires nothing. | [Lifecycle stages](./contact-record.md#lifecycle-stages) |
| **Deal moved** | A deal moved between open stages, or was reopened. | [Moving, winning and losing](./deals.md#moving-winning-and-losing) |
| **Deal won** | A deal was marked won. | [Moving, winning and losing](./deals.md#moving-winning-and-losing) |
| **Deal lost** | A deal was marked lost; the reason given travels with the event. | [Moving, winning and losing](./deals.md#moving-winning-and-losing) |
| **CRM task completed** | A task was ticked done. Reopening a task fires nothing. | [Completing and reopening](./tasks.md#completing-and-reopening) |
| **New lead** | A capture filed a **new** lead — a form with lead routing on, or a booking request. Such a form makes a lead and no contact, so **Contact created** does not fire for it. The event carries `formId` when a form filed the lead, and the form's `campaignIds` when it is filed under a campaign. | [Leads](./leads.md) |

Pick one and the **Filter** field's helper text lists the keys the event puts
in scope, so a condition such as *`lifecycleStage` equals `customer`* or
*`stageId` equals `negotiation`* can be written without leaving the editor. A
filter can't compare values; see
[Only run when a field matches](../../marketing-and-automation/workflows-and-actions/actions-builder.md#only-run-when-a-field-matches).

## The steps

:::info Plan availability
The five CRM steps are part of the **CRM**, included from **Starter**. On a
workspace whose plan does not include it, a step that reaches the CRM does nothing and
the run history records why — the plan that carries the steps is named — the same way a
webhook step reports the plan it needs. See
[The CRM](../../workspace-and-billing/billing-and-plans/overview.md#the-crm-suite).
:::

Five server steps act on the CRM: **Set the contact's lifecycle stage**, **Tag
the contact**, **Assign the contact an owner**, **Create a CRM task** and **Log
a CRM activity**. Each acts on the contact the triggering event names — by
`contactId` when the event carries one, otherwise by the `email` in the event's
data — or, when the workspace holds that person only as a **lead**, on the lead:
its owner, its tags, a task or an activity filed under it. A lead has no
lifecycle stage, so a stage step on one fails and says so. Each does nothing,
with the reason in the run history, when the event names nobody this site can
see. Fields and behavior are in
[CRM steps](../../marketing-and-automation/workflows-and-actions/actions-builder.md#crm-steps).

### Assigning an owner, or rotating one

**Assign the contact an owner** has two modes. **A team member** names one
person by email address, matched against the workspace roster when the
automation runs. **Round robin** hands the contact to the next member of the
pool kept under [CRM → Settings](./settings.md#round-robin), moving the
rotation on — the same pool an assignment rule's round robin draws from, so
a rule and an automation share one rotation.

Either mode **reassigns**: an automation that assigns an owner means to, so
a contact that already has one is handed over, and the site's lead for the
same person follows. Naming the owner the contact already has changes
nothing. The new owner gets a console notification, **Contact assigned to
you**, linking to the contact.

This is the deliberate counterpart of the [assignment rules](./settings.md#assignment-rules),
which run on capture and only for a contact with no owner. Use a rule to
decide who gets a new contact; use this step to move a contact when
something happens to them — a stage change, a won deal.

## An automated email on the timeline

The **Send an email** step is not a CRM step — it mails whichever address the
event carries — but when that address is the contact the event is about, the
message is logged on the contact's timeline as a sent email, exactly as a
teammate's **Send email** is: with its subject, the address it went to, and a
[delivery state](./activities.md#delivery-states) that follows the message. So a
welcome sequence shows on the person's history beside the calls a rep made.

Nothing is logged when the step writes to somebody else — an internal alert sent
to your own address through the **To** field — or when the address belongs to
nobody this site can see. The row needs the CRM like the five steps above,
and a record already at the activity ceiling gets the email without the entry.
Automated email is metered as usage and is not counted against the
[one-to-one email](../../workspace-and-billing/billing-and-plans/overview.md#one-to-one-email)
allowance, which is for what people send by hand.

## Recipes {#recipes}

The common CRM automations do not have to be built from scratch. Beside **Add action**
on **Automation → Actions**, the **Recipes** menu lists four ready-to-edit actions.
Choosing one opens the action editor already filled in — name, trigger, conditions and
steps — with a line saying which recipe it started from. Change anything, then save;
**nothing is saved until you do**, and a recipe closed without saving leaves no trace.

| Recipe | Starts on | What it builds |
| --- | --- | --- |
| **Welcome a new lead** | **New lead**, with the condition *`formId` is not empty* — a lead a form filed | **Assign the contact an owner** on **Round robin** (the pool under [CRM → Settings](./settings.md#round-robin); with no pool the step fails, the run carries on, and the run history says so), then **Create a CRM task** — a call, due in 1 day, assignee blank so it goes to the owner just chosen — then **Send an email** thanking them by name (`Hi {{firstName|there}}`, sent from your workspace's identity to the address the event carries, as a [transactional reply](../../marketing-and-automation/workflows-and-actions/actions-builder.md#transactional-replies) with no unsubscribe, and [logged on the lead's timeline](#an-automated-email-on-the-timeline)), then **Tag the contact** `website`. Each step acts on the lead the form filed. |
| **Follow up a won deal** | **Deal won** | **Create a CRM task** — a call, due in 7 days, to the contact's owner. No stage step: [a won deal makes its contact a customer](./deals.md#a-won-deal-makes-its-contact-a-customer) on its own before the event fires, and a step that *set* the stage here would move an evangelist back. |
| **Re-engage a stale lead** | **Contact changed stage**, with the condition *`lifecycleStage` equals `lead`* | **Wait for something to happen** — the next **Contact changed stage** for this person, giving up after a week — then **Create a CRM task** (a call, due in 1 day) with the step condition *`_waitTimedOut` is not empty*, so the call is booked only when the week ran out. A lead whose stage moved on in the meantime skips it. |
| **Tag by form** | **Contact created** — or **New lead** for a form with lead routing on — with the condition **Form is** the form you pick | **Tag the contact** with the form's name. This recipe asks for one of the site's forms first — the picker offers the site's live forms, not archived ones — because the form is what the trigger is keyed on. Change the tag in the editor if the form's name is not the tag you want. |

Recipes are definitions, the same on every site; only the form picker is the site's
own. A recipe that reaches the CRM needs the plan the [CRM steps](#the-steps) need, and
choosing one on a plan without the actions builder is refused the way **Add action** is.

### Installing a recipe on a site from the organization {#installing-from-the-organization}

An organization running several sites does not have to open each site's editor. The
[organization-level CRM](./overview.md#at-the-organization-level) has a **Recipes** card
under [Settings](./settings.md#recipes): every recipe, the sites that already carry it,
and an **Install** button that writes the action the recipe builds straight into the
site you pick — enabled, as the table above defines it, and stamped with the recipe it
came from. There is no editor step; the card links to the site's **Automation →
Actions** page, where the installed action is edited like any other. A recipe already
installed on a site is refused rather than duplicated, and a site whose actions predate
the stamp is shown as one that *may already have it*.

## Example: tag every new contact from a form

1. Open **Automation → Actions** and choose **Add action**.
2. Trigger event: **Contact created**. To narrow it to forms, add the condition
   *`source` equals `form`*.
3. Do: **Tag the contact**, with the tag `website`.
4. Save. Submit a form on your site from an address the workspace has not seen before,
   then open the contact under **CRM → Contacts**: the tag is on it.

A stage set by an automation is a stage change like any other, so a second action on
**Contact changed stage** with the condition *`lifecycleStage` equals `customer`* can
create the follow-up task.

## Example: spread qualified leads across the team

1. Trigger event: **Contact changed stage**, with the condition
   *`lifecycleStage` equals `sales-qualified`*.
2. Do: **Assign the contact an owner**, set to **Round robin**.
3. Under **CRM → Settings → Round robin**, tick the members who work
   qualified leads.
4. Save. Each contact that reaches Sales qualified goes to the next member in
   turn, who is notified, and the rotation shows who is next up.

## Example: follow up on a won deal

1. Trigger event: **Deal won**.
2. Do: **Set the contact's lifecycle stage** to **Customer**, then **Create a CRM
   task** — kind **Call**, due in `7` days, assignee left blank so it goes to the
   contact's owner.
3. Save. Mark a deal won from its page or the board: the contact it names moves
   to Customer, and a call is owed to them a week out.

## Related

- [Actions builder](../../marketing-and-automation/workflows-and-actions/actions-builder.md)
- [Build a workflow](../../marketing-and-automation/workflows-and-actions/build-a-workflow.md)
- [CRM settings](./settings.md) — the default owner, assignment rules and the round-robin pool
- [CRM overview](./overview.md)
- [Deals pipeline](./deals.md) · [Tasks & follow-ups](./tasks.md) · [Activities & the timeline](./activities.md)
