#!/usr/bin/env node
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
    "Run agent on a specific GitHub issue or local Markdown task file",
  )
  .option("-i, --issue <number>", "GitHub Issue ID", parseInt)
  .option("-f, --file <path>", "Path to local task Markdown file (.md)")
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
    if (!options.issue && !options.file) {
      console.error(
        chalk.red(
          "❌ Error: Please specify either a GitHub Issue ID (-i <number>) or a local Markdown task file (-f <path>).",
        ),
      );
      process.exit(1);
    }

    const config = resolveConfig({
      maxRetries: options.maxRetries,
      tokenMode: options.tokenMode,
      enableSubagents: options.subagents,
    });

    const taskSource = options.file ? "file" : "github";
    const targetDesc = options.file
      ? `Task File "${options.file}"`
      : `Issue #${options.issue}`;

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

    try {
      await agentApp.invoke({
        issueId: options.issue,
        taskSource,
        taskFilePath: options.file,
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
