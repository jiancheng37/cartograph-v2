# Production deployment

Cartograph uses three deployable surfaces:

- `cartograph.com`: the public Vite build (`VITE_CARTOGRAPH_SURFACE=marketing`)
- `app.cartograph.com`: the authenticated Vite build (`VITE_CARTOGRAPH_SURFACE=app`)
- `api.cartograph.com`: the Express API and remote MCP endpoint

## 1. Create Supabase

Create a Supabase project and run [`supabase/migrations/202608310001_initial.sql`](supabase/migrations/202608310001_initial.sql) in its SQL editor (or with `supabase db push`). In Authentication → Providers, enable Google and supply the Google OAuth client credentials.

Add these redirect URLs in Supabase Authentication → URL Configuration:

```text
http://localhost:5173/auth/callback
https://app.cartograph.com/auth/callback
```

Use the Supabase publishable key in the browser. Never put the service-role key in a Vite variable.

## 2. Deploy the API

Build the root [`Dockerfile`](Dockerfile) on a container host and map HTTPS traffic to `PORT`. Set:

```text
NODE_ENV=production
DATABASE_URL=<Supabase direct or pooler Postgres URL>
SUPABASE_URL=https://<project>.supabase.co
CARTOGRAPH_WEB_ORIGIN=https://app.cartograph.com,https://cartograph.com
CARTOGRAPH_MCP_URL=https://api.cartograph.com/mcp
```

The process deliberately refuses to boot if a required production variable is absent. Verify `GET https://api.cartograph.com/health` returns `storage: postgres`.

## 3. Deploy the two web surfaces

Create two static-host projects from `apps/web`. For each, use the repository root, run `npm ci && npm run build -w @cartograph/shared && npm run build -w @cartograph/web`, and publish `apps/web/dist`.

Shared web variables:

```text
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key>
VITE_API_URL=https://api.cartograph.com
VITE_APP_URL=https://app.cartograph.com
VITE_MARKETING_URL=https://cartograph.com
```

Set `VITE_CARTOGRAPH_SURFACE=marketing` on the public project and `VITE_CARTOGRAPH_SURFACE=app` on the app project. Both hosts need SPA fallback routing to `index.html`, particularly `/auth/callback`.

## 4. Smoke test

1. Open the public site and choose **Start with Google**.
2. Sign in and create a logical repository workspace.
3. Open **Connect Cartograph**, generate a one-time token, and run the shown Codex or Claude Code setup.
4. Ask the agent to register the current repository and create a map.
5. Confirm the map appears only in that signed-in account; revoke the token and confirm it can no longer call `/mcp`.

Source code remains in the coding agent's environment. The cloud stores repository labels, structured maps, traces, and repository-relative references—not repository contents.
