import { createApp } from "./app.js";

if (process.env.NODE_ENV !== "test") {
  const required = ["DATABASE_URL", "SUPABASE_URL", "CARTOGRAPH_WEB_ORIGIN", "CARTOGRAPH_MCP_URL"] as const;
  const missing = required.filter(name => !process.env[name]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(", ")}. Start Cartograph with npm run dev.`);
}

const port = Number(process.env.PORT ?? 4310);
const { app } = createApp();
app.listen(port, () => console.log(`Cartograph API listening on http://localhost:${port}`));
