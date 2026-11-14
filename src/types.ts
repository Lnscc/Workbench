export type Section = {
  id: string;
  name: string;
};

export type WorkbenchStatus = 'todo' | 'progress' | 'done';

export type RateLimitWindow = { usedPercent: number; windowDurationMins: number | null; resetsAt: number | null };
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

export type Project = {
  id: string;
  name: string;
  rootPaths: string[];
};

export type Thread = {
  id: string;
  name: string | null;
  preview: string;
  cwd: string;
  projectId: string | null;
  project: Project | null;
  createdAt: number;
  updatedAt: number;
  recencyAt: number | null;
  status: unknown;
  isUnread: boolean;
  isCodexWorking: boolean;
  codexInterruption: 'usage_limit' | null;
  section: Section | null;
  workbenchStatus: WorkbenchStatus | null;
  workbenchStatusChangedAt: number | null;
  source: 'user' | 'agent_created';
  parentThreadId: string | null;
  children: Thread[];
};

export type ProjectListResponse = { data: Project[] };

export type ThreadListResponse = {
  data: Thread[];
  nextCursor: string | null;
};
