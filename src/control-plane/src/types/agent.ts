/**
 * Agent type definitions for Outpost worker fleet
 */

export type AgentType = 'claude' | 'codex' | 'gemini' | 'aider' | 'grok';

export interface AgentConfig {
  readonly type: AgentType;
  readonly modelId: string;
  readonly dispatchScript: string;
  readonly maxConcurrent: number;
  readonly timeoutSeconds: number;
}

export interface AgentStatus {
  readonly type: AgentType;
  readonly available: boolean;
  readonly activeJobs: number;
  readonly lastHealthCheck: Date;
  readonly errorRate: number;
}

export interface WorkerInstance {
  readonly instanceId: string;
  readonly agentType: AgentType;
  readonly taskArn: string;
  readonly status: WorkerStatus;
  readonly startedAt: Date;
  readonly lastActivityAt: Date;
  readonly currentJobId: string | null;
}

export type WorkerStatus = 'starting' | 'idle' | 'busy' | 'stopping' | 'stopped' | 'error';

export const AGENT_CONFIGS: Readonly<Record<AgentType, AgentConfig>> = {
  claude: {
    type: 'claude',
    modelId: 'claude-opus-4-5-20251101',
    dispatchScript: 'dispatch.sh',
    maxConcurrent: 5,
    timeoutSeconds: 3600,
  },
  codex: {
    type: 'codex',
    modelId: 'gpt-5.2-codex',
    dispatchScript: 'dispatch-codex.sh',
    maxConcurrent: 5,
    timeoutSeconds: 3600,
  },
  gemini: {
    type: 'gemini',
    modelId: 'gemini-3-pro-preview',
    dispatchScript: 'dispatch-gemini.sh',
    maxConcurrent: 5,
    timeoutSeconds: 3600,
  },
  aider: {
    type: 'aider',
    modelId: 'deepseek/deepseek-coder',
    dispatchScript: 'dispatch-aider.sh',
    maxConcurrent: 3,
    timeoutSeconds: 3600,
  },
  grok: {
    type: 'grok',
    modelId: 'grok-4.1',
    dispatchScript: 'dispatch-grok.sh',
    maxConcurrent: 5,
    timeoutSeconds: 3600,
  },
} as const;
