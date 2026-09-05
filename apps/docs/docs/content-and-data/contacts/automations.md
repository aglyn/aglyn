---
sidebar_position: 12
title: Automations for the CRM
description: The CRM events an automation can start on — a contact created or changing stage, a deal moved, won or lost, a task completed — and the steps that set a stage, tag, assign an owner, create a task or log an activity.
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
| **Contact created** | A capture on your site made a **new** contact. A repeat visit by somebody already on the list is an interaction, not a new contact. The event carries the `lifecycleStage` the capture set — `lead` for a form or a booking request, `subscriber` for a sign-up or a newsletter opt-in, `customer` for an order — so a filter can pick the form captures out of the sign-ups. | [CRM events](../../marketing-and-automation/workflows-and-actions/actions-builder.md#crm-events) |
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

Five server steps act on the CRM: **Set the contact's lifecycle stage**, **Tag
the contact**, **Assign the contact an owner**, **Create a CRM task** and **Log
a CRM activity**. Each acts on the contact the triggering event names — by
`contactId` when the event carries one, otherwise by the `email` in the event's
data — and does nothing, with the reason in the run history, when the event
names nobody this site can see. Fields and behavior are in
[CRM steps](../../marketing-and-automation/workflows-and-actions/actions-builder.md#crm-steps).

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
- [CRM overview](./overview.md)
- [Deals pipeline](./deals.md) · [Tasks & follow-ups](./tasks.md) · [Activities & the timeline](./activities.md)
