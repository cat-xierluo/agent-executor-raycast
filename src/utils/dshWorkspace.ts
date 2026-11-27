import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

export interface DshWorkspaceInfo {
  name: string;
  home: string;
  description?: string;
  skillCount: number;
}

function resolveDshHome(): string {
  return process.env.DSH_HOME || join(homedir(), ".dsh");
}

export function resolveDshWorkspaceRoot(): string {
  return join(resolveDshHome(), "bot", "workspace");
}

const ACTIVE_WORKSPACE_FILE = join(resolveDshHome(), "bot", "active-workspace");

export function getSelectedDshWorkspaceSync(): string {
  try {
    if (!existsSync(ACTIVE_WORKSPACE_FILE)) return "";
    const name = readFileSync(ACTIVE_WORKSPACE_FILE, "utf-8").trim();
    return resolveDshWorkspaceHome(name) ? name : "";
  } catch {
    return "";
  }
}

export function setSelectedDshWorkspaceSync(name: string): void {
  try {
    mkdirSync(dirname(ACTIVE_WORKSPACE_FILE), { recursive: true });
    writeFileSync(ACTIVE_WORKSPACE_FILE, name, "utf-8");
  } catch {
    // Keep the in-memory selection usable if persistence fails.
  }
}

export function resolveDshWorkspaceHome(name: string): string | undefined {
  if (!name) return undefined;
  const home = join(resolveDshWorkspaceRoot(), name);
  return existsSync(home) && existsSync(join(home, "skills"))
    ? home
    : undefined;
}

export function scanDshWorkspaces(): DshWorkspaceInfo[] {
  const root = resolveDshWorkspaceRoot();
  if (!existsSync(root)) return [];

  return readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        existsSync(join(root, entry.name, "skills")),
    )
    .map((entry) => ({
      name: entry.name,
      home: join(root, entry.name),
      description: readWorkspaceDescription(join(root, entry.name)),
      skillCount: countWorkspaceSkills(join(root, entry.name, "skills")),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function resolveSelectedOrFirstDshWorkspace():
  DshWorkspaceInfo | undefined {
  const selectedName = getSelectedDshWorkspaceSync();
  const workspaces = scanDshWorkspaces();
  const selected = workspaces.find(
    (workspace) => workspace.name === selectedName,
  );
  if (selected) return selected;

  const first = workspaces[0];
  if (first) setSelectedDshWorkspaceSync(first.name);
  return first;
}

function readWorkspaceDescription(home: string): string | undefined {
  for (const file of ["README.md", "SOUL.md"]) {
    try {
      const line = readFileSync(join(home, file), "utf-8")
        .split("\n")
        .map((value) => value.trim())
        .find((value) => value && !value.startsWith("#"));
      if (line) return line;
    } catch {
      // Try the next workspace metadata file.
    }
  }
  return undefined;
}

function countWorkspaceSkills(root: string, depth = 0): number {
  if (!existsSync(root) || depth > 4) return 0;

  let count = 0;
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = join(root, entry.name);
      if (existsSync(join(full, "SKILL.md"))) {
        count++;
      } else if (entry.isDirectory() || entry.isSymbolicLink()) {
        count += countWorkspaceSkills(full, depth + 1);
      }
    }
  } catch {
    // Unreadable branches contribute no skills.
  }
  return count;
}
