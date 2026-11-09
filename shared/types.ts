export type ViewName = 'generate' | 'verify' | 'idea' | 'settings';

export interface TechItem {
  name: string;
  role: string;
}

export interface BuildPlan {
  weeks: number;
  difficulty: 'low' | 'medium' | 'high';
  mvpScope: string;
}

export interface Viability {
  score: number;
  notes: string;
}

export interface ExistingProjectNote {
  name: string;
  note: string;
}

export interface IdeaDraft {
  title: string;
  oneLiner: string;
  description: string;
  techStack: TechItem[];
  targetUser: string;
  coreFeatures: string[];
  whyUnique: string;
  risks: string[];
  build: BuildPlan;
  viability: Viability;
  knownProjects: ExistingProjectNote[];
}

export type FindingSource = 'github' | 'web' | 'hn';
export type Completeness = 'production' | 'beta' | 'prototype' | 'abandoned' | 'unknown';
export type UsageLevel = 'major' | 'notable' | 'niche' | 'low' | 'unknown';
export type Similarity = 'direct' | 'adjacent' | 'loose';
export type VerdictLevel = 'open' | 'differentiated' | 'crowded';

export interface Finding {
  id: string;
  ref: number;
  name: string;
  url: string;
  source: FindingSource;
  description: string;
  snippet?: string;
  stars?: number;
  forks?: number;
  points?: number;
  comments?: number;
  lastPush?: string;
  createdAt?: string;
  owner?: string;
  orgBacked?: boolean;
  archived?: boolean;
  language?: string;
  completeness: Completeness;
  usage: UsageLevel;
  similarity: Similarity;
  note: string;
  readme?: string;
}

export interface Verdict {
  level: VerdictLevel;
  summary: string;
  gaps: string[];
  angles: string[];
}

export interface ResearchReport {
  createdAt: number;
  model: string;
  queries: string[];
  findings: Finding[];
  verdict: Verdict;
  notices: string[];
  assessed: boolean;
  cacheHits?: number;
  githubQueries?: number;
}

export interface Idea {
  id: string;
  kind: 'generated' | 'verified';
  title: string;
  oneLiner: string;
  description: string;
  techStack: TechItem[];
  targetUser?: string;
  coreFeatures?: string[];
  whyUnique?: string;
  risks?: string[];
  build?: BuildPlan;
  viability?: Viability;
  knownProjects?: ExistingProjectNote[];
  report?: ResearchReport;
  folderId: string | null;
  model?: string;
  promptId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Folder {
  id: string;
  name: string;
  collapsed: boolean;
}

export interface SavedPrompt {
  id: string;
  themes: string;
  goals: string;
  stack: string;
  count: number;
  runs: number;
  createdAt: number;
  lastRunAt: number;
}

export interface Settings {
  model: string;
  host: string;
}

export interface UiState {
  view: ViewName;
  ideaId: string | null;
}

export interface AppState {
  version: number;
  settings: Settings;
  folders: Folder[];
  ideas: Idea[];
  prompts: SavedPrompt[];
  ui: UiState;
}

export interface GitHubAuthStatus {
  connected: boolean;
  login?: string;
  limit: number;
  queriesPerScan: number;
  remaining?: number;
  resetAt?: number;
  error?: string;
}

export interface GitHubConnectResult {
  ok: boolean;
  status: GitHubAuthStatus;
  error?: string;
}

export interface CacheInfo {
  entries: number;
  bytes: number;
}

export interface BackupResult {
  ok: boolean;
  path?: string;
  canceled?: boolean;
  error?: string;
}

export interface ImportResult {
  ok: boolean;
  state?: AppState;
  canceled?: boolean;
  error?: string;
}

export interface BootstrapPayload {
  state: AppState;
  models: string[];
  dataPath: string;
  ollamaOk: boolean;
  ollamaError?: string;
  github: GitHubAuthStatus;
  cache: CacheInfo;
}

export interface GenerateRequest {
  taskId: string;
  themes: string;
  goals: string;
  stack: string;
  count: number;
  model: string;
  host: string;
  avoid: string[];
}

export interface ResearchRequest {
  taskId: string;
  ideaId: string;
  title: string;
  description: string;
  stack: string[];
  model: string;
  host: string;
  fresh?: boolean;
}

export interface ProgressEvent {
  taskId: string;
  stage: string;
  label: string;
  received?: number;
}

export interface ModelListResult {
  ok: boolean;
  models: string[];
  error?: string;
}

export interface Api {
  bootstrap(): Promise<BootstrapPayload>;
  saveState(state: AppState): Promise<void>;
  listModels(host: string): Promise<ModelListResult>;
  generate(req: GenerateRequest): Promise<IdeaDraft[]>;
  research(req: ResearchRequest): Promise<ResearchReport>;
  connectGitHub(token: string): Promise<GitHubConnectResult>;
  disconnectGitHub(): Promise<GitHubAuthStatus>;
  refreshGitHub(): Promise<GitHubAuthStatus>;
  exportWorkspace(state: AppState): Promise<BackupResult>;
  importWorkspace(): Promise<ImportResult>;
  cacheStats(): Promise<CacheInfo>;
  clearCache(): Promise<CacheInfo>;
  openExternal(url: string): Promise<void>;
  copyText(text: string): Promise<void>;
  onProgress(cb: (p: ProgressEvent) => void): () => void;
}
