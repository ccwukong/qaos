<div align="center">
  <img src="app/public/logo.svg" alt="qaos logo" width="120" />
  <h1>qaos</h1>
  <p>
    <a href="https://github.com/ccwukong/qaos/actions/workflows/test.yml"><img src="https://github.com/ccwukong/qaos/actions/workflows/test.yml/badge.svg" alt="CI Status"></a>
  </p>
  <p>
    <strong>/ˈkeɪ.ɒs/</strong> (rhymes with "chaos")
  </p>
  <p>
    <strong>An Open Source AI QA Co-founder.</strong>
  </p>
</div>

Built on top of **AI Agent** and **Skills**, qaos helps projects of all sizes build and run QA test cases progressively and automatically. It acts as a collaborative partner, exploring your application to discover bugs, generate test cases, and ensure quality at speed.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Split-Screen Workspace                            │
│  ┌──────────┬──────────────────┬──────────────────┐│
│  │ Sidebar  │   Chat Feed      │  Live Canvas     ││
│  │          │   (SSE stream)   │  (Puppeteer)     ││
│  │ Sessions │                  │                  ││
│  │ Settings │   [Export JSON]  │  [Screenshot]    ││
│  └──────────┴──────────────────┴──────────────────┘│
└─────────────────────────────────────────────────────┘
```

- **Frontend**: React Router v7 (SSR), Vite, Tailwind CSS v4
- **Backend**: Node.js, TypeScript, better-sqlite3, Drizzle ORM
- **Agent**: OpenAI / OpenRouter via Settings
- **Browser**: Puppeteer with stateful session management
- **Streaming**: Server-Sent Events (SSE) for real-time updates

## Quick Start

```bash
# Install dependencies
npm install

# Copy env (optional — you can also configure in Settings UI)
cp .env.example .env
# Add your API key to .env or configure in Settings

# Start dev server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). A new chat session is created automatically.

## Usage

1. **Send a URL**: e.g. *"Navigate to https://example.com and test the signup flow"*
2. **Watch the agent**: It launches a browser, takes screenshots, and streams its reasoning
3. **Talk back**: Ask follow-up questions, steer the testing, clarify actions
4. **Smart Replay**: Curate the session by excluding irrelevant messages, then click `▶️ Replay` to re-run the exact flow as an end-to-end test against live UI changes.
5. **Export**: Click `📥 Export` to download the session as a reusable JSON test case
6. **Delete**: Click the trash icon 🗑️ in the sidebar to remove old sessions

## Settings

Go to **⚙️ Settings** (bottom-left of sidebar) to configure:

- **Theme**: Light / Dark / System (Auto-saves on change)
- **Model**: Choose provider (OpenAI, OpenRouter) and model (Auto-saves on change)
- **API Keys**: Stored locally in SQLite — never sent to any third party

## Screenshots & Privacy

qaos takes screenshots of the browser viewport to help the AI agent understand the page layout, including the position of buttons, forms, and other interactive elements.

- **Privacy**: These screenshots are sent to the configured Vision API (e.g., OpenAI, Anthropic) for analysis. They are NOT sent to the qaos team or any other third party.
- **Opt-out**: If you prefer not to share visual data or want to improve performance, you can disable this feature by setting `DISABLE_SCREENSHOTS=true` in your `.env` file. The agent will rely solely on the text-based DOM representation.

## Environment Variables

You can configure qaos using a `.env` file in the root directory.

| Variable | Description | Default |
| :--- | :--- | :--- |
| `OPENAI_API_KEY` | API key for OpenAI (GPT-4o, etc.) | - |
| `OPENROUTER_API_KEY` | API key for OpenRouter (Claude, Gemini, etc.) | - |
| `HEADLESS` | Run Puppeteer in headless mode (`false` to view browser UI) | `true` |
| `DISABLE_SCREENSHOTS` | Set to `false` to enable screenshots (opt-in) | `true` |
| `DATABASE_URL` | Database connection string. Use `file:./.qaos/qaos.db` for SQLite or `postgresql://...` for PG. | `file:./.qaos/qaos.db` |
| `TEST_USER` | Username/Email for the `standard-login` skill | - |
| `TEST_USER_PASSWORD` | Password for the `standard-login` skill | - |

## Available Skills

qaos comes with built-in skills to handle common scenarios. The agent automatically detects when to use them.

- **standard-login**: Handles typical email/password login flows.
- **standard-registration**: Handles new user sign-up flows with dummy data.
- **standard-math**: Performs precise mathematical calculations.
- **stripe-checkout**: Fills out Stripe payment forms using test credentials.

### Contributing New Skills

We welcome contributions! qaos skills conform to the open [AgentSkills.io](https://agentskills.io/) specification, allowing them to be shared across any compatible AI agent framework.

To create a new skill:
1. Copy the `templates/sample-skill/` directory to `skills/<your-skill-name>/`
2. Update the `SKILL.md` file with your skill's `name` and `description` in the YAML frontmatter.
3. Write your clear, step-by-step markdown instructions for the AI below the frontmatter. Include exact coordinates or precise conditions when possible.
4. **(Optional)** Provide executable TypeScript tool functions inside a `scripts/` directory and map them to standard JSON schemas inside an `assets/` directory.
5. **(Optional)** Add supplementary documentation, context, or visual examples to the `references/` directory.

> **Note**: For sensitive credentials (like passwords), instruct the agent to use the native `type_secret` tool to pull them directly from the `.env` file instead of passing them via LLM prompt instructions.

## Database Setup

By default, qaos requires a **DATABASE_URL** environment variable. For a local SQLite database, you set:

```bash
DATABASE_URL="file:./.qaos/qaos.db"
```

This directory is gitignored as it contains runtime data (sessions, screenshots, DB).

### Using PostgreSQL

If you prefer a remote database (e.g., Supabase, RDS), set your `DATABASE_URL` to a postgres connection string:

```bash
DATABASE_URL="postgresql://user:password@host:5432/qaos"
```

The application will automatically connect to Postgres instead of creating a local SQLite file.

## Project Structure

```
.
├── skills/            # Skill definitions (SKILL.md, scripts)
│   ├── standard-login/
│   └── ...
├── docs/              # Documentation
├── bin/               # Scripts (debug-skills.ts)
├── .qaos/             # Runtime data (screenshots, db)
├── app/
│   ├── db/            # Database schema & connection
│   ├── public/        # Static assets (logo, favicon)
│   ├── routes/        # React Router routes
│   └── services/      # Backend logic (agent, skills, etc.)
├── .env               # Configuration
├── package.json       # Dependencies
└── vite.config.ts     # Build configuration
```

## License

This project is licensed under the [Apache License 2.0](LICENSE). 

If you use **qaos** or its skill definitions in your own projects, workflows, or products, we kindly ask that you provide attribution by linking back to this repository. We'd love to see what you build!
