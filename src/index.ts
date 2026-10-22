export type {
  ClassifiedRepo,
  Dataset,
  DeepSignals,
  EngineName,
  Evidence,
  GitHubProfile,
  Level,
  PublishReport,
  StarredRepo,
} from './types.js';
export { LEVEL_IDS } from './types.js';

export { LEVELS, ORDERED_LEVELS, isLevel, levelMeta } from './levels.js';
export {
  classifyAll,
  classifyRepo,
  selectDeepCandidates,
  type ClassifyOptions,
} from './classify.js';
export { ANCHORS, findAnchor } from './anchors.js';
export { GitHubClient, toStarredRepo } from './github.js';
export { DeepAnalyzer } from './deep.js';
export { analyzeUser, loadFixture } from './pipeline.js';
export { renderDataset } from './render/markdown.js';
export { writeDataset } from './output.js';
export {
  GitHubListsApi,
  publishLists,
  PublishPermissionError,
  type ExistingList,
  type ListsApi,
  type PublishOptions,
} from './publish.js';

export {
  createEngine,
  mergeEngineResults,
  OpenAICompatibleEngine,
  resolveEngineConfig,
  type EngineConfig,
  type EngineClassification,
  type EngineOutcome,
  type EngineOptions,
} from './engine.js';
