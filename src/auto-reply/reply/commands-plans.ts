import fs from "node:fs/promises";
import path from "node:path";

import type { CommandHandler } from "./commands-types.js";

type PlansArgs = {
  action: "list" | "show" | "rename" | "trash" | "help";
  a?: string;
  b?: string;
};

function parsePlansArgs(raw: string): PlansArgs {
  const trimmed = raw.trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  const cmd = parts[0]?.toLowerCase();
  if (cmd !== "/plans") return { action: "help" };
  const sub = parts[1]?.toLowerCase();
  if (!sub || sub === "list") return { action: "list" };
  if (sub === "help") return { action: "help" };
  if (sub === "show") return { action: "show", a: parts[2] };
  if (sub === "rename") return { action: "rename", a: parts[2], b: parts[3] };
  if (sub === "trash" || sub === "delete" || sub === "rm") return { action: "trash", a: parts[2] };
  // Default: treat unknown as help.
  return { action: "help" };
}

async function listPlanDirs(plansDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(plansDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => !name.startsWith("."))
      .sort();
  } catch (err: any) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
}

async function readFirstExisting(paths: string[]): Promise<string | null> {
  for (const p of paths) {
    try {
      const text = await fs.readFile(p, "utf-8");
      return text;
    } catch (err: any) {
      if (err?.code === "ENOENT") continue;
      throw err;
    }
  }
  return null;
}

export const handlePlansCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) return null;

  // Match on normalized command body
  if (!params.command.commandBodyNormalized.startsWith("/plans")) return null;

  const raw =
    params.ctx.BodyForCommands ??
    params.ctx.CommandBody ??
    params.ctx.RawBody ??
    params.ctx.BodyStripped ??
    params.ctx.Body ??
    "/plans";

  const args = parsePlansArgs(raw);

  const plansDir = path.join(params.workspaceDir, "plans");

  if (args.action === "help") {
    return {
      shouldContinue: false,
      reply: {
        text:
          "Usage:\n" +
          "  /plans list\n" +
          "  /plans show <name>\n" +
          "  /plans rename <old> <new>\n" +
          "  /plans trash <name>\n\n" +
          "Notes:\n" +
          "- Plans are stored under workspace/plans/.\n" +
          "- Use /plan <goal> to start a new plan; /plans helps manage saved plan folders.",
      },
    };
  }

  if (args.action === "list") {
    const names = await listPlanDirs(plansDir);
    if (names.length === 0) {
      return {
        shouldContinue: false,
        reply: { text: "No plans found yet. Create one with: /plan <goal>" },
      };
    }

    const lines = ["Plans:", ...names.map((n) => `- ${n}`), "", "Tip: /plans show <name>"];
    return { shouldContinue: false, reply: { text: lines.join("\n") } };
  }

  if (args.action === "show") {
    const name = String(args.a ?? "").trim();
    if (!name) {
      return { shouldContinue: false, reply: { text: "Usage: /plans show <name>" } };
    }

    const planDir = path.join(plansDir, name);
    const planMd = await readFirstExisting([
      path.join(planDir, "plan.md"),
      path.join(planDir, "README.md"),
    ]);

    if (!planMd) {
      return {
        shouldContinue: false,
        reply: { text: `No plan.md found for '${name}'. Looked in: ${planDir}` },
      };
    }

    const trimmed = planMd.trim();
    const preview = trimmed.length > 1800 ? `${trimmed.slice(0, 1800)}\n\n…(truncated)` : trimmed;
    return {
      shouldContinue: false,
      reply: { text: `Plan: ${name}\n\n${preview}` },
    };
  }

  if (args.action === "rename") {
    const from = String(args.a ?? "").trim();
    const to = String(args.b ?? "").trim();
    if (!from || !to) {
      return { shouldContinue: false, reply: { text: "Usage: /plans rename <old> <new>" } };
    }
    const fromDir = path.join(plansDir, from);
    const toDir = path.join(plansDir, to);

    await fs.mkdir(plansDir, { recursive: true });
    await fs.rename(fromDir, toDir);

    return {
      shouldContinue: false,
      reply: { text: `Renamed plan '${from}' → '${to}'.` },
    };
  }

  if (args.action === "trash") {
    const name = String(args.a ?? "").trim();
    if (!name) {
      return { shouldContinue: false, reply: { text: "Usage: /plans trash <name>" } };
    }

    const fromDir = path.join(plansDir, name);
    const trashDir = path.join(plansDir, ".trash");
    await fs.mkdir(trashDir, { recursive: true });

    const stamped = `${name}__${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const toDir = path.join(trashDir, stamped);
    await fs.rename(fromDir, toDir);

    return {
      shouldContinue: false,
      reply: { text: `Moved plan '${name}' to trash.` },
    };
  }

  return null;
};
