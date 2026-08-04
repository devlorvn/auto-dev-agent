import { StateGraph, END } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { execa } from "execa";
import readline from "readline";
import chalk from "chalk";
import { AgentState } from "./types";
import { detectProjectProfile } from "./profiler";
import {
  allAgentTools,
  getGitHubIssue,
  createPullRequestTool,
  analyzeCodebaseWithGitNexus,
} from "./tools/index";
import { getLlm } from "./llm";

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    }),
  );
}

// 1. NODE: Fetch Issue từ GitHub API
async function fetchIssueNode(state: AgentState): Promise<Partial<AgentState>> {
  console.log(`\n📥 [1/4] Fetching Issue #${state.issueId}...`);

  const issue = await getGitHubIssue(state.issueId);
  const profile = detectProjectProfile();

  const labels = issue.labels || [];
  let issueType: "feat" | "fix" = "fix";

  const hasFeatLabel = labels.some((l) => /feature|enhancement|feat/i.test(l));
  const hasBugLabel = labels.some((l) => /bug|fix/i.test(l));

  if (hasFeatLabel && !hasBugLabel) {
    issueType = "feat";
  } else if (hasBugLabel) {
    issueType = "fix";
  } else {
    if (/feat|feature|add|implement/i.test(issue.title)) {
      issueType = "feat";
    }
  }

  console.log(
    `🔎 Detected Stack: ${profile.language.toUpperCase()} | Test Cmd: "${profile.testCommand}"`,
  );
  console.log(
    `🏷️  Issue Labels: [${labels.join(", ")}] | Determined Type: ${issueType.toUpperCase()}`,
  );

  return {
    issueTitle: issue.title,
    issueBody: issue.body,
    labels,
    issueType,
    profile,
    retryCount: 0,
  };
}

// 1.5 NODE: Phân tích tri thức Codebase qua GitNexus AST & Dependency Graph
async function gitnexusAnalyzeNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const codeGraphContext = await analyzeCodebaseWithGitNexus(
    state.issueTitle,
    state.issueBody,
    state.config?.gitNexusCacheTtlMs,
  );
  return { codeGraphContext };
}

// 2. NODE: Lập kế hoạch tổng quan
async function planNode(state: AgentState): Promise<Partial<AgentState>> {
  console.log("\n🧠 [2/4] Analyzing codebase & Planning...");
  const llm = getLlm({
    provider: state.provider,
    model: state.model,
    apiKey: state.apiKey,
  });

  let prompt = `
  You are an expert software engineer working on a ${state.profile?.language} codebase.
  
  Issue #${state.issueId}: ${state.issueTitle}
  Description:
  ${state.issueBody}
  `;

  if (state.codeGraphContext?.isAvailable) {
    prompt += `\n\nGITNEXUS CODEBASE GRAPH & BLAST RADIUS ANALYSIS:\n`;
    if (state.codeGraphContext.affectedFiles.length > 0) {
      prompt += `- High-Risk / Impacted Files: ${state.codeGraphContext.affectedFiles.join(", ")}\n`;
    }
    if (state.codeGraphContext.callChains.length > 0) {
      prompt += `- Call Chains & Dependencies: ${state.codeGraphContext.callChains.join(" -> ")}\n`;
    }
    prompt += `- Blast Radius Summary: ${state.codeGraphContext.blastRadiusSummary}\n`;
  }

  if (state.additionalContext) {
    prompt += `\n\nUSER ADDITIONAL CONTEXT / FEEDBACK:\n${state.additionalContext}`;
  }

  prompt += `\n\nProvide a concise strategy to locate the buggy code, modify it, write/update tests, and verify using "${state.profile?.testCommand}".`;

  const res = await llm.invoke(prompt);
  const plan = res.content as string;

  console.log(chalk.bold.yellow(`\n📋 PROPOSED FIX STRATEGY:\n`));
  console.log(plan);
  console.log("\n" + "─".repeat(50));

  return { plan };
}

// 2.5 NODE: Review Plan (Human-In-The-Loop)
async function reviewPlanNode(state: AgentState): Promise<Partial<AgentState>> {
  if (state.autoApprove) {
    console.log(
      chalk.green("⚡ Auto-approving strategy (-y flag detected)..."),
    );
    return { planApproved: true };
  }

  console.log(chalk.bold.cyan("\n❓ Human-in-the-Loop Review Required:"));
  console.log("  [Y]es / Enter : Approve plan and start code execution");
  console.log(
    "  [C]ontext     : Add additional context / notes to refine plan",
  );
  console.log("  [N]o          : Abort execution");

  const ans = await askQuestion(chalk.bold.yellow("\nChoose option [Y/c/n]: "));
  const choice = ans.toLowerCase();

  if (choice === "c") {
    const extraContext = await askQuestion(
      chalk.cyan("Enter additional context / notes for AI: "),
    );
    const combinedContext = state.additionalContext
      ? `${state.additionalContext}\n${extraContext}`
      : extraContext;
    console.log(chalk.magenta("🔄 Re-generating plan with new context..."));
    return { planApproved: false, additionalContext: combinedContext };
  }

  if (choice === "n") {
    console.log(chalk.red("💥 Plan rejected by user. Aborting execution."));
    process.exit(0);
  }

  console.log(chalk.green("✅ Plan approved! Proceeding to execution..."));
  return { planApproved: true };
}

// 3. NODE: ReAct Loop - Thực thi sửa code & Chạy Test
async function executeAndTestNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  console.log("\n🛠️ [3/4] Running Agent to edit code & verify tests...");
  const provider = (
    state.provider ||
    process.env.LLM_PROVIDER ||
    ""
  ).toLowerCase();
  const testCmd = state.profile?.testCommand || "npm test";

  const prompt = `
  You are fixing Issue #${state.issueId}: "${state.issueTitle}".
  Description: ${state.issueBody}
  ${state.additionalContext ? `Additional User Guidance: ${state.additionalContext}` : ""}

  Plan:
  ${state.plan}

  PROJECT CONTEXT:
  - Language: ${state.profile?.language}
  - Test Command: ${testCmd}

  YOUR TASK:
  1. Locate the relevant source/test files in the local workspace.
  2. Create or modify files to fulfill the issue requirements and write tests.
  3. Execute the test command "${testCmd}" to verify all tests pass.

  CRITICAL:
  - You MUST modify or create the actual target files in the local workspace filesystem.
  - Keep modifying code until the test suite passes completely.
  `;

  try {
    if (
      ["antigravity", "antigravity-cli", "gemini-cli", "agy"].includes(provider)
    ) {
      console.log(
        chalk.blue(
          "🤖 Executing via Antigravity CLI (agy) in local workspace with edit mode...",
        ),
      );
      const cwd = process.cwd();
      await execa(
        "agy",
        [
          "--mode",
          "accept-edits",
          "--dangerously-skip-permissions",
          "--add-dir",
          cwd,
          "-p",
          prompt,
        ],
        {
          cwd,
          stdio: "inherit",
          env: process.env,
        },
      );
    } else {
      const llm = getLlm({
        provider: state.provider,
        model: state.model,
        apiKey: state.apiKey,
      });
      const reactAgent = createReactAgent({
        llm,
        tools: allAgentTools,
      });
      await reactAgent.invoke({
        messages: [{ role: "user", content: prompt }],
      });
    }

    // Kiểm tra lại bằng lệnh test local chính thức
    console.log(`\n🧪 Verifying test suite execution: "${testCmd}"...`);
    const [cmd = "npm", ...args] = testCmd.trim().split(/\s+/);

    await execa(cmd, args, { stdio: "inherit" });

    console.log("✅ Local Tests Passed Successfully!");
    return { testPassed: true };
  } catch (error: any) {
    console.log(
      `❌ Test or Execution Failed on attempt ${state.retryCount + 1}: ${error.message}`,
    );
    return {
      testPassed: false,
      retryCount: state.retryCount + 1,
    };
  }
}

// 3.5 NODE: Review & Summarize Code Changes
async function reviewChangesNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  console.log(
    chalk.bold.cyan("\n🔍 Reviewing Code Changes & Generating File Summary..."),
  );

  try {
    const { stdout: statusOutput } = await execa("git", ["status", "--short"]);
    const { stdout: diffStatOutput } = await execa("git", ["diff", "--stat"]);
    const { stdout: diffOutput } = await execa("git", ["diff"]);

    if (!statusOutput.trim()) {
      console.log(chalk.gray("ℹ️ No file changes detected in working tree."));
      return { changesSummary: "No file changes detected." };
    }

    console.log(chalk.bold.yellow("\n📁 CHANGED FILES (git status):"));
    console.log(statusOutput);

    console.log(chalk.bold.yellow("\n📊 DIFF STATISTICS:"));
    console.log(diffStatOutput);

    const llm = getLlm({
      provider: state.provider,
      model: state.model,
      apiKey: state.apiKey,
    });
    const prompt = `
    You are an expert code reviewer analyzing changes made for Issue #${state.issueId}: "${state.issueTitle}".
    Issue Type: ${state.issueType || "fix"}

    Original Plan:
    ${state.plan}

    File Status:
    ${statusOutput}

    Diff Statistics:
    ${diffStatOutput}

    Git Patch / Diff (truncated based on token config):
    ${diffOutput.slice(0, state.config?.maxDiffLength || 6000)}

    Provide a concise, professional summary review of the changes made:
    - List files added, modified, or deleted with key code changes in each file.
    - Highlight how the changes resolve Issue #${state.issueId} and satisfy the plan.
    `;

    const res = await llm.invoke(prompt);
    const changesSummary = res.content as string;

    console.log(chalk.bold.green("\n📝 AI CHANGES REVIEW & SUMMARY:"));
    console.log(changesSummary);
    console.log("\n" + "─".repeat(50));

    return { changesSummary };
  } catch (error: any) {
    console.log(chalk.red(`⚠️ Could not review git diff: ${error.message}`));
    return { changesSummary: "Failed to generate git changes summary." };
  }
}

// 4. NODE: Review PR (Human-In-The-Loop)
async function reviewPRNode(state: AgentState): Promise<Partial<AgentState>> {
  if (state.autoApprove) {
    console.log(
      chalk.green("⚡ Auto-approving PR creation (-y flag detected)..."),
    );
    return { prApproved: true };
  }

  console.log(
    chalk.bold.cyan("\n❓ Human-in-the-Loop Review: Create Pull Request?"),
  );
  const ans = await askQuestion(
    chalk.bold.yellow("Create Pull Request on GitHub? [Y/n]: "),
  );

  if (ans.toLowerCase() === "n") {
    console.log(
      chalk.yellow(
        "⏩ Skipped Pull Request creation by user. Fix is saved locally.",
      ),
    );
    return { prApproved: false };
  }

  return { prApproved: true };
}

// 5. NODE: Git Commit, Push & Create PR
async function createPRNode(state: AgentState): Promise<Partial<AgentState>> {
  if (state.prApproved === false) {
    return {};
  }

  console.log("\n🚀 [4/4] Creating Git Branch & Pull Request...");

  const typePrefix = state.issueType === "feat" ? "feat" : "fix";
  const branchName = `${typePrefix}/issue-${state.issueId}`;
  const commitMsg = `${typePrefix}: resolve issue #${state.issueId}`;
  const prTitle = `${typePrefix === "feat" ? "Feat" : "Fix"} #${state.issueId}: ${state.issueTitle}`;

  try {
    // Thao tác Git ở local (dùng -B để xử lý trường hợp branch đã tồn tại)
    await execa("git", ["checkout", "-B", branchName]);
    await execa("git", ["add", "."]);

    // Kiểm tra xem có thay đổi mới để commit không
    const { stdout: status } = await execa("git", ["status", "--porcelain"]);
    if (status.trim()) {
      await execa("git", ["commit", "-m", commitMsg]);
    } else {
      console.log(chalk.gray("ℹ️ Working tree clean, skipping git commit."));
    }

    await execa("git", ["push", "-u", "origin", branchName]);

    let bodyText = `Auto-generated ${typePrefix} for Issue #${state.issueId} by AI Agent.\n\n### Plan:\n${state.plan}`;
    if (state.changesSummary) {
      bodyText += `\n\n### 📝 Changes Summary:\n${state.changesSummary}`;
    }

    // Gọi tool tạo PR trên GitHub
    const prResult = await createPullRequestTool.invoke({
      branchName,
      title: prTitle,
      body: bodyText,
    });

    console.log(`🎉 ${prResult}`);
  } catch (err: any) {
    console.error(`❌ Failed to complete PR flow: ${err.message}`);
  }

  return {};
}

// --------------------------------------------------------------------------
// XÂY DỰNG VÀ BIÊN DỊCH LANGGRAPH STATE MACHINE
// --------------------------------------------------------------------------

const workflow = new StateGraph<AgentState>({
  channels: {
    issueId: null,
    issueTitle: null,
    issueBody: null,
    labels: null,
    issueType: null,
    provider: null,
    model: null,
    apiKey: null,
    autoApprove: null,
    config: null,
    additionalContext: null,
    planApproved: null,
    prApproved: null,
    profile: null,
    codeGraphContext: null,
    plan: null,
    testPassed: null,
    retryCount: null,
    changesSummary: null,
  },
})
  .addNode("fetchIssue", fetchIssueNode)
  .addNode("gitnexusAnalyze", gitnexusAnalyzeNode)
  .addNode("generatePlan", planNode)
  .addNode("reviewPlan", reviewPlanNode)
  .addNode("executeAndTest", executeAndTestNode)
  .addNode("reviewChanges", reviewChangesNode)
  .addNode("reviewPR", reviewPRNode)
  .addNode("createPR", createPRNode)
  .addEdge("fetchIssue", "gitnexusAnalyze")
  .addEdge("gitnexusAnalyze", "generatePlan")
  .addEdge("generatePlan", "reviewPlan")
  .addConditionalEdges("reviewPlan", (state) => {
    if (state.planApproved) {
      return "executeAndTest";
    }
    return "generatePlan";
  })
  .addConditionalEdges("executeAndTest", (state) => {
    if (state.testPassed) {
      return "reviewChanges";
    }
    const maxRetries = state.config?.maxRetries ?? 2;
    if (state.retryCount >= maxRetries) {
      console.log(
        `💥 Max retries reached (${maxRetries} attempts). Aborting execution.`,
      );
      return END;
    }
    console.log("🔄 Retrying fix flow...");
    return "executeAndTest";
  })
  .addEdge("reviewChanges", "reviewPR")
  .addEdge("reviewPR", "createPR")
  .addEdge("createPR", END);

workflow.setEntryPoint("fetchIssue");

export const agentApp = workflow.compile();
