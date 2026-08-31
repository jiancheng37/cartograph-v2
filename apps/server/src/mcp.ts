import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { openDatabase } from "./db.js";
import { createCartographMcp } from "./mcp-server.js";
import { connectMcp, disconnectMcp, heartbeatMcp, touchMcp } from "./presence.js";
import { ScopedStore } from "./scoped-store.js";
import { Store } from "./store.js";

const database = openDatabase(resolve(process.env.CARTOGRAPH_DB ?? ".cartograph/cartograph.db"));
const store = new ScopedStore(new Store(database), process.env.CARTOGRAPH_DEV_USER ?? "local-user");
const server = createCartographMcp(store, { hosted: false, activity: () => touchMcp(database) });
connectMcp(database);
const heartbeat = setInterval(() => heartbeatMcp(database), 5_000); heartbeat.unref();
process.on("exit", () => disconnectMcp(database));
await server.connect(new StdioServerTransport());
