---
name: standard-login
description: Guide users through a typical email/password login flow. Use this workflow when you see a 'Log In' or 'Sign In' button, or need to authenticate to access protected routes. This skill handles standard forms but should not be used for 3rd-party OAuth providers or financial authorizations.
---

# Standard Login Flow

**TRIPWIRE:** Verify the screen contains an input for 'email' or 'username' and 'password'.

## Requirements

- A test account must be selected for the current test session.

## When to Use This Skill

**Trigger conditions:**

- When the user asks to log in or sign in.
- When a 'Log In' or 'Sign In' button is visible on the screen.
- When accessing a protected route requires authentication.

## When NOT to Use

**Negative triggers:**

- Do NOT use for 'Sign Up' or 'Register' flows.
- Do NOT use for 3rd party providers like Google, GitHub, or Facebook login.
- Do NOT use for banking or financial transaction authorization.

## Instructions

### Step 1: Check session context for an active test account key/id. If absent, ask human to select one from the test-session account dropdown.

### Step 2: Visually locate the email/username field and use `type_test_account_secret` with `field="username"`.

### Step 3: Visually locate the password field and use `type_test_account_secret` with `field="password"`.

### Step 4: **Wait for the "Login/Sign In" button to become enabled if it is disabled.** Then, locate and click it.

### Step 5: If a "Remember Me" checkbox is present, click it.

### Step 6: **Bypass Strategy:** If the site is already authenticated (no login form visible), skip these steps and notify the user.
