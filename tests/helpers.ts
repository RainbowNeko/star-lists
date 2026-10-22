import type { ClassifiedRepo, Dataset, Level, StarredRepo } from '../src/types.js';

export function makeRepo(
  fullName: string,
  partial: Partial<StarredRepo> = {},
): StarredRepo {
  const [owner, name] = fullName.split('/');
  return {
    id: partial.id ?? Math.floor(Math.random() * 1_000_000),
    nodeId: partial.nodeId ?? `R_${fullName}`,
    nameWithOwner: fullName,
    owner: owner ?? 'owner',
    name: name ?? fullName,
    url: `https://github.com/${fullName}`,
    description: null,
    topics: [],
    language: null,
    stars: 10,
    forks: 1,
    archived: false,
    fork: false,
    isPrivate: false,
    size: 100,
    homepage: null,
    defaultBranch: 'main',
    pushedAt: '2026-01-01T00:00:00Z',
    createdAt: '2020-01-01T00:00:00Z',
    starredAt: '2025-01-01T00:00:00Z',
    license: null,
    ...partial,
  };
}

export function classified(
  fullName: string,
  level: Level,
  partial: Partial<StarredRepo> = {},
  confidence = 0.9,
): ClassifiedRepo {
  return {
    repo: makeRepo(fullName, partial),
    level,
    score: 10,
    confidence,
    evidence: [{ level, weight: 10, reason: '测试证据', source: 'anchor' }],
    runnerUp: null,
    needsReview: confidence < 0.5,
    deepAnalyzed: false,
  };
}

export function makeDataset(repos: ClassifiedRepo[]): Dataset {
  return {
    schemaVersion: 1,
    username: 'demo',
    profile: null,
    fetchedAt: '2026-10-18T10:00:00Z',
    deep: false,
    totalStarred: repos.length,
    totalAnalyzed: repos.length,
    truncated: false,
    repos,
    warnings: [],
  };
}

export function makeSignals(partial: Partial<import('../src/types.js').DeepSignals> = {}) {
  return {
    files: [],
    kernel: { kconfig: false, objM: false, bpfSource: false, moduleInit: false },
    hasDockerfile: false,
    hasCompose: false,
    hasTauri: false,
    hasElectronBuilder: false,
    hasAndroidManifest: false,
    hasXcodeProject: false,
    hasWebIndex: false,
    hasMainEntry: false,
    hasFrontendFramework: false,
    errors: [],
    ...partial,
  };
}
