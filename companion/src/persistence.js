import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { QueueCommitError } from "./errors.js";

const POSIX_UNSUPPORTED = new Set(["EINVAL", "ENOTSUP", "EOPNOTSUPP"]);
const WINDOWS_UNSUPPORTED = new Set(["EISDIR", "EPERM", "EINVAL", "ENOTSUP", "EOPNOTSUPP"]);

async function directorySync(dir, { fsImpl = fs, platform = process.platform } = {}) {
  let handle;
  try {
    handle = await fsImpl.open(dir, "r");
  } catch (err) {
    const unsupported = platform === "win32" ? WINDOWS_UNSUPPORTED : POSIX_UNSUPPORTED;
    if (unsupported.has(err?.code)) return { supported: false, reason: err.code };
    throw err;
  }
  try {
    await handle.sync();
    return { supported: true };
  } catch (err) {
    const unsupported = platform === "win32" ? WINDOWS_UNSUPPORTED : POSIX_UNSUPPORTED;
    if (unsupported.has(err?.code)) return { supported: false, reason: err.code };
    throw err;
  } finally {
    await handle.close().catch(() => {});
  }
}

async function existsDir(p, fsImpl) {
  try {
    const st = await fsImpl.stat(p);
    if (!st.isDirectory()) {
      const err = new Error(`path exists but is not a directory: ${p}`);
      err.code = "ENOTDIR";
      throw err;
    }
    return true;
  } catch (err) {
    if (err?.code === "ENOENT") return false;
    throw err;
  }
}

export async function ensureDirectoryDurable(dir, options = {}) {
  const { fsImpl = fs } = options;
  const target = path.resolve(dir);
  if (await existsDir(target, fsImpl)) {
    const parentResult = await directorySync(path.dirname(target), options);
    return parentResult.supported
      ? { durability: "durable", degradedReasons: [] }
      : { durability: "degraded", degradedReasons: [`directory-fsync:${parentResult.reason}`] };
  }

  const missing = [];
  let cursor = target;
  while (!(await existsDir(cursor, fsImpl))) {
    missing.push(cursor);
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error(`cannot find existing ancestor for ${target}`);
    cursor = parent;
  }

  const degradedReasons = [];
  for (const next of missing.reverse()) {
    try {
      await fsImpl.mkdir(next, { mode: 0o700 });
    } catch (err) {
      if (err?.code !== "EEXIST" || !(await existsDir(next, fsImpl))) throw err;
    }
    const parentResult = await directorySync(path.dirname(next), options);
    if (!parentResult.supported) degradedReasons.push(`directory-fsync:${parentResult.reason}`);
  }
  return {
    durability: degradedReasons.length ? "degraded" : "durable",
    degradedReasons,
  };
}

export async function writeStateAtomic(file, state, options = {}) {
  const { fsImpl = fs } = options;
  const dir = path.dirname(file);
  const dirStatus = await ensureDirectoryDurable(dir, options);
  const tmp = path.join(
    dir,
    `.${path.basename(file)}.tmp-${process.pid}-${crypto.randomBytes(8).toString("hex")}`
  );

  let handle;
  let renamed = false;
  try {
    handle = await fsImpl.open(tmp, "wx", 0o600);
    await handle.writeFile(JSON.stringify(state, null, 2), "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fsImpl.rename(tmp, file);
    renamed = true;

    let dirSync;
    try {
      dirSync = await directorySync(dir, options);
    } catch (err) {
      throw new QueueCommitError(`queue state was renamed but directory fsync failed: ${err.message}`, {
        cause: err,
        file,
      });
    }

    const degradedReasons = [...dirStatus.degradedReasons];
    if (!dirSync.supported) degradedReasons.push(`directory-fsync:${dirSync.reason}`);
    return {
      durability: degradedReasons.length ? "degraded" : "durable",
      degradedReasons: [...new Set(degradedReasons)],
    };
  } catch (err) {
    if (renamed) {
      if (err instanceof QueueCommitError) throw err;
      throw new QueueCommitError(`queue state committed but post-rename step failed: ${err.message}`, {
        cause: err,
        file,
      });
    }
    throw err;
  } finally {
    if (handle) await handle.close().catch(() => {});
    if (!renamed) await fsImpl.unlink(tmp).catch(() => {});
  }
}

export async function readTextIfExists(file, { fsImpl = fs } = {}) {
  try {
    return await fsImpl.readFile(file, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

export async function quarantineOrphanTemps(queueFile, options = {}) {
  const { fsImpl = fs } = options;
  const dir = path.dirname(queueFile);
  let entries;
  try {
    entries = await fsImpl.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err?.code === "ENOENT") return { count: 0, paths: [], durability: "durable", degradedReasons: [] };
    throw err;
  }
  const prefix = `.${path.basename(queueFile)}.tmp-`;
  const orphans = entries.filter((e) => e.isFile() && e.name.startsWith(prefix));
  if (!orphans.length) return { count: 0, paths: [], durability: "durable", degradedReasons: [] };

  const quarantineDir = `${queueFile}.quarantine`;
  const qStatus = await ensureDirectoryDurable(quarantineDir, options);
  const moved = [];
  for (const entry of orphans) {
    const from = path.join(dir, entry.name);
    const to = path.join(
      quarantineDir,
      `${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${entry.name.replace(/^\./, "")}`
    );
    await fsImpl.rename(from, to);
    moved.push(to);
  }

  const degradedReasons = [...qStatus.degradedReasons];
  for (const syncDir of [quarantineDir, dir]) {
    const result = await directorySync(syncDir, options);
    if (!result.supported) degradedReasons.push(`directory-fsync:${result.reason}`);
  }
  return {
    count: moved.length,
    paths: moved,
    durability: degradedReasons.length ? "degraded" : "durable",
    degradedReasons: [...new Set(degradedReasons)],
  };
}

export { directorySync };
