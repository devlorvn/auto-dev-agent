import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { Octokit } from '@octokit/rest';

import { execaSync } from 'execa';

let cachedToken: string | undefined;

export function getGitHubToken(): string {
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }
  if (cachedToken) {
    return cachedToken;
  }
  try {
    const { stdout } = execaSync('gh', ['auth', 'token']);
    if (stdout && stdout.trim()) {
      cachedToken = stdout.trim();
      return cachedToken;
    }
  } catch {
    // CLI fallback fail silently
  }
  return '';
}

function getOctokit() {
  const token = getGitHubToken();
  return new Octokit(token ? { auth: token } : {});
}

// Utility lấy owner/repo từ env
function getRepoInfo() {
  const repoEnv = process.env.GITHUB_REPO || '';
  const [owner, repo] = repoEnv.split('/');
  if (!owner || !repo) {
    throw new Error('GITHUB_REPO environment variable must be set in "owner/repo" format.');
  }
  return { owner, repo };
}

// Fetch thông tin Issue
export async function getGitHubIssue(issueId: number) {
  const { owner, repo } = getRepoInfo();
  const octokit = getOctokit();
  const { data: issue } = await octokit.issues.get({
    owner,
    repo,
    issue_number: issueId,
  });
  const labels = (issue.labels || [])
    .map((l: any) => (typeof l === 'string' ? l : l.name || ''))
    .filter(Boolean);

  return {
    title: issue.title,
    body: issue.body || '',
    labels,
  };
}

// Tool Tạo Pull Request
export const createPullRequestTool = tool(
  async ({ branchName, title, body, base = 'main' }) => {
    try {
      const { owner, repo } = getRepoInfo();
      const octokit = getOctokit();
      const { data: pr } = await octokit.pulls.create({
        owner,
        repo,
        title,
        body,
        head: branchName,
        base,
      });
      return `Pull Request created successfully: ${pr.html_url}`;
    } catch (error: any) {
      return `Failed to create Pull Request: ${error.message}`;
    }
  },
  {
    name: 'create_pull_request',
    description: 'Create a new GitHub Pull Request from head branch to base branch.',
    schema: z.object({
      branchName: z.string().describe('Head branch containing your changes'),
      title: z.string().describe('PR Title'),
      body: z.string().describe('PR Description'),
      base: z.string().optional().default('main').describe('Target base branch'),
    }),
  }
);