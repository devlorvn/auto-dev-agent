import { AgentConfig } from "./config";

export interface ProjectProfile {
  language: string;
  testCommand: string;
  packageManager: string;
}

export interface CodeGraphContext {
  affectedFiles: string[];
  callChains: string[];
  blastRadiusSummary: string;
  isAvailable: boolean;
}

export interface AgentState {
  issueId: number;
  issueTitle: string;
  issueBody: string;
  labels?: string[];
  issueType?: "feat" | "fix";
  provider?: string;
  model?: string;
  apiKey?: string;
  autoApprove?: boolean;
  config?: AgentConfig;
  additionalContext?: string;
  planApproved?: boolean;
  prApproved?: boolean;
  profile?: ProjectProfile;
  codeGraphContext?: CodeGraphContext;
  plan?: string;
  testPassed: boolean;
  retryCount: number;
  changesSummary?: string;
}
