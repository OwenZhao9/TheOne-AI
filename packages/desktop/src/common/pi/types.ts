/** AionPi's desktop contract. Credentials never appear in snapshots or events. */
import type { BotBinding, BotCard, BotPreview } from './bots';
import type { ArticleCard, ArticleDocument } from './articles';
import type { PiLearningProfile } from './learning';
export type JsonRecord = Record<string, unknown>;
export type PiBlock = {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: JsonRecord;
  data?: string;
  mimeType?: string;
};
export type PiMessage = {
  id: string;
  entryId?: string;
  role: string;
  content: PiBlock[];
  timestamp?: number;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  stopReason?: string;
  errorMessage?: string;
};
export type PiModel = {
  id: string;
  provider: string;
  name?: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
};
export type PiDialog = {
  id: string;
  method: string;
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  deadline?: number;
};
export type PiView = {
  messages: PiMessage[];
  streaming: boolean;
  syncing?: boolean;
  compacting: boolean;
  model?: PiModel;
  thinkingLevel?: string;
  queue: { steering: string[]; followUp: string[] };
  dialogs: PiDialog[];
  statuses: Record<string, string>;
  widgets: Record<string, string[]>;
  error?: string;
  stats?: JsonRecord;
};
export type PiConversation = {
  bot?: BotBinding;
  managedFolder?: boolean;
  id: string;
  cwd: string;
  title: string;
  updatedAt: number;
  messageCount: number;
  running: boolean;
  pinned: boolean;
  learning?: PiLearningProfile;
};
export type PiTaskStatus = 'waiting' | 'running' | 'failed' | 'completed' | 'stopped';
export type PiTaskAcceptanceStatus = 'pending' | 'verified' | 'rejected';
export type PiTaskResumeState = 'none' | 'safe' | 'needs_confirmation';
export type PiTaskUsage = {
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
  costKnown: boolean;
};
export type PiTaskLimits = {
  maxDepth: number;
  maxTotalTasks: number;
  maxConcurrent: number;
  maxModelCalls: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxCostUsd?: number;
};
export type PiSkillCandidate = {
  name: string;
  description: string;
  source: 'local' | 'online';
  location?: string;
  sourceUrl?: string;
  downloadUrl?: string;
  license?: string;
  version?: string;
  compatibleAgents: string[];
  sha256?: string;
  trusted: boolean;
  approved: boolean;
  installed: boolean;
  compatibility: 'compatible' | 'incompatible' | 'unknown';
  reason?: string;
};
export type PiSkillCatalog = {
  registryUrl?: string;
  fetchedAt?: number;
  skills: PiSkillCandidate[];
  error?: string;
};
export type PiTaskResearchSource = {
  kind: 'example' | 'skill';
  title: string;
  url: string;
  description: string;
  license?: string;
  available?: boolean;
};
export type PiTaskResearch = {
  state: 'queued' | 'researching' | 'awaiting_approval' | 'approved' | 'failed';
  version: number;
  queries: string[];
  searchTerms?: string;
  sources: PiTaskResearchSource[];
  feedback?: string;
  proposal?: string;
  error?: string;
  approvedAt?: number;
};
export type PiTaskNode = {
  sessionId: string;
  rootSessionId: string;
  parentSessionId?: string;
  title: string;
  objective: string;
  reason: string;
  deliverables: string[];
  acceptanceCriteria: string[];
  ownedPaths: string[];
  dependencies: string[];
  candidateBot?: string;
  candidateSkills: string[];
  research?: PiTaskResearch;
  status: PiTaskStatus;
  acceptance: { status: PiTaskAcceptanceStatus; notes?: string; verifiedAt?: number };
  usage: PiTaskUsage;
  depth: number;
  revision: number;
  contextVersion: string;
  dependencyRevisions: Record<string, number>;
  createdAt: number;
  updatedAt: number;
  stopRequested?: boolean;
  resumeState?: PiTaskResumeState;
  userModifiedAt?: number;
  needsRevalidation?: boolean;
  result?: string;
  error?: string;
};
export type PiTaskTree = {
  version: 1;
  limits: PiTaskLimits;
  nodes: PiTaskNode[];
};
export type PiDispatchTask = {
  title: string;
  objective: string;
  reason: string;
  deliverables: string[];
  acceptanceCriteria: string[];
  ownedPaths: string[];
  dependencies?: string[];
  candidateBot?: string;
  candidateSkills?: string[];
};
export type PiDispatchDecision = {
  provider: string;
  model: string;
  probability: number;
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number; costKnown: boolean };
};
export type PiDispatchRequest = {
  goal: string;
  tasks: PiDispatchTask[];
  decision: PiDispatchDecision;
};
export type PiDispatchResult = {
  rootSessionId: string;
  childSessionIds: string[];
};
export type PiSnapshot = {
  conversation: PiConversation;
  seq: number;
  view: PiView;
  phase: 'idle' | 'starting' | 'ready' | 'error';
};
export type PiEvent =
  | { kind: 'record'; id: string; seq: number; record: JsonRecord }
  | { kind: 'snapshot'; snapshot: PiSnapshot }
  | { kind: 'changed' }
  | { kind: 'attention'; id: string; reason: 'finished' | 'error' | 'question' }
  | { kind: 'navigate'; id: string }
  | { kind: 'auth'; event: JsonRecord };
export type PiAttachment = { path?: string; name: string; mimeType?: string; data?: string };
export type PiSettings = {
  provider?: string;
  model?: string;
  thinkingLevel?: string;
  notifications: boolean;
  jevProvider?: string;
  jevModel?: string;
  skillRegistryUrl?: string;
};
export type PiProvider = {
  id: string;
  name: string;
  apiKey: boolean;
  oauth: boolean;
  configured: boolean;
  authType?: 'api_key' | 'oauth';
  modelSource?: 'account' | 'catalog';
  modelError?: string;
};
export type PiCatalog = { providers: PiProvider[]; models: PiModel[]; settings: PiSettings };
export type PiConnection = {
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  api?: string;
  model?: string;
  imageInput?: boolean;
};
export type PiFile = { name: string; path: string; directory: boolean };
export type PiPreview = {
  path: string;
  content: string;
  kind: 'text' | 'image' | 'pdf' | 'binary';
  mimeType?: string;
  truncated?: boolean;
};
export type PiGit = { branch: string; files: { path: string; status: string; oldPath?: string }[] };
export type PiJudgeMode = 'shadow' | 'active';
export type PiAutomationSettings = { judgeMode: PiJudgeMode; jevApiKey?: string; jevProjectDir?: string };
export type PiAutomationAction = 'refresh' | 'start' | 'permissions';
export type PiAutomationStatus = {
  computerUse: 'ready' | 'not_installed' | 'stopped' | 'needs_permissions' | 'error';
  driverVersion?: string;
  jevConfigured: boolean;
  judgeMode: PiJudgeMode;
  detail?: string;
};
export type PiImageGenerationConfig = {
  provider: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
  configured: boolean;
};
export type PiImageGenerationInput = {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  enabled: boolean;
};

export type PiMethods = {
  articles: { input: undefined; output: ArticleCard[] };
  article: { input: { id: string }; output: ArticleDocument };
  bots: { input: undefined; output: BotCard[] };
  botPreview: { input: { github?: string }; output: BotPreview | undefined };
  botInstall: { input: { token: string }; output: BotCard };
  botDiscard: { input: { token: string }; output: void };
  botFavorite: { input: { id: string; favorite: boolean }; output: void };
  botRemove: { input: { id: string }; output: void };
  list: { input: undefined; output: PiConversation[] };
  taskTree: { input: undefined; output: PiTaskTree };
  taskLimits: { input: undefined; output: PiTaskLimits };
  saveTaskLimits: { input: PiTaskLimits; output: void };
  skillCatalog: { input: undefined; output: PiSkillCatalog };
  refreshSkills: { input: undefined; output: PiSkillCatalog };
  approveSkill: { input: { name: string }; output: PiSkillCatalog };
  rejectSkill: { input: { name: string }; output: PiSkillCatalog };
  create: { input: { cwd?: string; botId?: string }; output: PiSnapshot };
  open: { input: { id: string }; output: PiSnapshot };
  send: { input: { id: string; text: string; attachments: PiAttachment[]; mode: 'steer' | 'followUp' }; output: void };
  dispatch: { input: { id: string; goal: string; attachments?: PiAttachment[] }; output: void };
  stopTask: { input: { id: string; subtree: boolean }; output: void };
  resumeTask: { input: { id: string; subtree: boolean }; output: void };
  reviewTaskResearch: {
    input: { id: string; version: number; accepted: boolean; feedback?: string; searchTerms?: string };
    output: void;
  };
  verifyTask: { input: { id: string; accepted: boolean; notes?: string }; output: void };
  command: { input: { id: string; command: JsonRecord }; output: JsonRecord };
  respond: { input: { id: string; response: JsonRecord }; output: void };
  rename: { input: { id: string; title: string }; output: void };
  pin: { input: { id: string; pinned: boolean }; output: void };
  remove: { input: { id: string }; output: void };
  fork: { input: { id: string; entryId: string }; output: { snapshot: PiSnapshot; text: string; cancelled?: boolean } };
  folders: { input: undefined; output: string[] };
  chooseFolder: { input: undefined; output: string | undefined };
  chooseFiles: { input: undefined; output: PiAttachment[] };
  files: { input: { id: string; path?: string; search?: string }; output: PiFile[] };
  preview: { input: { id: string; path: string }; output: PiPreview };
  git: { input: { id: string }; output: PiGit };
  diff: { input: { id: string; path: string }; output: string };
  catalog: { input: undefined; output: PiCatalog };
  saveConnection: { input: PiConnection; output: void };
  imageGenerationConfig: { input: undefined; output: PiImageGenerationConfig };
  saveImageGenerationConfig: { input: PiImageGenerationInput; output: PiImageGenerationConfig };
  importImageGenerationConfig: { input: { filePath: string }; output: PiImageGenerationConfig };
  saveSettings: { input: PiSettings; output: void };
  setLearning: { input: { id: string; profile: PiLearningProfile }; output: void };
  login: { input: { provider: string; type: 'api_key' | 'oauth' }; output: void };
  authRespond: { input: { id: string; value?: string; cancelled?: boolean }; output: void };
  cancelLogin: { input: undefined; output: void };
  logout: { input: { provider: string }; output: void };
  testConnection: { input: undefined; output: string };
  automationStatus: { input: undefined; output: PiAutomationStatus };
  saveAutomation: { input: PiAutomationSettings; output: PiAutomationStatus };
  automationAction: { input: { action: PiAutomationAction }; output: PiAutomationStatus };
  external: { input: { url: string }; output: void };
  focus: { input: { id?: string }; output: void };
};
export type PiMethod = keyof PiMethods;
export type PiAPI = {
  invoke: <K extends PiMethod>(method: K, input: PiMethods[K]['input']) => Promise<PiMethods[K]['output']>;
  subscribe: (listener: (event: PiEvent) => void) => () => void;
  filePath: (file: File) => string;
};
declare global {
  interface Window {
    aionPi?: PiAPI;
  }
}
