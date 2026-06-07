import { chmod, lstat, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { resolveDaemonPlaywrightChromiumExecutablePath } from "../src/resources.js";

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDaemonPlaywrightFixture(workspaceRoot: string): Promise<{
  cleanup: () => Promise<void>;
  executablePath: string;
  headlessSentinel: string;
  headedRoot: string;
  headlessRoot: string;
}> {
  const executablePath = resolveDaemonPlaywrightChromiumExecutablePath(workspaceRoot);
  let headedRoot = dirname(executablePath);
  while (!/^chromium-(\d+)$/i.test(basename(headedRoot))) {
    const parent = dirname(headedRoot);
    if (parent === headedRoot) {
      throw new Error(`tools-pack tests: unexpected Playwright Chromium root ${executablePath}`);
    }
    headedRoot = parent;
  }
  const chromeDir = dirname(executablePath);
  const revisionMatch = basename(headedRoot).match(/^chromium-(\d+)$/i);
  if (!revisionMatch) {
    throw new Error(`tools-pack tests: unexpected Playwright Chromium root ${headedRoot}`);
  }
  const revision = revisionMatch[1];
  const headlessRoot = join(dirname(headedRoot), `chromium_headless_shell-${revision}`);
  const headlessSentinel = join(headlessRoot, "HEADLESS_SENTINEL");
  if (!(await pathExists(headedRoot))) {
    await mkdir(chromeDir, { recursive: true });
    await writeFile(executablePath, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(executablePath, 0o755);
    await writeFile(join(chromeDir, "LICENSE"), "license\n", "utf8");
  }

  if (!(await pathExists(headlessRoot))) {
    await mkdir(headlessRoot, { recursive: true });
  }

  if (!(await pathExists(headlessSentinel))) {
    await writeFile(headlessSentinel, "headless shell\n", "utf8");
  }

  return {
    // These tests share the daemon-resolved Playwright cache roots across
    // multiple Vitest workers. Removing the synthetic bundle during one file's
    // teardown can race another file that is still hashing or copying it.
    cleanup: async () => {},
    executablePath,
    headlessSentinel,
    headedRoot,
    headlessRoot,
  };
}
