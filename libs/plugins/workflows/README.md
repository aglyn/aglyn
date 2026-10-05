# @aglyn/plugins-workflows

The Automation plugin: the console's **Automation** section —
Workflows, Actions and Webhooks — and the engine that runs what is built there.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

```bash
npm install @aglyn/plugins-workflows@beta
```

A plugin is loaded through Aglyn's plugin manager (`@aglyn/aglyn`) by the console and the tenant runtime; it is not a standalone library.

## The engine

`src/lib/engine/` holds the automation engine, and nothing outside this plugin
runs an automation:

- `workflow-steps.ts` — ONE STEP MODEL. A stored step is a function
  call or an Actions step, told apart by `type`; nothing is migrated. It also
  holds which Actions steps a workflow may run (every server-side one), the
  refusal for the rest, and the validation both editors use. Pure and
  client-safe: the console's step editor reads it too.
- `run-event-workflows.ts` and `run-event-actions.ts` — the runners. A host
  event runs the workflows triggered by it and the actions listening for it;
  the site-event dispatch runs one action a published page fired.
- `run-event-actions.ts` also holds the step executors — email, webhooks,
  lists, campaigns, alerts, custom events — and the flow steps — behind
  `runServerStep`, one step at a time, which is what lets a workflow perform
  an Actions step without a second copy of any of them. A step that writes
  another plugin's records — a dataset row, a contact's stage — is handed to
  the executor that plugin registered on the server-step seam
  (`plugin-server-steps`). Its `executeWorkflow` is the workflow half:
  function calls through the pure evaluator, Actions steps through that
  executor, in one scope.
- `flow-enrollments.ts` — where a person waits between one step of a flow and
  the next, resumed by the `resume-flow-waits` job. A workflow's enrollment id
  is kept apart from an action's, so the two kinds never share a row.

A run is metered once by whoever admitted it — `workflowRunsPerMonth` for a
workflow, `actionRunsPerMonth` for an action — however many steps it holds.
The Actions tier gates are taken step by step inside it.

The engine hears events through the tenant runtime's host-event seam
(`@aglyn/tenant-runtime/host-event-listeners`). The listener is registered by
`registerWorkflowsServerDeclarations` (`declarations.server.ts`), which both
apps call at boot from their generated server-declarations manifest, and again
by the plugin's API register functions. The declaration is light: the engine
itself is imported when the first event arrives, or when the plugin's API
surface loads.

The same declarations publish the record indexes of a site's `workflow`,
`webhook` and `action` records (`server/automation-record-index.ts`), so the
AI plugin reads them without reaching for this plugin's collections, and a
dependents source (`server/workflow-dependents.ts`) that answers the console's
"Used by" scan with the workflows calling a function. The readers load on the
first read. What depends on a workflow — the variables it computes — is the
logic plugin's to answer; the Automation page asks the same scan.

A site variable that names a workflow takes that workflow's result when a page
is composed (AGL-129). The same declarations register this plugin's variable
computer on the core's `computed-variables` seam (`server/workflow-variables.ts`):
the compose pipeline starts it beside the page's other reads, it reads the
site's workflows under the site's render cache tag, and it runs them with the
Workflow Builder model in `model/workflows.ts`. A variable whose workflow is
gone or fails keeps its stored value.

An action is a site interaction (`@aglyn/aglyn/app-utils/site-interactions`,
the platform's: the trigger, its conditions, the client steps, validation)
with this plugin's server steps added. The `runWorkflow` step is declared under
`interactionSteps` in `plugins.config.json`, so the besigner's interaction
builder offers it and lists the site's workflows without naming this plugin.
The events a trigger starts on are the platform's (`app-utils/host-events`):
the page view is core's own, and every other event is declared under
`hostEvents` by the plugin whose doors raise it. What only the engine reads
is this plugin's: the run history's past-tense step phrases
(`model/step-outcomes.ts`), a webhook's stored shape and its URL guard
(`model/webhooks.ts`) and the event-chaining depth (`model/workflows.ts`). The
automation vocabulary — the server steps' shapes, the flow's bounds and each
server step's checks — is this plugin's too (`model/host-actions.ts`). The
plugins that write automations without loading this one meet it through core
seams: each step's name, hold and typed fields are declared under
`interactionSteps` in `plugins.config.json`; the checks are registered from
this plugin's `declarations` entry (`interaction-step-checks`), so a recipe the
CRM installs or a draft the AI grades is refused as this editor would refuse
it; the stored shape and the slice a visitor's page receives are core's
(`site-interactions`); and a drafted automation is handed over through the
`automation` resource's draft writer (`server-automation-drafts.ts`).

## Entry points

- `.` — the console extension (nav, the Automation page, the activity widget).
- `./server` — the tenant and console API surfaces: the inbound webhook, the
  flow-resume job, the automation draft writer, the org automation doors, and
  the Actions card's test run (`automations/actions/test-run`, console only —
  the page runtime's `events/dispatch` is a tenant route).
- `./declarations` — the server steps' checks, registered in both apps and in
  the console's browser before any surface loads.
- `./declarations.server` — the boot registration above.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/plugins/workflows
