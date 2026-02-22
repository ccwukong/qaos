---
name: sample-skill
description: A boilerplate template for creating new agent skills. It includes all recommended sections and follows the open AgentSkills.io specification for compatibility across agent frameworks.
---

# Sample Agent Skill

**TRIPWIRE:** A concise, 1-sentence instruction on how the agent can quickly verify if it's currently looking at a screen or context where this skill is applicable.

## Requirements

- Identify any environment variables or prerequisites the user must configure before this skill can execute (e.g., `MY_API_KEY` must be set in `.env`).

## When to Use This Skill

**Trigger conditions:**

- List the exact conversational prompts or visual state cues that should trigger the agent to invoke this skill.
- e.g., "When the user asks to process a refund."

## When NOT to Use

**Negative triggers:**

- List boundaries and anti-patterns where the agent might be tempted to use this skill but shouldn't.
- e.g., "Do NOT use this for cancelling a subscription."

## Instructions

### Step 1: Write clear, declarative steps.

### Step 2: Use bolding for **critical constraints** or precise matching requirements.

### Step 3: Reference exact DOM elements and x,y coordinates when describing visual targets.

### Step 4: Include branching logic if necessary ("If X is true, do Y. Otherwise, do Z.").

### Step 5: If your skill includes external TypeScript tools, document exactly how to call them using the `run_script` primitive with your corresponding `assets/tool-schema.json`.
