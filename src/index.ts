export type {
  ClassifiedRepo,
  Dataset,
  DeepSignals,
  DomainFacet,
  EngineName,
  Evidence,
  FacetGroup,
  FormFacet,
  GitHubProfile,
  LayerFacet,
  Level,
  PublishReport,
  RepoFacets,
  RoleFacet,
  StarredRepo,
} from './types.js';
export { DOMAIN_FACETS, FACET_GROUPS, FORM_FACETS, LAYER_FACETS, LEVEL_IDS, ROLE_FACETS } from './types.js';

export {
  facetCatalog,
  facetListDescription,
  facetListName,
  inferFacets,
  isFacetGroup,
  mergeFacets,
  sanitizeFacets,
} from './facets.js';

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
