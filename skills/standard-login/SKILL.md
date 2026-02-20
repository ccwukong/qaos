---
name: standard-login
description: Guide users through a typical email/password login flow. Use this workflow when you see a 'Log In' or 'Sign In' button, or need to authenticate to access protected routes. This skill handles standard forms but should not be used for 3rd-party OAuth providers or financial authorizations.
---

# Standard Login Flow
**TRIPWIRE:** Verify the screen contains an input for 'email' or 'username' and 'password'.

## Requirements
- `TEST_USER` and `TEST_USER_PASSWORD` must be set in the `.env` file.

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

### Step 1: Check the local `.env` or session context for `TEST_USER` and `TEST_USER_PASSWORD`.
### Step 2: Visually locate the email/username field and use the `type_secret` primitive with key="TEST_USER".
### Step 3: Visually locate the password field and use the `type_secret` primitive with key="TEST_USER_PASSWORD".
### Step 4: **Wait for the "Login/Sign In" button to become enabled if it is disabled.** Then, locate and click it.
### Step 5: If a "Remember Me" checkbox is present, click it.
### Step 6: **Bypass Strategy:** If the site is already authenticated (no login form visible), skip these steps and notify the user.
