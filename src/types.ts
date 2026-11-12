export type Section = {
  id: string;
  name: string;
};

export type WorkbenchStatus = 'todo' | 'progress' | 'done';

export type Thread = {
  id: string;
  name: string | null;
  preview: string;
  cwd: string;
  projectId: string | null;
  createdAt: number;
  updatedAt: number;
  recencyAt: number | null;
  status: unknown;
  section: Section | null;
  workbenchStatus: WorkbenchStatus | null;
};

export type ThreadListResponse = {
  data: Thread[];
  nextCursor: string | null;
};
