export type Section = {
  id: string;
  name: string;
};

export type WorkbenchStatus = 'todo' | 'progress' | 'done';

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
  section: Section | null;
  workbenchStatus: WorkbenchStatus | null;
};

export type ProjectListResponse = { data: Project[] };

export type ThreadListResponse = {
  data: Thread[];
  nextCursor: string | null;
};
