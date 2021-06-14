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

### Development server

Run `nx serve my-app` for a dev server. Navigate to http://localhost:4200/. The app will
automatically reload if you change any of the source files.

### Code scaffolding

Run `nx g @nrwl/react:component my-component --project=my-app` to generate a new component.

### Build

Run `nx build my-app` to build the project. The build artifacts will be stored in the `dist/`
directory. Use the `--prod` flag for a production build.

### Running unit tests

Run `nx test my-app` to execute the unit tests via [Jest](https://jestjs.io).

Run `nx affected:test` to execute the unit tests affected by a change.

### Running end-to-end tests

Run `ng e2e my-app` to execute the end-to-end tests via [Cypress](https://www.cypress.io).

Run `nx affected:e2e` to execute the end-to-end tests affected by a change.

### Generate an Application

Run `nx g @nrwl/react:app my-app` to generate an application.

> @See Nx documentation for other app

When using Nx, you can create multiple applications and libraries in the same workspace.

### Generate a Library

Run `nx g @nrwl/react:lib my-lib` to generate a library.

> You can also use any of the plugins above to generate libraries as well.

Libraries are shareable across libraries and applications. They can be imported from `@aglyn/mylib`.

### Visualize Dependency Tree

Run `nx dep-graph` to see a diagram of the dependencies of your projects.


------------------------------------------------------------
