import { StateGraph, END } from '@langchain/langgraph';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { execa } from 'execa';
import readline from 'readline';
import chalk from 'chalk';
import { AgentState } from './types.js';
import { detectProjectProfile } from './profiler.js';
import { allAgentTools, getGitHubIssue, createPullRequestTool } from './tools/index.js';
import { getLlm } from './llm.js';

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => rl.question(query, (ans) => {
    rl.close();
    resolve(ans.trim());
  }));
}

// 1. NODE: Fetch Issue từ GitHub API
async function fetchIssueNode(state: AgentState): Promise<Partial<AgentState>> {
  console.log(`\n📥 [1/4] Fetching Issue #${state.issueId}...`);
  
  const issue = await getGitHubIssue(state.issueId);
  const profile = detectProjectProfile();

  console.log(`🔎 Detected Stack: ${profile.language.toUpperCase()} | Test Cmd: "${profile.testCommand}"`);

  return {
    issueTitle: issue.title,
    issueBody: issue.body,
    profile,
    retryCount: 0,
  };
}

// 2. NODE: Lập kế hoạch tổng quan
async function planNode(state: AgentState): Promise<Partial<AgentState>> {
  console.log('\n🧠 [2/4] Analyzing codebase & Planning...');
  const llm = getLlm({ provider: state.provider, model: state.model, apiKey: state.apiKey });
  
  let prompt = `
  You are an expert software engineer working on a ${state.profile?.language} codebase.
  
  Issue #${state.issueId}: ${state.issueTitle}
  Description:
  ${state.issueBody}
  `;

  if (state.additionalContext) {
    prompt += `\n\nUSER ADDITIONAL CONTEXT / FEEDBACK:\n${state.additionalContext}`;
  }

  prompt += `\n\nProvide a concise strategy to locate the buggy code, modify it, write/update tests, and verify using "${state.profile?.testCommand}".`;

  const res = await llm.invoke(prompt);
  const plan = res.content as string;

  console.log(chalk.bold.yellow(`\n📋 PROPOSED FIX STRATEGY:\n`));
  console.log(plan);
  console.log('\n' + '─'.repeat(50));

  return { plan };
}

// 2.5 NODE: Review Plan (Human-In-The-Loop)
async function reviewPlanNode(state: AgentState): Promise<Partial<AgentState>> {
  if (state.autoApprove) {
    console.log(chalk.green('⚡ Auto-approving strategy (-y flag detected)...'));
    return { planApproved: true };
  }

  console.log(chalk.bold.cyan('\n❓ Human-in-the-Loop Review Required:'));
  console.log('  [Y]es / Enter : Approve plan and start code execution');
  console.log('  [C]ontext     : Add additional context / notes to refine plan');
  console.log('  [N]o          : Abort execution');

  const ans = await askQuestion(chalk.bold.yellow('\nChoose option [Y/c/n]: '));
  const choice = ans.toLowerCase();

  if (choice === 'c') {
    const extraContext = await askQuestion(chalk.cyan('Enter additional context / notes for AI: '));
    const combinedContext = state.additionalContext
      ? `${state.additionalContext}\n${extraContext}`
      : extraContext;
    console.log(chalk.magenta('🔄 Re-generating plan with new context...'));
    return { planApproved: false, additionalContext: combinedContext };
  }

  if (choice === 'n') {
    console.log(chalk.red('💥 Plan rejected by user. Aborting execution.'));
    process.exit(0);
  }

  console.log(chalk.green('✅ Plan approved! Proceeding to execution...'));
  return { planApproved: true };
}

// 3. NODE: ReAct Loop - Thực thi sửa code & Chạy Test
async function executeAndTestNode(state: AgentState): Promise<Partial<AgentState>> {
  console.log('\n🛠️ [3/4] Running Agent to edit code & verify tests...');
  const provider = (state.provider || process.env.LLM_PROVIDER || '').toLowerCase();
  const testCmd = state.profile?.testCommand || 'npm test';

  const prompt = `
  You are fixing Issue #${state.issueId}: "${state.issueTitle}".
  Description: ${state.issueBody}
  ${state.additionalContext ? `Additional User Guidance: ${state.additionalContext}` : ''}

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
    if (['antigravity', 'antigravity-cli', 'gemini-cli', 'agy'].includes(provider)) {
      console.log(chalk.blue('🤖 Executing via Antigravity CLI (agy) in local workspace with edit mode...'));
      const cwd = process.cwd();
      await execa('agy', [
        '--mode', 'accept-edits',
        '--dangerously-skip-permissions',
        '--add-dir', cwd,
        '-p', prompt
      ], {
        cwd,
        stdio: 'inherit',
        env: process.env,
      });
    } else {
      const llm = getLlm({ provider: state.provider, model: state.model, apiKey: state.apiKey });
      const reactAgent = createReactAgent({
        llm,
        tools: allAgentTools,
      });
      await reactAgent.invoke({
        messages: [{ role: 'user', content: prompt }],
      });
    }

    // Kiểm tra lại bằng lệnh test local chính thức
    console.log(`\n🧪 Verifying test suite execution: "${testCmd}"...`);
    const [cmd = 'npm', ...args] = testCmd.trim().split(/\s+/);

    await execa(cmd, args, { stdio: 'inherit' });

    console.log('✅ Local Tests Passed Successfully!');
    return { testPassed: true };

  } catch (error: any) {
    console.log(`❌ Test or Execution Failed on attempt ${state.retryCount + 1}: ${error.message}`);
    return {
      testPassed: false,
      retryCount: state.retryCount + 1,
    };
  }
}

// 4. NODE: Review PR (Human-In-The-Loop)
async function reviewPRNode(state: AgentState): Promise<Partial<AgentState>> {
  if (state.autoApprove) {
    console.log(chalk.green('⚡ Auto-approving PR creation (-y flag detected)...'));
    return { prApproved: true };
  }

  console.log(chalk.bold.cyan('\n❓ Human-in-the-Loop Review: Create Pull Request?'));
  const ans = await askQuestion(chalk.bold.yellow('Create Pull Request on GitHub? [Y/n]: '));

  if (ans.toLowerCase() === 'n') {
    console.log(chalk.yellow('⏩ Skipped Pull Request creation by user. Fix is saved locally.'));
    return { prApproved: false };
  }

  return { prApproved: true };
}

// 5. NODE: Git Commit, Push & Create PR
async function createPRNode(state: AgentState): Promise<Partial<AgentState>> {
  if (state.prApproved === false) {
    return {};
  }

  console.log('\n🚀 [4/4] Creating Git Branch & Pull Request...');
  const branchName = `fix/issue-${state.issueId}`;

  try {
    // Thao tác Git ở local (dùng -B để xử lý trường hợp branch đã tồn tại)
    await execa('git', ['checkout', '-B', branchName]);
    await execa('git', ['add', '.']);

    // Kiểm tra xem có thay đổi mới để commit không
    const { stdout: status } = await execa('git', ['status', '--porcelain']);
    if (status.trim()) {
      await execa('git', ['commit', '-m', `fix: resolve issue #${state.issueId}`]);
    } else {
      console.log(chalk.gray('ℹ️ Working tree clean, skipping git commit.'));
    }

    await execa('git', ['push', '-u', 'origin', branchName]);

    // Gọi tool tạo PR trên GitHub
    const prResult = await createPullRequestTool.invoke({
      branchName,
      title: `Fix #${state.issueId}: ${state.issueTitle}`,
      body: `Auto-generated fix for Issue #${state.issueId} by AI Agent.\n\n### Plan:\n${state.plan}`,
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
    provider: null,
    model: null,
    apiKey: null,
    autoApprove: null,
    additionalContext: null,
    planApproved: null,
    prApproved: null,
    profile: null,
    plan: null,
    testPassed: null,
    retryCount: null,
  },
})
  .addNode('fetchIssue', fetchIssueNode)
  .addNode('generatePlan', planNode)
  .addNode('reviewPlan', reviewPlanNode)
  .addNode('executeAndTest', executeAndTestNode)
  .addNode('reviewPR', reviewPRNode)
  .addNode('createPR', createPRNode)
  .addEdge('fetchIssue', 'generatePlan')
  .addEdge('generatePlan', 'reviewPlan')
  .addConditionalEdges('reviewPlan', (state) => {
    if (state.planApproved) {
      return 'executeAndTest';
    }
    return 'generatePlan';
  })
  .addConditionalEdges('executeAndTest', (state) => {
    if (state.testPassed) {
      return 'reviewPR';
    }
    if (state.retryCount >= 3) {
      console.log('💥 Max retries reached (3 attempts). Aborting.');
      return END;
    }
    console.log('🔄 Retrying fix flow...');
    return 'executeAndTest';
  })
  .addEdge('reviewPR', 'createPR')
  .addEdge('createPR', END);

workflow.setEntryPoint('fetchIssue');

export const agentApp = workflow.compile();