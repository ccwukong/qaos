---
name: standard-math
description: Provide precise mathematical computations by executing an isolated script. Use this workflow when arithmetic, mathematical evaluation, or strict data generation is required.
---

# Standard Math

This skill allows you to perform precise calculations using the `run_script` action.

## When to Use This Skill

**Trigger conditions:**

- When the user asks you to calculate, multiply, divide, or sum numbers.
- When precise arithmetic is needed for asserting test values.

## Instructions

### Step 1: Analyze Request: Identify the calculation needed.

### Step 2: Execute Script: Use the `calculate` tool.

```json
{
  "action": "run_script",
  "skill_name": "standard-math",
  "script": "calculate",
  "args": { "expression": "123 * 456" }
}
```

### Step 3: Report Result: Use the output in your reasoning or answer.
