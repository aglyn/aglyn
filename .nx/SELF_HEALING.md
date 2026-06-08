# Self-Healing CI Configuration

## Off-Limits Areas
- Do not modify files in `tools/eslint-rules/`
- Do not modify `nx.json`, `tsconfig.base.json`, or `workspace.json`
- Do not modify any `.github/workflows/` files

## Fix Preferences
- Prefer `nx format:write` for formatting fixes rather than manual edits
- For lint errors, follow the project's existing ESLint rules in `.eslintrc.js`
- For TypeScript errors, do not change `strict` or `strictNullChecks` settings

## Context
- This is an NX monorepo with React, Next.js, and Node libraries
- All libraries are buildable and publishable
- Jest is used for unit testing with SWC compiler
- ESLint is configured workspace-wide in `.eslintrc.js`
