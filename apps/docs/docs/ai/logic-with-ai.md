---
sidebar_position: 10.5
title: Functions and variables with AI
description: Aglyn AI writes a site function or variable from a description, changes or fixes a function you have, explains what one works out, and offers a fix for a broken automation reference. Nothing is saved until you save it.
---

# Functions and variables with AI

On **Logic** — the Functions & Variables page — Aglyn AI can write a
[function or a variable](../building-sites/bindings/overview.md#no-code-functions) from a
description, change or fix a function you already have, and explain what one works out. On
the same page, a broken reference an automation holds offers **Fix with AI**.

**Nothing is saved for you.** What Aglyn AI writes opens in the function or variable
editor, unsaved, exactly as if you had typed it. Test it, change anything, and save it with
the editor's own **Save** — or close the editor and nothing changes.

## Write a function from a description {#function}

Choose **Create with AI** at the top of the **Functions** card and describe what it should
work out — *"a shipping quote: free over our free-shipping amount, otherwise the flat rate
plus 2 per kilo"*.

The function is written only from what the editor's evaluator runs: `+ - * /`, parentheses,
the built-ins the editor lists, the function's own parameters and locals, and your site's
variables by name (a dictionary's members as `name.member`). Before you see it, it is
checked — every expression must parse, every name it reads must be its own or one of your
site's variables, it may set only its own parameters and locals, and it is run once with
each parameter at a starting value. One that fails is sent back to be rewritten, saying
why. Where your description needs a number your site does not hold, it becomes a parameter
rather than a guess.

When it is ready, **Open in the editor** opens it as a new function, unsaved. A plan's
function limit applies as it does to **Add function**.

## Write a variable {#variable}

**Create with AI** at the top of the **Variables** card writes one site variable — a name, a
type and a value in that type's stored form, such as a dictionary of plan prices
`{"starter":19,"pro":49}`. It opens in the variable editor, unsaved.

## Change, fix or explain a function {#change}

Open a saved function. The box at the top of its editor offers:

- **Explain it** — what the function works out from what it is given, operation by
  operation, and anything worth checking, such as a condition that can never hold.
- **Change with AI** — describe the change: *"add a 10% discount when the order is over
  200"*.
- **Fix with AI** — fixes whatever would stop the function working, such as a name your
  site does not have, and changes nothing else.

A change is checked exactly as a new function is. **Put it in the editor** replaces what the
editor holds with the changed function, unsaved; **Cancel** leaves the saved function as it
was. Each reads the function as it is saved, so save your edits first.

## Fix a broken reference {#broken-references}

The **Reference health** card lists references that point at something your site no longer
has. On a reference an **automation** holds — a list, a campaign, a workflow, a dataset or a
webhook it names — **Fix with AI** drafts a changed copy of that automation, switched off,
beside the original, which is left as it is: see
[Change or fix an automation](automations-with-ai.md#change). Review it on the
**Automation** page and switch it on in place of the old one. A workflow's, a variable's
and a page's references are fixed by hand.

## What Aglyn AI is sent {#what-is-sent}

Your description; your site's variables, by name, type and value; the names of your site's
functions; and, to change, fix or explain a function, that function's definition. Nothing a
visitor entered is read.

## Who can use it {#who-can-use-it}

These jobs need the **Generate with AI** permission, on a site whose Logic plugin is on.
See [who can use Aglyn AI](overview.md#who-can-use-it). A site that has
[switched AI off](overview.md#switch-ai-off-for-one-site) shows none of these controls. Each
job spends AI credits.

## Related

- [Bindings, variables & functions](../building-sites/bindings/overview.md)
- [Automations with AI](automations-with-ai.md)
- [Aglyn AI](overview.md)
