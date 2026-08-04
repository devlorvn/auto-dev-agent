import { execa } from "execa";
import chalk from "chalk";
import { CodeGraphContext } from "../types";

interface CacheEntry {
  timestamp: number;
  data: CodeGraphContext;
}

const memoryCache = new Map<string, CacheEntry>();

export async function analyzeCodebaseWithGitNexus(
  issueTitle: string,
  issueBody: string,
  cacheTtlMs: number = 10 * 60 * 1000,
): Promise<CodeGraphContext> {
  const query = `${issueTitle} ${issueBody}`.trim().slice(0, 300);

  // Check in-memory cache
  const cached = memoryCache.get(query);
  if (cached && Date.now() - cached.timestamp < cacheTtlMs) {
    console.log(
      chalk.blue(
        "⚡ [GitNexus Cache] Returning cached codebase graph analysis (0ms execution time).",
      ),
    );
    return cached.data;
  }

  console.log(
    chalk.blue(
      "🧬 [GitNexus Engine] Analyzing AST syntax tree & codebase dependency graph...",
    ),
  );

  try {
    // 1. Run gitnexus analyze (with npx fallback)
    try {
      await execa("gitnexus", ["analyze"], {
        cwd: process.cwd(),
        timeout: 15000,
      });
    } catch {
      await execa("npx", ["-y", "gitnexus", "analyze"], {
        cwd: process.cwd(),
        timeout: 20000,
      });
    }

    // 2. Query gitnexus for relation graph and blast radius
    let stdout = "";
    try {
      const res = await execa("gitnexus", ["query", "--prompt", query], {
        cwd: process.cwd(),
        timeout: 15000,
      });
      stdout = res.stdout;
    } catch {
      const res = await execa(
        "npx",
        ["-y", "gitnexus", "query", "--prompt", query],
        { cwd: process.cwd(), timeout: 20000 },
      );
      stdout = res.stdout;
    }

    console.log(
      chalk.green(
        "✅ [GitNexus Engine] Codebase graph analysis completed successfully.",
      ),
    );

    let result: CodeGraphContext;

    try {
      const parsed = JSON.parse(stdout);
      result = {
        affectedFiles: parsed.affectedFiles || parsed.files || [],
        callChains: parsed.callChains || parsed.relationships || [],
        blastRadiusSummary: parsed.summary || stdout,
        isAvailable: true,
      };
    } catch {
      result = {
        affectedFiles: [],
        callChains: [],
        blastRadiusSummary: stdout.slice(0, 1500),
        isAvailable: true,
      };
    }

    memoryCache.set(query, { timestamp: Date.now(), data: result });
    return result;
  } catch (error: any) {
    console.log(
      chalk.yellow(
        `ℹ️ GitNexus CLI skipped or uninitialized: ${error.message}. Continuing with standard workspace profiler.`,
      ),
    );
    return {
      affectedFiles: [],
      callChains: [],
      blastRadiusSummary:
        "GitNexus graph analysis unavailable for this repository run.",
      isAvailable: false,
    };
  }
}
