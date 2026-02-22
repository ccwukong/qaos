---
name: standard-registration
description: Guide users through standard new user sign-up flows, including creating dummy emails. Use this workflow when a 'Sign Up', 'Register', or 'Create Account' form is visible.
---

# Standard Registration

## When to Use This Skill

**Trigger conditions:**

- When the user asks to sign up or register for a new account.
- When a 'Sign Up', 'Register', or 'Create Account' button/form is visible.

## When NOT to Use

**Negative triggers:**

- Do NOT use for 'Log In' or 'Sign In' flows.
- Do NOT use for 3rd party providers like Google, GitHub, or Facebook.

## Instructions

### Step 1: Generate a random dummy email: `test-${Date.now()}@qaos.dev`.

### Step 2: Use a standard strong password: `Qaostest123!`.

### Step 3: Fill in all required fields (Name, Email, Password, Confirm Password).

### Step 4: If a "TOS" or "Privacy Policy" checkbox is present, you MUST click it.

### Step 5: Submit the form and report if an "Email Verification" screen appears.
