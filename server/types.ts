export type CodexSection = {
  id: string;
  name: string;
  appearance?: { color?: string | null; icon?: string | null } | null;
};

export type CodexThread = {
  id: string;
  name: string | null;
  preview: string;
  cwd: string;
  projectId: string | null;
  createdAt: number;
  updatedAt: number;
  recencyAt: number | null;
  status: unknown;
  section: CodexSection | null;
};

export type ThreadListResult = {
  data: CodexThread[];
  nextCursor: string | null;
};

export type SectionListResult = {
  data: CodexSection[];
  nextCursor: string | null;
};
