import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { Octokit } from '@octokit/rest';

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

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
  const { data: issue } = await octokit.issues.get({
    owner,
    repo,
    issue_number: issueId,
  });
  return {
    title: issue.title,
    body: issue.body || '',
  };
}

// Tool Tạo Pull Request
export const createPullRequestTool = tool(
  async ({ branchName, title, body, base = 'main' }) => {
    try {
      const { owner, repo } = getRepoInfo();
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