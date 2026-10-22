# @aglyn/console-ui

The Aglyn console's own UI layer: its React hooks, the browser side of signing
in and holding a session, and what its screens show (nav tabs, sections,
routes and links, notices and the views they render).

It is internal to the console app and is not published (`private`). The
platform's logic lives in `@aglyn/aglyn`, which holds no UI.

Import by subpath, for example `@aglyn/console-ui/hooks/use-org-hosts` or
`@aglyn/console-ui/route-links`.
