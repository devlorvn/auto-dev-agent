import { StateGraph, END } from '@langchain/langgraph';
import { ChatAnthropic } from '@langchain/anthropic';
import { Octokit } from '@octokit/rest';
import { execa } from 'execa';
import { AgentState } from './types';
import { detectProjectProfile } from './profiler';

function getOctokit() {
  return new Octokit({ auth: process.env.GITHUB_TOKEN });
}

function getLlm() {
  return new ChatAnthropic({
    model: 'claude-3-5-sonnet-20241022',
    temperature: 0,
  });
}

// 1. Node Fetch Issue
async function fetchIssueNode(state: AgentState): Promise<Partial<AgentState>> {
  console.log(`\n📥 Fetching Issue #${state.issueId}...`);
  const [owner = '', repo = ''] = (process.env.GITHUB_REPO || '').split('/');
  
  const { data: issue } = await getOctokit().issues.get({ owner, repo, issue_number: state.issueId });
  const profile = detectProjectProfile();
  
  console.log(`🔎 Detected Stack: ${profile.language.toUpperCase()} | Test Cmd: "${profile.testCommand}"`);
  
  return {
    issueTitle: issue.title,
    issueBody: issue.body || '',
    profile,
    retryCount: 0,
  };
}

// 2. Node Planning
async function planNode(state: AgentState): Promise<Partial<AgentState>> {
  console.log('🧠 Analyzing & Planning...');
  const prompt = `
  You are an expert developer working on a ${state.profile?.language} project.
  Task: Fix Issue #${state.issueId} - ${state.issueTitle}
  Description: ${state.issueBody}
  
  Provide a concise step-by-step fix plan.
  `;
  
  const res = await getLlm().invoke(prompt);
  return { plan: res.content as string };
}

// 3. Node Execute & Test
async function executeAndTestNode(state: AgentState): Promise<Partial<AgentState>> {
  console.log('🛠️ Editing code & Running local tests...');
  
  // TODO: Tích hợp ReAct Tool Calling để sửa file ở đây
  
  try {
    const testCmd = state.profile?.testCommand || 'npm test';
    const [cmd = '', ...args] = testCmd.split(' ');
    await execa(cmd, args, { stdio: 'inherit' });
    
    console.log('✅ Local Tests Passed!');
    return { testPassed: true };
  } catch (error) {
    console.log('❌ Tests Failed!');
    return { 
      testPassed: false, 
      retryCount: state.retryCount + 1 
    };
  }
}

// 4. Node Create PR
async function createPRNode(state: AgentState): Promise<Partial<AgentState>> {
  console.log('🚀 Creating Git Branch & Pull Request...');
  const branchName = `fix/issue-${state.issueId}`;
  
  await execa('git', ['checkout', '-b', branchName]);
  await execa('git', ['add', '.']);
  await execa('git', ['commit', '-m', `fix: resolve issue #${state.issueId}`]);
  await execa('git', ['push', '-u', 'origin', branchName]);

  const [owner = '', repo = ''] = (process.env.GITHUB_REPO || '').split('/');
  const { data: pr } = await getOctokit().pulls.create({
    owner,
    repo,
    title: `Fix #${state.issueId}: ${state.issueTitle}`,
    body: `Auto-generated fix for Issue #${state.issueId}\n\n### Plan:\n${state.plan}`,
    head: branchName,
    base: 'main',
  });

  console.log(`🎉 PR Created: ${pr.html_url}`);
  return {};
}

// Dựng Graph Workflow
const workflow = new StateGraph<AgentState>({
  channels: {
    issueId: null,
    issueTitle: null,
    issueBody: null,
    profile: null,
    plan: null,
    testPassed: null,
    retryCount: null,
  }
})
  .addNode('fetchIssue', fetchIssueNode)
  .addNode('generatePlan', planNode)
  .addNode('executeAndTest', executeAndTestNode)
  .addNode('createPR', createPRNode)
  .addEdge('fetchIssue', 'generatePlan')
  .addEdge('generatePlan', 'executeAndTest')
  .addConditionalEdges('executeAndTest', (state) => {
    if (state.testPassed) return 'createPR';
    if (state.retryCount >= 3) {
      console.log('💥 Max retries reached. Stopping.');
      return END;
    }
    return 'generatePlan';
  })
  .addEdge('createPR', END);

workflow.setEntryPoint('fetchIssue');
export const agentApp = workflow.compile();