---
name: stripe-checkout
description: Fills out Stripe payment forms using test credentials. Use this workflow ONLY when a credit card input or Stripe checkout form is visible.
---

# Stripe Checkout

**TRIPWIRE:** Ensure a 16-digit credit card field or a "Powered by Stripe" logo is visible.

## When to Use This Skill

**Trigger conditions:**

- When the user asks to pay, purchase, or subscribe to a plan.
- When a Stripe Checkout modal or embedded credit card form is visible.

## When NOT to Use

**Negative triggers:**

- Do NOT use for PayPal or generic banking flows.

## Instructions

### Step 1: Use Card Number: `4242 4242 4242 4242`.

### Step 2: Use Expiry: `12 / 34`. CVC: `123`. Zip: `12345`.

### Step 3: If the form asks for a Name, use "QAOS TESTER".

### Step 4: After filling the form, click the "Pay", "Subscribe", or "Purchase" button.

### Step 5: Wait for the success state (e.g., checkmark, redirect, or "Thank you" message).
