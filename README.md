# Cartograph

Cartograph turns investigations from Codex, Claude Code, and other MCP clients into persistent visual maps of a codebase. It is a durable workspace for agent-authored understanding, not a code scanner or replacement for coding agents.

## What is implemented

- Lightweight repository registration: hosted Cartograph stores a logical repository identity, never repository contents.
- Semantic views containing components, execution steps, typed relationships, confidence levels, and agent-supplied source references.
- Optimistic revision control so two agents cannot silently overwrite the same view.
- MCP tools for discovering prior knowledge, creating level-specific architecture views, extending views, drill-downs, and traces.
- Interactive React Flow canvas with progressive disclosure, source inspection, confidence styling, and live view refresh.
- Google authentication, tenant-scoped PostgreSQL persistence, revocable MCP credentials, and a remote Streamable HTTP MCP endpoint.
- Local development runs against the same Supabase authentication, PostgreSQL storage, and HTTP MCP boundary used in production.

## Run locally

Requires Node.js 24 or later because Cartograph uses the built-in `node:sqlite` module.

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and sign in with Google. The development command loads the linked Supabase project and database password from macOS Keychain, so local behavior uses real sessions, tenant isolation, PostgreSQL, and remote MCP tokens. It fails closed when authentication or database configuration is unavailable.

## Connect an MCP client

Sign in, create a workspace, then open **Connect Cartograph**. Generate a revocable token and run the displayed HTTP MCP command for Codex or Claude Code.

For this source checkout, install the Cartograph CLI command once:

```bash
npm run build -w @cartograph/cli
npm link -w @cartograph/cli
```

Then connect without putting the token in an environment file or shell history:

```bash
cartograph login --url http://localhost:4310/mcp
```

Paste the one-time token at the hidden prompt. The CLI validates it, stores it in macOS Keychain, and persistently configures Codex. Use `cartograph status` to verify the connection and `cartograph logout` to revoke the local credential and remove the Codex MCP entry.

Then ask the agent:

> Use Cartograph on this repository. Register the repository if needed, search for a relevant saved view, then explain how authentication works and create or extend a compact map with source-file references for its claims.

The MCP server exposes:

- `list_repositories`
- `register_repository`
- `find_views`
- `get_view`
- `create_view`
- `extend_view`
- `create_node_drilldown`
- `create_trace`
- `list_traces`

The token is shown once; Cartograph stores only its SHA-256 hash. Local development uses `http://localhost:4310/mcp`; deployed environments use the configured API URL.

## Architecture

```text
Codex / Claude Code ── authenticated remote MCP ──▶ API ──▶ PostgreSQL
        │                                             ▲          │
        └── reads local source and sends maps ────────┘          ▼
                                                       app.cartograph.com
```

Agents remain responsible for reading and interpreting source code. Cartograph persists their maps, traces, confidence labels, and repository-relative source references.

## Commands

```bash
npm run dev       # API and web app
npm run build     # production builds
npm test          # unit and integration tests
npm run test:e2e  # browser tests
npm run typecheck # strict TypeScript checks
```

## Deploy

Follow [`DEPLOYMENT.md`](DEPLOYMENT.md) for Supabase Google OAuth, PostgreSQL migration, API container, DNS surfaces, and a production smoke test.

## Product boundary

Cartograph does not parse, upload, or index repositories. It also does not infer dependency graphs or calculate change impact by itself. Those investigations belong to the connected coding agent; Cartograph stores the resulting visual knowledge under the authenticated user's account.
