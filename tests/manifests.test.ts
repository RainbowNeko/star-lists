import { describe, expect, it } from 'vitest';
import {
  parseCargoToml,
  parseGoMod,
  parsePackageJson,
  parsePyprojectToml,
  parseReadme,
  parseSetupPy,
  signalsFromDeep,
  treeHasGoMain,
  treeHasMainEntry,
} from '../src/manifests.js';
import { makeSignals } from './helpers.js';

describe('parsePackageJson', () => {
  it('识别 bin / exports / 依赖', () => {
    const info = parsePackageJson(
      JSON.stringify({
        name: 'tiny-cli',
        private: false,
        bin: { tiny: './cli.js' },
        exports: { '.': './index.js' },
        dependencies: { commander: '^12.0.0' },
        devDependencies: { vitest: '^2.0.0' },
      }),
    );
    expect(info).toMatchObject({
      name: 'tiny-cli',
      hasBin: true,
      hasExports: true,
      dependencies: ['commander'],
      devDependencies: ['vitest'],
    });
  });

  it('支持字符串形式的 bin', () => {
    const info = parsePackageJson(JSON.stringify({ name: 'x', bin: './x.js' }));
    expect(info?.hasBin).toBe(true);
  });

  it('无效 JSON 返回 null', () => {
    expect(parsePackageJson('{oops')).toBeNull();
  });
});

describe('parseCargoToml', () => {
  it('识别 [[bin]] 与依赖', () => {
    const info = parseCargoToml(`
[package]
name = "x"
version = "0.1.0"

[[bin]]
name = "x"
path = "src/main.rs"

[dependencies]
clap = "4"
`);
    expect(info?.hasBin).toBe(true);
    expect(info?.dependencies).toContain('clap');
  });

  it('识别只看 [lib] 的 crate', () => {
    const info = parseCargoToml(`
[package]
name = "x"

[lib]
crate-type = ["cdylib"]

[dependencies]
wasm-bindgen = "0.2"
`);
    expect(info?.hasBin).toBe(false);
    expect(info?.hasLib).toBe(true);
    expect(info?.crateTypes).toContain('cdylib');
  });
});

describe('parsePyprojectToml', () => {
  it('识别 project.scripts 与依赖', () => {
    const info = parsePyprojectToml(`
[project]
name = "notes-api"
dependencies = ["fastapi>=0.100", "uvicorn"]

[project.scripts]
notes = "notes.cli:main"
`);
    expect(info?.hasConsoleScripts).toBe(true);
    expect(info?.dependencies).toContain('fastapi>=0.100');
    expect(info?.isPackage).toBe(true);
  });

  it('识别 Poetry scripts', () => {
    const info = parsePyprojectToml(`
[tool.poetry]
name = "x"

[tool.poetry.scripts]
x = "x:main"
`);
    expect(info?.hasConsoleScripts).toBe(true);
  });
});

describe('parseSetupPy', () => {
  it('识别 console_scripts 与 install_requires', () => {
    const info = parseSetupPy(`
setup(
  name="x",
  packages=["x"],
  install_requires=["requests>=2", "click"],
  entry_points={"console_scripts": ["x=x:main"]},
)
`);
    expect(info?.hasConsoleScripts).toBe(true);
    expect(info?.dependencies).toEqual(['requests', 'click']);
  });
});

describe('parseGoMod / main 入口', () => {
  it('解析 module 与 require', () => {
    const info = parseGoMod(`
module github.com/acme/x

go 1.22

require (
  github.com/spf13/cobra v1.8.0
  github.com/gin-gonic/gin v1.10.0
)
`);
    expect(info.module).toBe('github.com/acme/x');
    expect(info.imports).toContain('github.com/spf13/cobra');
    expect(info.imports).toContain('github.com/gin-gonic/gin');
  });

  it('识别 main.go 与 cmd 布局', () => {
    expect(treeHasGoMain(['main.go'])).toBe(true);
    expect(treeHasGoMain(['cmd/server/main.go'])).toBe(true);
    expect(treeHasGoMain(['lib/x.go'])).toBe(false);
    expect(treeHasMainEntry(['src/main.rs'], 'Rust')).toBe(true);
  });
});

describe('parseReadme', () => {
  it('识别全局安装 / docker / 自托管', () => {
    const info = parseReadme(`
# x

\`\`\`bash
npm install -g x
docker compose up -d
\`\`\`

A self-hosted service with a screenshot:

![demo](https://example.com/screenshot.png)
![badge](https://img.shields.io/badge/build-passing-green)
`);
    expect(info.globalInstall).toBe(true);
    expect(info.dockerRun).toBe(true);
    expect(info.selfHosted).toBe(true);
    expect(info.hasScreenshot).toBe(true);
  });

  it('只有 badge 时不算截图', () => {
    const info = parseReadme('![badge](https://img.shields.io/badge/x-y)');
    expect(info.hasScreenshot).toBe(false);
  });

  it('普通依赖安装不算全局安装', () => {
    const info = parseReadme('```bash\nnpm install axios\n```');
    expect(info.globalInstall).toBe(false);
    expect(info.libraryInstall).toBe(true);
  });
});

describe('signalsFromDeep', () => {
  it('package bin / cargo bin / compose 产生对应证据', () => {
    const signals = signalsFromDeep(
      makeSignals({
        packageJson: {
          private: false,
          hasBin: true,
          hasExports: true,
          hasTypes: false,
          workspaces: false,
          dependencies: ['react'],
          devDependencies: [],
          scripts: [],
        },
        hasCompose: true,
      }),
    );
    expect(signals.some((item) => item.level === 'cli' && item.source === 'manifest')).toBe(true);
    expect(signals.some((item) => item.level === 'dependency')).toBe(true);
    expect(signals.some((item) => item.level === 'server')).toBe(true);
  });

});
