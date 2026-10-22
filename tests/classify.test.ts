import { describe, expect, it } from 'vitest';
import { classifyRepo, selectDeepCandidates } from '../src/classify.js';
import type { Level, StarredRepo } from '../src/types.js';
import { makeRepo, makeSignals } from './helpers.js';

describe('classifyRepo - anchors', () => {
  const cases: Array<[string, Level]> = [
    ['torvalds/linux', 'kernel'],
    ['zephyrproject-rtos/zephyr', 'kernel'],
    ['openssl/openssl', 'foundation'],
    ['nodejs/node', 'foundation'],
    ['facebook/react', 'dependency'],
    ['expressjs/express', 'dependency'],
    ['BurntSushi/ripgrep', 'cli'],
    ['pnpm/pnpm', 'cli'],
    ['redis/redis', 'server'],
    ['kubernetes/kubernetes', 'server'],
    ['microsoft/vscode', 'app'],
    ['localsend/localsend', 'app'],
    ['sindresorhus/awesome', 'resource'],
  ];

  it.each(cases)('%s → %s', (fullName, expected) => {
    const result = classifyRepo(makeRepo(fullName));
    expect(result.level).toBe(expected);
    expect(result.evidence.some((item) => item.source === 'anchor')).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.92);
  });
});

describe('classifyRepo - 通用规则', () => {
  const cases: Array<[string, Partial<StarredRepo>, Level]> = [
    [
      'example/bookmark-cli',
      { description: 'A command-line tool for managing bookmarks' },
      'cli',
    ],
    [
      'example/date-lib',
      { description: 'A JavaScript library for date formatting' },
      'dependency',
    ],
    [
      'example/selfhosted',
      { description: 'A self-hosted bookmark service' },
      'server',
    ],
    [
      'example/note-app',
      { description: 'Desktop app for taking notes', topics: ['desktop-app'] },
      'app',
    ],
    [
      'example/notes-api',
      { description: 'A tiny backend for taking notes' },
      'server',
    ],
    [
      'example/tutorial',
      { description: 'A tutorial for learning Rust from scratch' },
      'resource',
    ],
    [
      'example/awesome-react-components',
      { description: 'A curated list of React components' },
      'resource',
    ],
    [
      'example/everything',
      { description: 'A curated list of awesome CLI apps for Linux' },
      'resource',
    ],
    [
      'example/video',
      { description: 'Video processing library', topics: ['video'] },
      'dependency',
    ],
    [
      'example/kernel-module',
      { description: 'A Linux kernel module for GPIO', topics: ['kernel'] },
      'kernel',
    ],
  ];

  it.each(cases)('%s → %s', (fullName, partial, expected) => {
    expect(classifyRepo(makeRepo(fullName, partial)).level).toBe(expected);
  });

  it('信息不足时进入 unclassified', () => {
    const result = classifyRepo(makeRepo('example/mystery'));
    expect(result.level).toBe('unclassified');
    expect(result.confidence).toBeLessThan(0.5);
    expect(result.needsReview).toBe(true);
  });

  it('弱信号（总分低于 3）不强行归类', () => {
    const result = classifyRepo(makeRepo('example/thing', { description: 'A small tool' }));
    expect(result.level).toBe('unclassified');
    expect(result.runnerUp).toBe('cli');
    expect(result.needsReview).toBe(true);
  });
});

describe('classifyRepo - 真实世界常见仓库', () => {
  const cases: Array<[string, Partial<StarredRepo>, Level]> = [
    ['gohugoio/hugo', {}, 'cli'],
    ['helm/helm', {}, 'cli'],
    ['vitejs/vite', {}, 'cli'],
    ['apache/airflow', {}, 'server'],
    ['hashicorp/vault', {}, 'server'],
    ['storybookjs/storybook', {}, 'dependency'],
    ['node-fetch/node-fetch', {}, 'dependency'],
    ['nodejs/undici', {}, 'dependency'],
    ['d3/d3', {}, 'dependency'],
    ['colinhacks/zod', {}, 'dependency'],
    ['prisma/prisma', {}, 'dependency'],
    [
      'streamlit/streamlit',
      {
        description: 'Streamlit — A faster way to build and share data apps.',
        topics: ['python', 'data-science', 'machine-learning'],
        language: 'Python',
      },
      'dependency',
    ],
    [
      'nestjs/nest',
      {
        description:
          'A progressive Node.js framework for building efficient and scalable server-side applications.',
        topics: ['framework', 'nodejs', 'typescript'],
        language: 'TypeScript',
      },
      'dependency',
    ],
    [
      'cypress-io/cypress',
      {
        description: 'Fast, easy and reliable testing for anything that runs in a browser.',
        topics: ['testing', 'e2e', 'automation'],
        language: 'TypeScript',
      },
      'dependency',
    ],
  ];

  it.each(cases)('%s → %s', (fullName, partial, expected) => {
    expect(classifyRepo(makeRepo(fullName, partial)).level).toBe(expected);
  });
});

describe('classifyRepo - 深度信号', () => {
  it('obj-m 让仓库进入内核层', () => {
    const result = classifyRepo(
      makeRepo('example/gpio-helper', { language: 'C' }),
      makeSignals({
        kernel: { kconfig: true, objM: true, bpfSource: false, moduleInit: false },
        files: ['Kconfig', 'Makefile'],
      }),
    );
    expect(result.level).toBe('kernel');
    expect(result.signals).toBeDefined();
    expect(result.evidence.some((item) => item.source === 'manifest')).toBe(true);
  });

  it('package.json bin → CLI', () => {
    const result = classifyRepo(
      makeRepo('example/cleanup'),
      makeSignals({
        packageJson: {
          name: 'cleanup',
          private: false,
          hasBin: true,
          hasExports: false,
          hasTypes: false,
          workspaces: false,
          dependencies: ['commander'],
          devDependencies: [],
          scripts: ['build'],
        },
      }),
    );
    expect(result.level).toBe('cli');
  });

  it('Cargo lib → 依赖包', () => {
    const result = classifyRepo(
      makeRepo('example/serde-helper'),
      makeSignals({
        cargo: {
          hasBin: false,
          hasLib: true,
          crateTypes: [],
          dependencies: [],
          isWorkspace: false,
        },
      }),
    );
    expect(result.level).toBe('dependency');
  });

  it('docker compose → 服务端', () => {
    const result = classifyRepo(
      makeRepo('example/stack'),
      makeSignals({ hasCompose: true, hasDockerfile: true }),
    );
    expect(result.level).toBe('server');
  });

  it('python console_scripts → CLI', () => {
    const result = classifyRepo(
      makeRepo('example/py-tool'),
      makeSignals({
        python: { hasConsoleScripts: true, dependencies: [], isPackage: true },
      }),
    );
    expect(result.level).toBe('cli');
  });

  it('tauri 配置 → 应用', () => {
    const result = classifyRepo(
      makeRepo('example/desk'),
      makeSignals({ hasTauri: true, hasMainEntry: true }),
    );
    expect(result.level).toBe('app');
  });

  it('Streamlit 等应用构建框架 → 依赖包', () => {
    const result = classifyRepo(
      makeRepo('example/dashboard'),
      makeSignals({
        python: {
          hasConsoleScripts: false,
          dependencies: ['streamlit', 'pandas'],
          isPackage: true,
        },
      }),
    );
    expect(result.level).toBe('dependency');
  });
});


describe('selectDeepCandidates', () => {
  it('跳过锚点，优先选择不确定的项目', () => {
    const items = [
      classifyRepo(makeRepo('torvalds/linux')),
      classifyRepo(makeRepo('example/mystery')),
      classifyRepo(makeRepo('example/thing', { description: 'A small tool' })),
      classifyRepo(makeRepo('example/bookmark-cli', { description: 'A command-line tool' })),
      classifyRepo(makeRepo('example/date-lib', { description: 'A library for dates' })),
    ];
    const selected = selectDeepCandidates(items, 2);
    expect(selected).toHaveLength(2);
    expect(selected[0]?.repo.nameWithOwner).toBe('example/mystery');
    expect(selected.some((item) => item.repo.nameWithOwner === 'torvalds/linux')).toBe(false);
  });
});
