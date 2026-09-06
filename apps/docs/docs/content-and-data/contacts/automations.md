---
sidebar_position: 14
title: Automations for the CRM
description: The CRM events an automation can start on — a contact created or changing stage, a deal moved, won or lost, a task completed — the steps that set a stage, tag, assign an owner, create a task or log an activity, and the recipes that build the common automations in one click.
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
| **Contact changed stage** | A contact's lifecycle stage was moved — from the contact's page, or by another automation. Setting the stage a contact already has fires nothing. | [Lifecycle stages](./contact-record.md#lifecycle-stages) |
| **Deal moved** | A deal moved between open stages, or was reopened. | [Moving, winning and losing](./deals.md#moving-winning-and-losing) |
| **Deal won** | A deal was marked won. | [Moving, winning and losing](./deals.md#moving-winning-and-losing) |
| **Deal lost** | A deal was marked lost; the reason given travels with the event. | [Moving, winning and losing](./deals.md#moving-winning-and-losing) |
| **CRM task completed** | A task was ticked done. Reopening a task fires nothing. | [Completing and reopening](./tasks.md#completing-and-reopening) |

Pick one and the **Filter** field's helper text lists the keys the event puts
in scope, so a filter such as `lifecycleStage == "customer"` or a condition
such as *`stageId` equals `negotiation`* can be written without leaving the
editor.

## The steps

:::info Plan availability
The five CRM steps are part of the **CRM suite**, included from **Starter**. On a
workspace whose plan does not include it, a step that reaches the CRM does nothing and
the run history records why — the plan that carries the steps is named — the same way a
webhook step reports the plan it needs. See
[The CRM suite](../../workspace-and-billing/billing-and-plans/overview.md#the-crm-suite).
:::

Five server steps act on the CRM: **Set the contact's lifecycle stage**, **Tag
the contact**, **Assign the contact an owner**, **Create a CRM task** and **Log
a CRM activity**. Each acts on the contact the triggering event names — by
`contactId` when the event carries one, otherwise by the `email` in the event's
data — and does nothing, with the reason in the run history, when the event
names nobody this site can see. Fields and behavior are in
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

## Recipes {#recipes}

The common CRM automations do not have to be built from scratch. Beside **Add action**
on **Automation → Actions**, the **Recipes** menu lists four ready-to-edit actions.
Choosing one opens the action editor already filled in — name, trigger, conditions and
steps — with a line saying which recipe it started from. Change anything, then save;
**nothing is saved until you do**, and a recipe closed without saving leaves no trace.

| Recipe | Starts on | What it builds |
| --- | --- | --- |
| **Welcome a new lead** | **Contact created**, with the condition *`source` equals `form`* | **Assign the contact an owner** on **Round robin** (the pool under [CRM → Settings](./settings.md#round-robin); with no pool the step fails, the run carries on, and the run history says so), then **Create a CRM task** — a call, due in 1 day, assignee blank so it goes to the owner just chosen — then **Send an email** thanking them (sent from your workspace's identity to the address the event carries, as an immediate reply rather than marketing), then **Tag the contact** `website`. |
| **Follow up a won deal** | **Deal won** | **Set the contact's lifecycle stage** to **Customer**, then **Create a CRM task** — a call, due in 7 days, to the contact's owner. |
| **Re-engage a stale lead** | **Contact changed stage**, with the condition *`lifecycleStage` equals `lead`* | **Wait for something to happen** — the next **Contact changed stage** for this person, giving up after a week — then **Create a CRM task** (a call, due in 1 day) with the step condition *`_waitTimedOut` is not empty*, so the call is booked only when the week ran out. A lead whose stage moved on in the meantime skips it. |
| **Tag by form** | **Contact created**, with the condition *`formId` equals* the form you pick | **Tag the contact** with the form's name. This recipe asks for one of the site's forms first — the picker offers the site's live forms, not archived ones — because the form is what the trigger is keyed on. Change the tag in the editor if the form's name is not the tag you want. |

Recipes are definitions, the same on every site; only the form picker is the site's
own. A recipe that reaches the CRM needs the plan the [CRM steps](#the-steps) need, and
choosing one on a plan without the actions builder is refused the way **Add action** is.

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
