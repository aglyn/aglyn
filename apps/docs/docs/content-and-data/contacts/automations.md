---
sidebar_position: 8
title: Automations for contacts
description: The CRM events an automation can start on — a contact created, a contact changing stage — and the steps that set a stage, tag, assign an owner, create a task or log an activity.
---

# Automations for contacts

The [actions builder](../../marketing-and-automation/workflows-and-actions/actions-builder.md)
and [workflows](../../marketing-and-automation/workflows-and-actions/build-a-workflow.md)
can start on what happens in the CRM, and act on it.

## Two events

- **Contact created** — a capture on your site made a **new** contact. A repeat visit by
  somebody already on the list is an interaction, not a new contact.
- **Contact changed stage** — a contact's lifecycle stage was moved, from the contact's
  page or by another automation.

What each event carries, and the one rule worth knowing — events are announced by the
server, so a contact written straight into the database announces nothing — is in
[CRM events](../../marketing-and-automation/workflows-and-actions/actions-builder.md#crm-events).

## Five steps

**Set the contact's lifecycle stage**, **Tag the contact**, **Assign the contact an
owner**, **Create a CRM task** and **Log a CRM activity**. Each acts on the contact the
triggering event names and does nothing — with the reason in the run history — when the
event names nobody this site can see. Fields and behavior are in
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

## Related

- [Actions builder](../../marketing-and-automation/workflows-and-actions/actions-builder.md)
- [Contacts CRM](overview.md)
