export type TokenMode = 'balanced' | 'cost-optimized' | 'performance';
export type SubagentMode = 'auto' | 'on' | 'off';

export interface AgentConfig {
  maxRetries: number;
  tokenMode: TokenMode;
  enableSubagents: SubagentMode;
  maxDiffLength: number;
  gitNexusCacheTtlMs: number;
}

export const DEFAULT_CONFIG: AgentConfig = {
  maxRetries: 2,
  tokenMode: 'balanced',
  enableSubagents: 'auto',
  maxDiffLength: 6000,
  gitNexusCacheTtlMs: 10 * 60 * 1000, // 10 minutes cache
};

export function resolveConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  const config = { ...DEFAULT_CONFIG, ...overrides };

  // Adjust limits based on tokenMode
  if (config.tokenMode === 'cost-optimized') {
    config.maxDiffLength = 3000;
    config.maxRetries = Math.min(config.maxRetries, 2);
  } else if (config.tokenMode === 'performance') {
    config.maxDiffLength = 12000;
  }

  return config;
}
