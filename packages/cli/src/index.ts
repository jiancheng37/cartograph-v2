#!/usr/bin/env node
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const service = "cartograph-mcp-token";
const account = userInfo().username;
const configPath = join(homedir(), ".config", "cartograph", "config.json");
const defaultUrl = "http://localhost:4310/mcp";
type Config = { mcpUrl: string };

async function main() {
  const [command = "help", ...args] = process.argv.slice(2);
  if (command === "login") return login(value(args, "--url") ?? process.env.CARTOGRAPH_MCP_URL ?? defaultUrl, value(args, "--token"));
  if (command === "logout") return logout();
  if (command === "status") return status();
  if (command === "mcp") return proxyMcp();
  help(!["help", "--help", "-h"].includes(command));
}

async function login(mcpUrl: string, supplied?: string) {
  assertMac();
  const token = supplied?.trim() || await hiddenPrompt("Paste your Cartograph connection token: ");
  if (!token.startsWith("ctg_") || token.length < 30) throw new Error("That does not look like a Cartograph token.");
  stdout.write("Validating token… ");
  await validate(mcpUrl, token);
  stdout.write("connected\n");
  keychain(["add-generic-password", "-U", "-a", account, "-s", service, "-w", token]);
  await saveConfig({ mcpUrl });
  configureCodex();
  stdout.write("\nCartograph login complete. Codex can use Cartograph after its next restart.\n");
  stdout.write(`Token stored in macOS Keychain · ${mcpUrl}\n`);
}

async function logout() {
  assertMac();
  keychain(["delete-generic-password", "-a", account, "-s", service], true);
  const removed = spawnSync("codex", ["mcp", "remove", "cartograph"], { stdio: "ignore" });
  stdout.write(`Cartograph credentials removed${removed.status === 0 ? " and Codex disconnected" : ""}.\n`);
}

async function status() {
  assertMac();
  const config = await loadConfig();
  const token = readToken();
  stdout.write(`Keychain: connected\nEndpoint: ${config.mcpUrl}\n`);
  try { await validate(config.mcpUrl, token); stdout.write("Remote token: valid\n"); }
  catch { stdout.write("Remote token: invalid or unreachable\n"); process.exitCode = 1; }
}

async function proxyMcp() {
  assertMac();
  const config = await loadConfig();
  const token = readToken();
  const remote = new Client({ name: "cartograph-keychain-bridge", version: "0.1.0" });
  await remote.connect(transport(config.mcpUrl, token));
  const local = new Server({ name: "cartograph", version: "0.1.0" }, { capabilities: { tools: {} } });
  local.setRequestHandler(ListToolsRequestSchema, async request => remote.listTools(request.params));
  local.setRequestHandler(CallToolRequestSchema, async request => remote.callTool(request.params));
  const stdio = new StdioServerTransport();
  await local.connect(stdio);
  const close = async () => { await Promise.allSettled([local.close(), remote.close()]); process.exit(0); };
  process.on("SIGINT", () => void close());
  process.on("SIGTERM", () => void close());
}

async function validate(url: string, token: string) {
  const client = new Client({ name: "cartograph-login", version: "0.1.0" });
  try { await client.connect(transport(url, token)); await client.listTools(); }
  finally { await client.close().catch(() => undefined); }
}

function transport(url: string, token: string) {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("The MCP URL is invalid."); }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") throw new Error("Remote MCP URLs must use HTTPS.");
  return new StreamableHTTPClientTransport(parsed, { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
}

function configureCodex() {
  const available = spawnSync("codex", ["--version"], { stdio: "ignore" });
  if (available.status !== 0) { stdout.write("Codex CLI was not found; Keychain login was saved without Codex configuration.\n"); return; }
  spawnSync("codex", ["mcp", "remove", "cartograph"], { stdio: "ignore" });
  const script = fileURLToPath(import.meta.url);
  const added = spawnSync("codex", ["mcp", "add", "cartograph", "--", process.execPath, script, "mcp"], { encoding: "utf8" });
  if (added.status !== 0) throw new Error(added.stderr.trim() || "Could not configure Codex.");
  stdout.write("Codex MCP configuration updated.\n");
}

async function hiddenPrompt(label: string) {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error("Interactive login requires a terminal. Pass --token only in a trusted local shell.");
  stdout.write(label);
  stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
  return new Promise<string>((resolve, reject) => {
    let input = "";
    const cleanup = () => { stdin.setRawMode(false); stdin.pause(); stdin.removeListener("data", onData); stdout.write("\n"); };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\u0003") { cleanup(); reject(new Error("Login cancelled.")); return; }
        if (character === "\r" || character === "\n") { cleanup(); resolve(input.trim()); return; }
        if (character === "\u007f") input = input.slice(0, -1);
        else input += character;
      }
    };
    stdin.on("data", onData);
  });
}

function readToken() {
  const result = keychain(["find-generic-password", "-a", account, "-s", service, "-w"]);
  const token = result.stdout.trim();
  if (!token) throw new Error("No Cartograph login found. Run cartograph login.");
  return token;
}

function keychain(args: string[], allowMissing = false) {
  const result = spawnSync("security", args, { encoding: "utf8" });
  if (result.status !== 0 && !allowMissing) throw new Error("Could not access macOS Keychain.");
  return result;
}

async function saveConfig(config: Config) {
  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(configPath, 0o600);
}

async function loadConfig(): Promise<Config> {
  try { const parsed = JSON.parse(await readFile(configPath, "utf8")) as Config; if (parsed.mcpUrl) return parsed; }
  catch { /* handled below */ }
  throw new Error("Cartograph is not configured. Run cartograph login.");
}

function value(args: string[], flag: string) { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; }
function assertMac() { if (process.platform !== "darwin") throw new Error("Secure login currently requires macOS Keychain."); }
function help(failed = false) {
  stdout.write("Cartograph CLI\n\n  cartograph login [--url URL]\n  cartograph status\n  cartograph logout\n");
  if (failed) process.exitCode = 1;
}

main().catch(error => { process.stderr.write(`Cartograph: ${error instanceof Error ? error.message : "Unexpected error"}\n`); process.exitCode = 1; });
