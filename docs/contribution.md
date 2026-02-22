# Contributing Skills to qaos

## Project Conventions

- **Routing:** qaos uses config-based routing only.
- Add and update routes in `app/routes.ts`.
- Treat files in `app/routes/*` as route modules referenced by the manifest (no file-based auto-routing pattern).

qaos uses a **Skill System** to define what the agent can do. A skill is a folder containing:

- `SKILL.md`: Metadata (frontmatter) and Instructions (markdown body).
- `scripts/`: Optional TypeScript scripts for validation or execution.
- `assets/`: Optional JSON schemas or data files.

## How to Create a New Skill

1. **Create a Folder**: Inside `skills/`, create a new folder with a kebab-case name (e.g., `github-login`).

2. **Create `SKILL.md`**:

   ```markdown
   ---
   name: github-login
   description: "Handles login to GitHub. Use this when a 'Sign in with GitHub' button is present."
   requiredEnvVars:
     - GITHUB_TEST_USER
     - GITHUB_TEST_PASSWORD
   triggerConditions:
     - 'When the user asks to log in to GitHub'
     - 'When redirected to github.com/login'
   negativeTriggers:
     - 'Do NOT use for GitHub Enterprise (on-prem scenarios)'
   ---

   # GitHub Login

   **TRIPWIRE:** Verify you are on `github.com` and see the login form.

   ## Instructions

   ### Step 1: Check credentials.

   ### Step 2: Fill username and password.

   ### Step 3: Click 'Sign in'.
   ```

3. **(Optional) Add Validation**:
   Create `skills/github-login/scripts/validate.ts`:
   ```typescript
   export default async function validate(): Promise<boolean> {
     if (!process.env.GITHUB_TEST_USER) return false
     return true
   }
   ```

## Best Practices

- **Atomic Skills**: Keep skills focused (e.g., "Login", "Checkout", "Search"). Don't make a "Do Everything" skill.
- **Strict Triggers**: Use `negativeTriggers` to prevent the agent from using your skill in wrong contexts.
- **Deterministic**: Use scripts for logic that needs to be 100% reliable (math, API calls).
