# Aglyn

## Firebase Summary

### Emulation

Set the environment variables for the hosts

- `FIRESTORE_EMULATOR_HOST=localhost:8080`
- `FIREBASE_AUTH_EMULATOR_HOST=localhost:9099`

Next start up the firebase emulators by running the following command:

- `firebase emulators:start --import=./.firebase --export-on-exit`

------------------------------------------------------------

## Nx Command Summary

### Building, Serving & Testing

#### Serving for development

- Run `nx serve my-app` for a dev server. Navigate to http://localhost:4200/. The app will
  automatically reload if you change any of the source files.

#### Build commands

- Run `nx build my-app` to build the project. The build artifacts will be stored in the `dist/`
  directory. Use the `--prod` flag for a production build.

#### Running Tests

**Unit tests**

- Run `nx test my-app` to execute the unit tests via [Jest](https://jestjs.io).
- Run `nx affected:test` to execute the unit tests affected by a change.

**End-to-end tests**

- Run `ng e2e my-app` to execute the end-to-end tests via [Cypress](https://www.cypress.io).
- Run `nx affected:e2e` to execute the end-to-end tests affected by a change.

### Scaffolding

**Nx Applications**

- Run `nx g @nrwl/react:app my-app` to generate an application.

> @See Nx documentation for other app plugins

When using Nx, you can create multiple applications and libraries in the same workspace.

**Nx Libraries**

- Run `nx g @nrwl/react:lib my-lib` to generate a library.

> You can also use any of the plugins above to generate libraries as well.

Libraries are shareable across libraries and applications. They can be imported from `@aglyn/mylib`.

**Code for Nx App/Libs**

- Run `nx g @nrwl/react:component my-component --project=my-app` to generate a new component.

### Visualize Dependency Tree

- Run `nx dep-graph` to see a diagram of the dependencies of your projects.

### Updating Nx

1. Run `nx migrate latest` to pull the most recent version of Nx, it will generate a new files
   named `migrations.json` in the root directory. Double check the contents and make sure changes
   are ok.
2. Next apply the migrations by running the following
   command `nx migrate --run-migrations=migrations.json`
3. If everything succeeded, stage the changes and remove the `migrations.json` file.

More info detailed on the [Nx documentation](https://nx.dev/latest/react/core-concepts/updating-nx)

------------------------------------------------------------
