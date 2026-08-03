export interface ProjectProfile {
  language: string;
  testCommand: string;
  packageManager: string;
}

export interface AgentState {
  issueId: number;
  issueTitle: string;
  issueBody: string;
  profile?: ProjectProfile;
  plan?: string;
  testPassed: boolean;
  retryCount: number;
}