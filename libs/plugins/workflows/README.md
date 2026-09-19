# @aglyn/plugins-workflows

The Automation plugin (AGL-395): the console's **Automation** section —
Workflows, Actions and Webhooks — and the engine that runs what is built there.

## The engine

`src/lib/engine/` holds the automation engine, and nothing outside this plugin
runs an automation:

- `run-event-workflows.ts` and `run-event-actions.ts` — the runners. A host
  event runs the workflows triggered by it and the actions listening for it;
  the site-event dispatch runs one action a published page fired.
- `run-event-actions.ts` also holds the step executors — datasets, email,
  webhooks, lists, campaigns, alerts, custom events — and the flow steps.
- `crm-action-steps.ts` — the five CRM steps.
- `flow-enrollments.ts` — where a person waits between one step of a flow and
  the next, resumed by the `resume-flow-waits` job.

The engine hears events through the tenant runtime's host-event seam
(`@aglyn/tenant-runtime/host-event-listeners`). The listener is registered by
`registerWorkflowsServerDeclarations` (`declarations.server.ts`), which both
apps call at boot from their generated server-declarations manifest, and again
by the plugin's API register functions. The declaration is light: the engine
itself is imported when the first event arrives, or when the plugin's API
surface loads.

The vocabulary the engine runs — event types, step types, limits, condition
shapes, validation — stays in the core (`@aglyn/aglyn/app-utils/actions` and
`@aglyn/aglyn/app-utils/workflows`), because the console, the AI plugin and
the core's own compose path read it too.

## Entry points

- `.` — the console extension (nav, the Automation page, the activity widget).
- `./server` — the tenant and console API surfaces: the inbound webhook, the
  flow-resume job, the automation draft writer.
- `./declarations.server` — the boot registration above.
