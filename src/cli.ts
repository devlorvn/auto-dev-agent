#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { Command } from "commander";
import dotenv from "dotenv";
import chalk from "chalk";
import { agentApp } from "./graph";
import { resolveConfig } from "./config";

dotenv.config();

const program = new Command();

program
  .name("agent")
  .description("Universal AI Coding Agent for local codebase")
  .version("1.0.0");

program
  .command("run")
  .description(
    "Run agent on a specific GitHub issue, Jira issue, or local Markdown task file",
  )
  .option("-i, --issue <number>", "GitHub Issue ID", parseInt)
  .option("-j, --jira <key>", "Jira Issue Key / ID (e.g. PROJ-123 or 10001)")
  .option(
    "--issue-id <id>",
    "Generic Issue ID (for Jira issue key or GitHub issue number)",
  )
  .option("-f, --file <path>", "Path to local task Markdown file (.md)")
  .option(
    "-c, --additional-context <path>",
    "Path to additional context file (.md, .txt) with extra details for the issue",
  )
  .option("--context <path>", "Alias for --additional-context")
  .option(
    "--mode <mode>",
    "Task source mode: jira, github, or file (auto-detected if omitted)",
  )
  .option(
    "--jira-host <url>",
    "Jira Host URL (overrides JIRA_HOST in environment/.env)",
  )
  .option(
    "--jira-token <token>",
    "Jira API Token (overrides JIRA_API_TOKEN in environment/.env)",
  )
  .option(
    "--jira-email <email>",
    "Jira user email (overrides JIRA_EMAIL in environment/.env)",
  )
  .option(
    "-p, --provider <provider>",
    "LLM Provider (antigravity-cli, gemini, anthropic, openai, openrouter)",
    process.env.LLM_PROVIDER || "anthropic",
  )
  .option(
    "-m, --model <model>",
    "Specific LLM Model Name (e.g. gemini-2.5-flash, claude-3-5-sonnet-20241022)",
  )
  .option("-k, --api-key <key>", "API Key for LLM provider")
  .option("-y, --yes", "Automatically approve all steps without prompt")
  .option(
    "--max-retries <number>",
    "Maximum TDD/Execution retries",
    parseInt,
    2,
  )
  .option(
    "--token-mode <mode>",
    "Token optimization mode (balanced, cost-optimized, performance)",
    "balanced",
  )
  .option(
    "--subagents <mode>",
    "Subagent execution mode (auto, on, off)",
    "auto",
  )
  .action(async (options) => {
    // Override Jira env vars if passed directly as CLI flags
    if (options.jiraHost) process.env.JIRA_HOST = options.jiraHost;
    if (options.jiraToken) process.env.JIRA_API_TOKEN = options.jiraToken;
    if (options.jiraEmail) process.env.JIRA_EMAIL = options.jiraEmail;

    // Resolve additional context file if specified
    const contextFilePath = options.additionalContext || options.context;
    let additionalContextContent: string | undefined;

    if (contextFilePath) {
      const fullContextPath = path.resolve(process.cwd(), contextFilePath);
      if (!fs.existsSync(fullContextPath)) {
        console.error(
          chalk.red(
            `❌ Error: Additional context file not found at: ${fullContextPath}`,
          ),
        );
        process.exit(1);
      }
      additionalContextContent = fs.readFileSync(fullContextPath, "utf-8");
    }

    // Determine task source and issueId
    let taskSource: "github" | "jira" | "file";
    let issueId: string | number | undefined;

    if (options.jira) {
      taskSource = "jira";
      issueId = options.jira;
    } else if (options.mode === "jira") {
      taskSource = "jira";
      issueId = options.issueId || options.issue;
      if (!issueId) {
        console.error(
          chalk.red(
            "❌ Error: Jira mode requires an issue ID (-j <key> or --issue-id <key>).",
          ),
        );
        process.exit(1);
      }
    } else if (options.file) {
      taskSource = "file";
    } else if (options.mode === "file") {
      taskSource = "file";
      if (!options.file) {
        console.error(
          chalk.red("❌ Error: File mode requires a file path (-f <path>)."),
        );
        process.exit(1);
      }
    } else if (options.issue) {
      taskSource = "github";
      issueId = options.issue;
    } else if (options.mode === "github") {
      taskSource = "github";
      issueId = options.issueId;
      if (!issueId) {
        console.error(
          chalk.red(
            "❌ Error: GitHub mode requires an issue ID (-i <number> or --issue-id <number>).",
          ),
        );
        process.exit(1);
      }
    } else if (options.issueId) {
      // Auto-detect based on issue-id format or environment
      if (
        typeof options.issueId === "string" &&
        /[a-zA-Z]/.test(options.issueId)
      ) {
        taskSource = "jira";
        issueId = options.issueId;
      } else if (process.env.JIRA_HOST && !process.env.GITHUB_REPO) {
        taskSource = "jira";
        issueId = options.issueId;
      } else {
        taskSource = "github";
        issueId = parseInt(options.issueId, 10);
      }
    } else {
      console.error(
        chalk.red(
          "❌ Error: Please specify a task source:\n" +
            "   - Jira Issue:   -j <issueKey> (e.g. -j PROJ-123) or --mode jira --issue-id <key>\n" +
            "   - GitHub Issue: -i <number> (e.g. -i 42)\n" +
            "   - Local File:   -f <path> (e.g. -f docs/task.md)",
        ),
      );
      process.exit(1);
    }

    const config = resolveConfig({
      maxRetries: options.maxRetries,
      tokenMode: options.tokenMode,
      enableSubagents: options.subagents,
    });

    const targetDesc =
      taskSource === "file"
        ? `Task File "${options.file}"`
        : taskSource === "jira"
          ? `Jira Issue [${issueId}]`
          : `GitHub Issue #${issueId}`;

    console.log(
      chalk.bold.cyan(`🚀 Starting Auto-Dev Agent for ${targetDesc}...`),
    );
    console.log(
      chalk.gray(
        `   Provider: ${options.provider.toUpperCase()}${options.model ? ` | Model: ${options.model}` : ""}${options.yes ? " | Mode: Auto-Approve (-y)" : " | Mode: Interactive (HITL)"}`,
      ),
    );
    console.log(
      chalk.gray(
        `   Config: TaskSource=${taskSource.toUpperCase()} | TokenMode=${config.tokenMode.toUpperCase()} | MaxRetries=${config.maxRetries}`,
      ),
    );
    if (contextFilePath) {
      console.log(
        chalk.gray(
          `   Context: Loaded "${contextFilePath}" (${additionalContextContent?.length || 0} chars)`,
        ),
      );
    }

    try {
      await agentApp.invoke({
        issueId,
        taskSource,
        taskFilePath: options.file,
        additionalContextFile: contextFilePath,
        additionalContext: additionalContextContent,
        issueTitle: "",
        issueBody: "",
        provider: options.provider,
        model: options.model,
        apiKey: options.apiKey,
        autoApprove: options.yes || false,
        config,
        testPassed: false,
        retryCount: 0,
      });
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`));
    }
  });

program.parse(process.argv);
