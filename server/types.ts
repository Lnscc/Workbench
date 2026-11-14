export type CodexSection = {
  id: string;
  name: string;
  appearance?: { color?: string | null; icon?: string | null } | null;
};

export type CodexProject = {
  id: string;
  name: string;
  rootPaths: string[];
  color: string | null;
  icon: string | null;
};

export type CodexThread = {
  id: string;
  name: string | null;
  preview: string;
  cwd: string;
  projectId: string | null;
  project: CodexProject | null;
  createdAt: number;
  updatedAt: number;
  recencyAt: number | null;
  status: unknown;
  path?: string | null;
  isUnread: boolean;
  isCodexWorking: boolean;
  codexInterruption: 'usage_limit' | null;
  section: CodexSection | null;
  workbenchStatus: WorkbenchStatus | null;
  workbenchStatusChangedAt: number | null;
  source: 'user' | 'agent_created';
  parentThreadId: string | null;
  children: CodexThread[];
};

export type WorkbenchStatus = 'todo' | 'progress' | 'done';

export type ThreadListResult = {
  data: CodexThread[];
  nextCursor: string | null;
};

export type SectionListResult = {
  data: CodexSection[];
  nextCursor: string | null;
};

export type RateLimitWindow = {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
};

export type RateLimitSnapshot = {
  limitId: string | null;
  limitName: string | null;
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
  credits: { hasCredits: boolean; unlimited: boolean; balance: string | null } | null;
  planType: string | null;
  rateLimitReachedType: string | null;
  spendControlReached: boolean | null;
};

export type RateLimitsResponse = {
  ordinaryUsageAllowed: boolean | null;
  rateLimits: RateLimitSnapshot;
  rateLimitsByLimitId: Record<string, RateLimitSnapshot | undefined> | null;
};
