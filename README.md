# Aglyn

## Firebase

Provides auth, data-store, analytics and more.

### Emulation

1. Set the environment variables for the hosts:

- `FIRESTORE_EMULATOR_HOST=localhost:8080`
- `FIREBASE_AUTH_EMULATOR_HOST=localhost:9099`

2. Run command to start up the firebase emulators:

- `firebase emulators:start --import=./.firebase --export-on-exit`

------------------------------------------------------------

## Nx Command Summary

### Basic usage

#### Serving

- Run `nx serve <app-name>` for a dev server. Navigate to http://localhost:4200/. The app will automatically reload if
  you change any of the source files. Use the `--prod` flag for a production environment.

#### Building

- Run `nx build <app-name>` to build the project. The build artifacts will be stored in the `dist/`directory. Use
  the `--prod` flag for a production build.

##### Unit testing

- Run `nx test <app-name>` to execute the unit tests via [Jest](https://jestjs.io).
- Run `nx affected:test` to execute the unit tests affected by a change.

##### End-to-end (e2e) testing

- Run `ng e2e <app-name>` to execute the end-to-end tests via [Cypress](https://www.cypress.io).
- Run `nx affected:e2e` to execute the end-to-end tests affected by a change.

### Scaffolding

#### Applications

When using Nx monorepo, you can create multiple applications and libraries in the same workspace.

- Run `nx g @nrwl/react:app <app-name>` to generate an React application.
- Run `nx g @nrwl/node:app <app-name>` to generate an Node.js application.
- Run `nx g @nrwl/next:app <app-name>` to generate an Next.js application.

_**@See** Nx documentation for more app [community plugins](https://nx.dev/community#community-plugin-list) and
commands_

#### Libraries

Libraries are shareable across libraries and applications. They can be imported from `@aglyn/mylib`.

- Run `nx g @nrwl/react:lib <lib-name>` to generate a React library
- Run `nx g @nrwl/node:lib <lib-name>` to generate a Node.js library
- Run `nx g @nrwl/next:lib <lib-name>` to generate a Next.js library

_**@See** Nx documentation for more library [community plugins](https://nx.dev/community#community-plugin-list) and
commands_

#### App or library modules and components

- Run `nx g @nrwl/react:component my-component --project=my-app` to generate a new component.

### Updating

#### Move or rename application and libraries

To streamline the refactoring process Nx provides workspace commands to move and/or rename project applications and
libraries.

- For example run `nx g @nrwl/workspace:move --project website-feature-react website/feature/react-renderer` to move the library under `/libs/website/feature/react` to `/libs/website/feature/react-renderer` 
  
*Make sure to provide the Nx project name and not the actual directory (@See [nx.json](./nx.json) for registered project name), followed by its _new_ directory  

#### Nx build framework

1. Run `nx migrate latest` to pull the most recent version of Nx, it will generate a new files named `migrations.json`
   in the root directory. Double check the contents and make sure changes are ok.
2. Next apply the migrations by running the following command `nx migrate --run-migrations=migrations.json`
3. If everything succeeded, stage the changes and remove the `migrations.json` file.

_@See More info detailed on the [Nx documentation](https://nx.dev/latest/react/core-concepts/updating-nx)_

#### Version and changelog

Package version bump and changelog automation with [SemVer](https://semver.org/)
and [ConventionalCommits](https://www.conventionalcommits.org/en/v1.0.0/)

- Run `nx run workspace:version --version=[major|minor|patch|prerelease] --preid=beta --dry-run` for version bump and
  generation of CHANGELOG
- Run `nx run <lib-name>:version [...options]` for independent project app or lib version and generation of CHANGELOG

_**@See** [`@jscutlery/semver`](https://github.com/jscutlery/semver) Nx plugin repository for full list of commands and
options._

### Visualizing dependencies

Nx can generate a dependency tree graph

- Run `nx dep-graph` to see a diagram of the dependencies of your projects.

------------------------------------------------------------

## Git

### Commit messages

- Text template: [commit_template.txt](./commit_template.txt).
- Lint documentation: [ConventionalCommits](https://www.conventionalcommits.org)

#### Template

```markdown
<type>[(optional-scope)]: <description>

[optional body]

[optional footer(s)]
```

#### Overview

For the purpose of communicating intent to the consumers of the library, the commit outlines the following structural
elements:

##### Types

Other than `fix:` and `feat:` are allowed, for
example [@commitlint/config-conventional](https://github.com/conventional-changelog/commitlint/tree/master/%40commitlint/config-conventional) (
based on
the [the Angular convention](https://github.com/angular/angular/blob/22b96b9/CONTRIBUTING.md#-commit-message-guidelines))
recommends: `build:`, `chore:`, `ci:`, `docs:`, `style:`, `refactor:`, `perf:`, `test:`, `fix:`
, `feat:`, `style:`, `revert:` and others.

- **Fixing:** a commit of the *type* `fix` patches a bug in your codebase (this correlates
  with [`PATCH`](http://semver.org/#summary) in Semantic Versioning).
- **Feature:** a commit of the *type* `feat` introduces a new feature to the codebase (this correlates
  with [`MINOR`](http://semver.org/#summary) in Semantic Versioning).
- **BREAKING CHANGE:** a commit that has a footer `BREAKING CHANGE:`, or appends a `!` after the type/scope, introduces
  a breaking API change (correlating with [`MAJOR`](http://semver.org/#summary) in Semantic Versioning). A BREAKING
  CHANGE can be part of commits of any *type*.

##### Footers

Other than `BREAKING CHANGE: <description>` may be provided and follow a convention similar
to [git trailer format](https://git-scm.com/docs/git-interpret-trailers).

------------------------------------------------------------
