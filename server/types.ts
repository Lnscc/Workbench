export type CodexSection = {
  id: string;
  name: string;
  appearance?: { color?: string | null; icon?: string | null } | null;
};

export type CodexProject = {
  id: string;
  name: string;
  rootPaths: string[];
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
