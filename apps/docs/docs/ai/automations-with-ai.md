---
sidebar_position: 10
title: Automations with AI
description: Aglyn AI drafts an automation from a description, changes or fixes one you already have as a copy switched off, explains what one does and tells you why one of its runs failed.
---

# Automations with AI

On the **Automation** page, Aglyn AI can draft an automation from a description, change or
fix one you already have, explain what one does, and tell you why one of its runs failed.
None of them runs an automation, switches one on, or changes one you have saved: what it
drafts arrives as a new automation, switched off.

## Draft an automation from a description {#draft}

Choose **Create with AI** beside **Add action** and **Recipes** on **Automation → Actions**,
or at the top of **Automation → Workflows** (in its empty state while it has none). Describe
what should happen, and when — *"when someone submits the newsletter form, add them to the
newsletter list, make them a lead and send them a welcome email"*.

The automation is drafted **switched off**, using only the triggers and steps your plan
includes. A list, campaign or other record your site does not have — or that the words could
mean more than one of — is left as a placeholder for you to pick. When it is ready, **Review
it** opens it in the Actions editor; from **Workflows**, that takes you to **Actions**, where
it is listed.

## Change or fix an automation {#change}

Open a saved action and use the box under **Explain it**:

- **Change with AI** — describe the change: *"also tag them newsletter, and wait a day before
  the email"*.
- **Fix with AI** — asks Aglyn AI to fix whatever would stop the automation working as
  intended, such as a list your site no longer has, and to change nothing else.

Either way you get a **changed copy**, switched off, beside the action you started from,
which is left exactly as it is. The copy says what changed from the original — steps added,
removed or changed, and whether its trigger or conditions changed — worked out by comparing
the two, not taken from the AI's account of itself. **Review the copy** opens it in the
editor. When it is right, switch the copy on and the original off.

It reads the action as it is saved, so save your edits first. An action that does something
Aglyn AI does not write — starts on something a visitor does on a page, has a step that runs
on the page, or only runs when an expression is true — cannot be changed this way, so that
nothing you did not ask to lose goes missing; edit it in the editor instead. Workflows (lists
of function calls) can be explained, not changed.

## Explain an automation {#explain}

Open a saved action or workflow and choose **Explain it** at the top of the editor. In a few
minutes you get a plain-words account of what it does, step by step, and anything worth checking,
such as a list your site no longer has or a placeholder nobody has filled in. It reads the
automation as it is saved, so save your changes first.

## Find out why a run failed {#why-a-run-failed}

In an automation's **Runs** log, a failed run has **Why did this fail?**. It reads what the
[run history](../marketing-and-automation/workflows-and-actions/overview.md#run-history) recorded
about that run, together with the automation's settings, and answers with the most likely cause
and how to fix it. Opening it again shows the same answer.

## What Aglyn AI is sent {#what-is-sent}

- **To draft an automation:** your description, what your plan lets automations use, and the
  names of your site's forms (with their field names) and datasets. The names of your lists,
  campaigns, workflows, webhooks and pipeline stages are not sent; the words of the answer are
  matched to them on Aglyn's side.
- **To change or fix one:** the same, plus how the action is set up, as for an explanation
  below.
- **To explain an automation:** how it is set up, including the text of its emails and messages
  and the names of the records it uses. Email addresses are removed first, a teammate is
  described only as a teammate, and on-page code is left out.
- **To explain a failed run:** also when the run happened, what it did and the errors it recorded,
  with email addresses removed. What a visitor submitted, such as what they entered in a form, is
  never read.

No contact, lead, deal, form submission or list member is read for any of them.

## Who can use it {#who-can-use-it}

These jobs need the **Generate with AI** permission, on a site whose Automation plugin is on.
See [who can use Aglyn AI](overview.md#who-can-use-it). A site that has
[switched AI off](overview.md#switch-ai-off-for-one-site) shows none of these controls. Each
job spends AI credits; an automation's own runs count against your workspace's action runs,
never your AI credits.

## Related

- [Actions builder](../marketing-and-automation/workflows-and-actions/actions-builder.md)
- [Aglyn AI](overview.md)
- [How Aglyn AI builds](how-aglyn-ai-builds.md)
