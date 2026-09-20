---
sidebar_position: 10
title: Explain automations with AI
description: Aglyn AI can explain an automation you already have and tell you why one of its runs failed. Drafting an automation from a description is not available yet.
---

# Explain automations with AI

On **Automation → Actions**, Aglyn AI can explain an automation you already have, and tell
you why one of its runs failed. Neither changes or runs an automation.

:::caution Rolling out
Aglyn AI is a **release-flagged feature, currently being rolled out** — it is not
available in every workspace yet. This page says what it does with automations, and
grows with the feature.
:::

## Drafting an automation is not available yet {#draft}

Describing an automation and having Aglyn AI build it — *"when someone submits the
newsletter form, add them to the newsletter list, make them a lead and send them a welcome
email"* — is **not open yet**, on any plan.

The work is done up to a point a draft is not yet worth handing you: a description asking
for several steps can come back as a draft holding one, because the answer is cut short at
its size ceiling rather than re-asked. A one-step draft of a three-step description is
worse than no draft, so the door stays shut until that is fixed.

What follows on this page — **Explain it** and **Why did this fail?** — does not depend on
it and is unaffected. When drafting opens, this section is replaced by how to use it.

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
job spends AI credits; an automation's own runs count against your site's action runs, never
your AI credits.

## Related

- [Actions builder](../marketing-and-automation/workflows-and-actions/actions-builder.md)
- [Aglyn AI](overview.md)
- [How Aglyn AI builds](how-aglyn-ai-builds.md)
