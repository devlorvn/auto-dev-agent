export interface ProjectProfile {
  language: string;
  testCommand: string;
  packageManager: string;
}

export interface AgentState {
  issueId: number;
  issueTitle: string;
  issueBody: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  autoApprove?: boolean;
  additionalContext?: string;
  planApproved?: boolean;
  prApproved?: boolean;
  profile?: ProjectProfile;
  plan?: string;
  testPassed: boolean;
  retryCount: number;
}