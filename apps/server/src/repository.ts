import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { Repository } from "@cartograph/shared";
import type { Store } from "./store.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export function registerRepository(store: Store, pathInput: string, ownerId = "local-user"): Repository {
  const rootPath = resolve(pathInput);
  if (!existsSync(rootPath)) throw new Error(`Repository does not exist: ${rootPath}`);
  if (!statSync(rootPath).isDirectory()) throw new Error(`Repository path is not a directory: ${rootPath}`);
  const existing = store.repositories(ownerId).find(repository => repository.rootPath === rootPath);
  if (existing) return existing;
  const repository = { id: `repo_${hash(rootPath).slice(0, 16)}`, name: basename(rootPath), rootPath, addedAt: new Date().toISOString() };
  store.upsertRepository(repository, ownerId);
  return repository;
}
