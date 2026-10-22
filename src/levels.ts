import type { Level } from './types.js';
import { LEVEL_IDS } from './types.js';

export interface LevelMeta {
  id: Level;
  /** 排序，同时用于文件名前缀。 */
  order: number;
  emoji: string;
  /** 中文层级名。 */
  zh: string;
  /** 英文层级名。 */
  en: string;
  /** 一句话说明，展示在总览与清单头部。 */
  description: string;
  /** 写入 GitHub Lists 时使用的名称。 */
  listName: string;
  /** GitHub List 的 description。 */
  listDescription: string;
  fileBase: string;
}

export const LEVELS: Record<Level, LevelMeta> = {
  kernel: {
    id: 'kernel',
    order: 1,
    emoji: '🧩',
    zh: '内核与系统底层',
    en: 'Kernel & Systems',
    description: '内核、驱动、eBPF、固件、bootloader、RTOS 与操作系统底层',
    listName: '🧩 内核与系统底层',
    listDescription: '内核、驱动、eBPF、固件、bootloader、RTOS 与操作系统底层',
    fileBase: '01-kernel',
  },
  foundation: {
    id: 'foundation',
    order: 2,
    emoji: '🏗️',
    zh: '基础库',
    en: 'Foundation Libraries',
    description: '语言运行时、编译器、标准库、核心系统库与协议栈',
    listName: '🏗️ 基础库',
    listDescription: '语言运行时、编译器、标准库、核心系统库与协议栈',
    fileBase: '02-foundation',
  },
  dependency: {
    id: 'dependency',
    order: 3,
    emoji: '📦',
    zh: '软件依赖包',
    en: 'Packages & SDKs',
    description: '可被其他项目引用的库、SDK、框架、绑定与插件',
    listName: '📦 软件依赖包',
    listDescription: '可被其他项目引用的库、SDK、框架、绑定与插件',
    fileBase: '03-dependency',
  },
  cli: {
    id: 'cli',
    order: 4,
    emoji: '⌨️',
    zh: '命令行应用',
    en: 'CLI & TUI',
    description: '在终端中运行的命令、TUI、开发与运维工具',
    listName: '⌨️ 命令行应用',
    listDescription: '在终端中运行的命令、TUI、开发与运维工具',
    fileBase: '04-cli',
  },
  server: {
    id: 'server',
    order: 5,
    emoji: '🌐',
    zh: '服务端应用',
    en: 'Servers & Services',
    description: '后端服务、数据库、中间件、自托管服务与基础设施',
    listName: '🌐 服务端应用',
    listDescription: '后端服务、数据库、中间件、自托管服务与基础设施',
    fileBase: '05-server',
  },
  app: {
    id: 'app',
    order: 6,
    emoji: '🖥️',
    zh: '应用',
    en: 'Applications',
    description: '面向最终用户的桌面、移动、Web 应用与游戏',
    listName: '🖥️ 应用',
    listDescription: '面向最终用户的桌面、移动、Web 应用与游戏',
    fileBase: '06-app',
  },
  resource: {
    id: 'resource',
    order: 7,
    emoji: '📚',
    zh: '资源与模板',
    en: 'Resources & Templates',
    description: '教程、清单、模板、dotfiles 与学习资源',
    listName: '📚 资源与模板',
    listDescription: '教程、清单、模板、dotfiles 与学习资源',
    fileBase: '07-resource',
  },
  unclassified: {
    id: 'unclassified',
    order: 8,
    emoji: '❓',
    zh: '待归类',
    en: 'Unclassified',
    description: '证据不足，或仓库信息太少，需要人工确认',
    listName: '❓ 待归类',
    listDescription: '证据不足，需要人工确认的项目',
    fileBase: '08-unclassified',
  },
};

export const ORDERED_LEVELS: LevelMeta[] = LEVEL_IDS.map((id) => LEVELS[id]).sort(
  (a, b) => a.order - b.order,
);

/**
 * 平票时的优先级：越靠前越“底层”。
 * kernel > foundation > dependency > cli > server > app > resource > unclassified
 */
export const LEVEL_PRIORITY: Record<Level, number> = {
  kernel: 0,
  foundation: 1,
  dependency: 2,
  cli: 3,
  server: 4,
  app: 5,
  resource: 6,
  unclassified: 7,
};

export function isLevel(value: string): value is Level {
  return (LEVEL_IDS as readonly string[]).includes(value);
}

export function levelMeta(level: Level): LevelMeta {
  return LEVELS[level];
}

export function levelByFileBase(fileBase: string): Level | null {
  for (const meta of ORDERED_LEVELS) {
    if (meta.fileBase === fileBase) return meta.id;
  }
  return null;
}
