# ⭐ star-lists

把 GitHub 用户的**全部 Star** 按技术层级自动整理成多份清单，并可选一键同步为 GitHub Lists。

输入一个 username，输出 8 份可读的 star list：

> 🧩 内核与系统底层 · 🏗️ 基础库 · 📦 软件依赖包 · ⌨️ 命令行应用 · 🌐 服务端应用 · 🖥️ 应用 · 📚 资源与模板 · ❓ 待归类

每条分类都带**判定依据**与**置信度**，低置信度项目会进入 `review.md` 等人工确认，而不是假装确定。

---

## 特性

- **全量读取**：分页拉取用户所有 starred 仓库，保留 star 时间、topics、语言、归档状态等元数据。
- **8 层分类**：覆盖从内核、运行时、依赖包、CLI、服务端到终端应用与学习资源的完整光谱。
- **多种分类引擎**：默认规则引擎；可选端侧小模型（本地 OpenAI 兼容接口）或大模型（远程 OpenAI 兼容接口）做语义分类。
- **可解释**：每项给出证据（锚点 / topics / 描述 / 文件名 / manifest / README / 人工）与 0~1 置信度。
- **深度分析（可选）**：读取仓库文件树、`package.json` / `Cargo.toml` / `pyproject.toml` / `go.mod` / `Dockerfile` / README，识别 `bin`、`console_scripts`、`obj-m`、compose、Tauri 等硬信号。
- **多种产物**：`README.md` 总览、`lists/*.md` 分清单、`data.json` 完整数据、`lists.json` 精简映射、`review.md` 待复核。
- **同步 GitHub Lists**：通过 GraphQL 的 `createUserList` / `updateUserListsForItem` 真正写入 GitHub，支持 dry-run、合并与覆盖模式。
- **Web UI**：本地看板，支持分析、人工拖拽分类、发布 GitHub Lists。
- **工程细节**：token 自动发现、缓存、限流重试、`--since` / `--min-stars` 过滤、离线 fixture、JSON 输出、单元测试。

## 快速开始

要求：Node.js ≥ 20，pnpm ≥ 10。

```bash
pnpm install
pnpm build

# 建议设置 token（只读公开 star 也需要它来避免 60 次/小时的匿名限额）
export GITHUB_TOKEN=ghp_xxx

# 分析一个用户；--deep 会读 manifest 和 README，更准但更慢
pnpm starlists sindresorhus --deep

# 或者直接运行构建产物
node dist/cli.js sindresorhus --deep
```

输出默认写到 `out/<username>/`：

```text
out/sindresorhus/
├── README.md              # 总览 + 各层级 Top 5
├── lists/
│   ├── 01-kernel.md
│   ├── 02-foundation.md
│   ├── 03-dependency.md
│   ├── 04-cli.md
│   ├── 05-server.md
│   ├── 06-app.md
│   ├── 07-resource.md
│   └── 08-unclassified.md
├── review.md              # 低置信度项目（有才生成）
├── data.json              # 完整分类结果 + 证据 + 深度信号 + engine
└── lists.json             # 层级 → 仓库名映射
```

> 匿名 API 限额为 60 次/小时，且深度分析每个仓库至少 1 次 API 请求。真实使用请配置 token（有 token 时限额为 5000 次/小时）。未配置 token 时，`--deep` 最多分析 8 个仓库并给出提示。

### 清单长什么样

每份清单都按 star 数排序，并保留“为什么分到这一层”：

| # | 项目 | ⭐ | 语言 | 简介 | 判定依据 |
|--:|:--|--:|:--|:--|:--|
| 1 | [`junegunn/fzf`](https://github.com/junegunn/fzf) | 68k | Go | A command-line fuzzy finder | 锚点：命令行模糊查找工具 · topics 指向命令行 / 终端工具（cli） |
| 2 | [`BurntSushi/ripgrep`](https://github.com/BurntSushi/ripgrep) | 52k | Rust | ripgrep recursively searches directories… | 锚点：命令行搜索工具 · topics 指向命令行 / 终端工具（cli） |
| 3 | [`acme/tiny-cli`](https://github.com/acme/tiny-cli) | 42 | TypeScript | A small utility to clean up temporary files. | package.json 声明了 bin 可执行入口 · 仓库名表明是 CLI / TUI |

同时会生成 `review.md`，把“置信度低于 50% 或前两名分差过小”的项目单独列出，方便人工复核。

### 离线演示

仓库自带一份 33 个真实项目的 fixture，不联网即可看到完整效果：

```bash
pnpm demo
# 等价于：pnpm starlists --input fixtures/stars.demo.json --out out/demo
```

## 分类层级

| 层级 | 名称 | 典型内容 | 常见信号 |
|:--|:--|:--|:--|
| `kernel` | 🧩 内核与系统底层 | 内核、驱动、eBPF、固件、bootloader、RTOS、操作系统 | `Kconfig`、`obj-m`、`.bpf.c`、`kernel` / `driver` topics |
| `foundation` | 🏗️ 基础库 | 运行时、编译器、标准库、核心系统库、协议栈 | `compiler` / `runtime` topics、`libc` / `allocator` 描述 |
| `dependency` | 📦 软件依赖包 | 可被引用的库、SDK、框架、ORM、组件库、插件 | `library` / `framework` / `sdk` topics、`package.json` exports |
| `cli` | ⌨️ 命令行应用 | 终端命令、TUI、构建/运维/开发工具 | `bin`、`console_scripts`、`[[bin]]`、`cli` / `tui` topics |
| `server` | 🌐 服务端应用 | 后端服务、数据库、队列、网关、自托管服务 | `self-hosted`、`database`、compose、`Dockerfile` |
| `app` | 🖥️ 应用 | 面向最终用户的桌面 / 移动 / Web 应用、游戏 | `desktop-app`、`android`、Tauri / Electron 配置、应用截图 |
| `resource` | 📚 资源与模板 | 教程、awesome 清单、路线图、dotfiles、模板 | `awesome-*`、`tutorial`、`roadmap`、`dotfiles` |
| `unclassified` | ❓ 待归类 | 信息不足或规则冲突 | 无描述、无 topics、体积很小 |

几条边界约定：

- **框架 / 库优先归入依赖包**，而不是应用层。例如 Express、Next.js、Streamlit 都在 `dependency`。
- **可部署的服务**归入服务端：数据库、消息队列、自托管面板、监控与网关。
- **TUI 编辑器 / 终端模拟器**归入应用层；一次性的终端命令归入 CLI。
- **构建工具**（Vite、webpack、esbuild）归入 CLI；被 `import` 的运行时库归入依赖包。
- **awesome / tutorial / dotfiles** 优先于其描述中提到的技术词，避免“教你写 React 的教程”被归到 React 所在层。

## 判定是怎么做的

分类器按以下顺序累加可解释的分数：

1. **锚点**：约 200 个定位明确的知名仓库（linux、OpenSSL、React、ripgrep、Redis、VS Code…），权重最高，只作兜底。
2. **topics 精确匹配**：`kernel`、`cli`、`self-hosted`、`awesome-list` 等，一次命中加一次分。
3. **仓库名模式**：`awesome-*`、`*-cli`、`*-lib`、`*.github.io`、`dotfiles` 等。
4. **描述规则**：中英文关键词，如“命令行 / command-line”“self-hosted”“编译器 / compiler”。
5. **元信息**：应用商店主页、语言、仓库体积等弱信号。
6. **深度信号**（`--deep`）：文件树 + manifest + README，见下一节。
7. **人工手动分类**（Web UI）：直接改写层级，写入 `source: "manual"` 证据，置信度记为 1。

最终取最高分；平票按“越底层越优先”的顺序（kernel → foundation → dependency → cli → server → app → resource）打破。置信度同时考虑分差与绝对分数，低于 50%、分差过小或总分过低时标记 `needsReview`，写入 `review.md`。

规则是数据驱动的，想调整分类时直接改：

- `src/anchors.ts` — 知名仓库锚点
- `src/rules.ts` — topics / 名称 / 描述规则
- `src/manifests.ts` — manifest 与 README 解析、深度信号权重
- `src/engine.ts` — 端侧小模型 / 大模型分类引擎（OpenAI 兼容接口）

### 深度分析

`--deep` 会对**初步分类最不确定**的仓库（待归类 > 需复核 > 置信度低），最多 `--deep-max` 个，逐个：

1. 读取一次递归文件树（1 次 API 请求），缓存 7 天，`pushed_at` 变化后自动失效；
2. 按需读取根目录 manifest 与 README（走 `raw.githubusercontent.com`，不占 API 限额）；
3. 识别：
   - `package.json`：`bin`、`exports`、`types`、`private`、依赖框架（React / Express / Electron / React Native…）
   - `Cargo.toml`：`[[bin]]`、`[lib]`、`crate-type`、clap / axum / embedded-hal
   - `pyproject.toml` / `setup.py` / `setup.cfg`：`console_scripts`、Flask / FastAPI / Streamlit
   - `go.mod` + `main.go`：CLI 库（cobra）或 Web 框架（gin / echo / fiber）
   - `Kconfig` / `Makefile`：`obj-m`、`module_init`
   - `Dockerfile` / `docker-compose.yml`、Tauri、Electron Builder、AndroidManifest、Xcode 工程、`index.html` + 前端框架
   - 模型文件：`.gguf`、`.safetensors`、`model.safetensors.index.json`、`tokenizer.json`、`config.json`、`.onnx`、`.tflite`、`.mlmodel`、LoRA 适配器、训练脚本（作为模型引擎的上下文信号）
   - README：全局安装命令、`docker run`、自托管声明、桌面安装包、截图

深度分析默认对 300 个仓库封顶；token 下每个仓库约 1 次 API 请求。1000 个 star 的项目通常几分钟内完成。

## 分类引擎

默认使用**规则引擎**（`rules`），不联网、可解释、速度快。也可以切换为模型引擎：

| 引擎 | 说明 | 默认接口 |
|:--|:--|:--|
| `rules` | 现有规则 + 锚点 + 深度信号 | 无 |
| `edge` | **端侧小模型**，本地 OpenAI 兼容接口 | `http://127.0.0.1:11434/v1`（Ollama） |
| `large` | **大模型**，远程 OpenAI 兼容接口 | 需显式配置 |

模型引擎会把仓库名、描述、topics、语言、star 数，以及 `--deep` 得到的信号（`bin`、`Dockerfile`、`GGUF`、`safetensors` 等）一起发给模型，要求它返回每个仓库的 8 层分类、置信度和原因。解析失败、漏返回或接口错误的仓库会**自动回退到规则引擎结果**，并在 `warnings` 中记录。

### 端侧小模型（Ollama 示例）

```bash
# 1. 启动 Ollama 并准备一个小模型
ollama serve
ollama pull qwen2.5:3b

# 2. 使用 edge 引擎
node dist/cli.js Core2002 --engine edge --engine-model qwen2.5:3b
```

也可以连接 LM Studio、llama.cpp server、MLC-LLM 等任何 OpenAI 兼容接口：

```bash
export STARLISTS_EDGE_BASE_URL=http://127.0.0.1:1234/v1
export STARLISTS_EDGE_MODEL=local-model
node dist/cli.js Core2002 --engine edge
```

### 大模型（远程 API 示例）

```bash
export STARLISTS_LARGE_BASE_URL=https://api.deepseek.com/v1
export STARLISTS_LARGE_MODEL=deepseek-chat
export STARLISTS_LARGE_API_KEY=sk-xxx

node dist/cli.js Core2002 --engine large
```

也支持 OpenAI、vLLM、SGLang、OpenRouter 等 OpenAI 兼容服务。大模型引擎必须提供 `--engine-base-url` / `STARLISTS_LARGE_BASE_URL` 和 `--engine-model` / `STARLISTS_LARGE_MODEL`。

### 通用参数

| 参数 | 说明 | 默认 |
|:--|:--|:--|
| `--engine <rules\|edge\|large>` | 分类引擎 | `rules` |
| `--engine-base-url <url>` | 覆盖引擎的 OpenAI 兼容地址 | 见上表 |
| `--engine-model <model>` | 模型名 | edge 为 `qwen2.5:3b`；large 必填 |
| `--engine-api-key <key>` | API key；建议改用环境变量 | 环境变量 |
| `--engine-batch-size <n>` | 每次请求分类多少个仓库 | `20` |
| `--engine-concurrency <n>` | 并发批次数 | edge `1`，large `2` |
| `--engine-timeout <seconds>` | 单次请求超时 | `120` |

环境变量优先级：显式 CLI 参数 > `STARLISTS_EDGE_*` / `STARLISTS_LARGE_*` > `STARLISTS_ENGINE_*` > 默认值；大模型还会尝试 `OPENAI_API_KEY`。

> 模型引擎的输出仍然是 8 层分类，不改变现有分类体系；`data.json` 会记录 `engine` 字段和 `source: "model"` 的证据。

## Web UI

内置一个本地 Web 工作台，把 CLI 的分析、分类引擎、人工复核和 GitHub Lists 发布串起来。

```bash
pnpm install
pnpm build
pnpm web
# 打开 http://127.0.0.1:4173/
```

开发模式（不构建，直接跑源码）：

```bash
pnpm web:dev
```

### 功能

- **分析**：输入 GitHub 用户名，或加载本地 `data.json`；支持 `--deep`、`--since`、`--min-stars`、排除 fork/归档、缓存开关。
- **分类引擎**：在规则 / 端侧小模型 / 大模型之间切换，模型配置可在表单里临时填写。
- **人工分类**：8 列看板，把仓库卡片拖到目标层级，或用卡片上的下拉框调整；支持搜索、仅看待复核、仅看人工分类。
- **复核确认**：详情弹窗里点「确认分类无误」，保持当前层级不变、清除待复核标记；同样需要点击顶部「保存人工分类」才会落盘。
- **保存人工分类**：写入 `out/<username>/data.json`，并重新生成 `README.md`、`lists/*.md`、`review.md`、`lists.json`。人工结果带 `source: "manual"` 证据，置信度记为 1。
- **发布**：对当前数据集执行 GitHub Lists dry-run 或真实写入；默认只预览，真实写入会二次确认。
- **下载**：直接下载当前数据集的 `data.json`。

### 安全与边界

- 默认只监听 `127.0.0.1:4173`，可用 `HOST` / `PORT` 覆盖；不要在没有鉴权的情况下暴露到公网。
- GitHub token / 模型 API key 只随请求发送，不写入磁盘；建议用环境变量，避免在表单里长期保留。
- 人工分类会覆盖本次结果；重新从 GitHub 分析会重新分类，人工修改不会自动迁移。需要保留人工结果时，用 `--input out/<username>/data.json` 复用。
- 真实发布需要带 `user` scope 的 GitHub token；非 dry-run 请求必须带 `confirm: true`（Web UI 会自动处理）。
- Web UI 与 CLI 使用同一套分类器、缓存、渲染和发布逻辑；没有复制实现。

### 目录

```text
src/web/server.ts   # 本地 HTTP API + 静态资源服务
web/index.html      # 单页界面
web/app.js          # 无框架前端逻辑（看板 / 拖拽 / 任务轮询）
web/styles.css      # 样式
```

主要 API：`POST /api/analyze`、`GET /api/jobs/:id`、`GET /api/dataset`、`POST /api/reclassify`、`POST /api/publish`、`GET /api/export`。

`GET /api/dataset` 会额外返回 `revision`；`POST /api/reclassify` 可带上该值做乐观并发控制，数据已被其他窗口修改时返回 409。`changes` 项为 `{ nameWithOwner, level, reviewed? }`，`reviewed: true` 表示确认当前层级无误。产物写入采用临时文件 + rename，`data.json` 最后提交，避免读者看到半成品。

## 常用命令

```bash
# 只分析 2024 年以后 star 的、star 数 ≥ 100 的项目
pnpm starlists <user> --since 2024-01-01 --min-stars 100

# 排除 fork / 已归档仓库
pnpm starlists <user> --exclude-forks --exclude-archived

# 机器可读输出（stdout 为 JSON，日志走 stderr）
pnpm starlists <user> --json > result.json

# 每个清单最多展示 50 项
pnpm starlists <user> --top 50 --sort starred

# 复用上次的 data.json 重新渲染，不联网
pnpm starlists --input out/<user>/data.json --out out/offline

# 分类引擎：端侧小模型 / 大模型（OpenAI 兼容接口）
pnpm starlists <user> --engine edge --engine-model qwen2.5:3b
pnpm starlists <user> --engine large --engine-model deepseek-chat

# 同步到 GitHub Lists：先 dry-run，再真正写入
pnpm starlists <you> --publish --publish-dry-run
pnpm starlists <you> --publish --yes
```

### 参数

| 参数 | 说明 | 默认 |
|:--|:--|:--|
| `[username]` | GitHub 用户名；使用 `--input` 时可省略 | — |
| `-o, --out <dir>` | 输出目录 | `out/<username>` |
| `--token <token>` | GitHub token；默认读 `GITHUB_TOKEN` → `GH_TOKEN` → `gh auth token` | — |
| `--deep` | 开启 manifest / README 深度分析 | 关闭 |
| `--engine <name>` | 分类引擎：`rules` / `edge` / `large` | `rules` |
| `--engine-base-url <url>` | 模型引擎的 OpenAI 兼容地址 | 引擎默认 |
| `--engine-model <model>` | 模型名 | 引擎默认 |
| `--engine-api-key <key>` | 模型 API key | 环境变量 |
| `--engine-batch-size <n>` | 每次请求分类多少个仓库 | `20` |
| `--engine-concurrency <n>` | 模型引擎并发批次数 | edge 1 / large 2 |
| `--engine-timeout <seconds>` | 单次模型请求超时秒数 | `120` |
| `--deep-max <n>` | 深度分析最多分析多少个仓库 | `300` |
| `--concurrency <n>` | 深度分析并发数（1–16） | `4` |
| `--since <date>` | 只保留该日期之后 star 的项目 | — |
| `--limit <n>` | 只处理前 N 个 star（调试用，不写缓存） | — |
| `--min-stars <n>` | 只保留 star 数 ≥ N 的项目 | `0` |
| `--exclude-forks` | 排除 fork | 保留 |
| `--exclude-archived` | 排除已归档 | 保留 |
| `--cache-ttl <hours>` | Star 列表缓存时长 | `12` |
| `--no-cache` | 禁用缓存 | — |
| `--refresh` | 忽略缓存重新拉取 | — |
| `--input <file>` | 从 fixture / `data.json` 离线读取 | — |
| `--json` | 输出完整 JSON 到 stdout | — |
| `-q, --quiet` | 只输出错误 | — |
| `--sort <mode>` | `stars` / `name` / `starred` | `stars` |
| `--top <n>` | 每个清单最多展示 N 项，0 为全部 | `0` |
| `--publish` | 同步为 GitHub Lists | — |
| `--publish-dry-run` | 只展示同步计划，不写入 | — |
| `--replace-lists` | 覆盖仓库已有列表归属（默认合并保留） | — |
| `--skip-levels <levels>` | 同步时跳过层级，如 `resource,unclassified` | — |
| `-y, --yes` | 跳过发布确认 | — |

## 同步到 GitHub Lists

GitHub 的 star lists 目前只有 **GraphQL** 接口（REST 没有），且：

- **Lists 属于 token 对应的账号（viewer）**。程序会校验 `viewer.login === username`，不能替别人整理 star。
- **创建 / 修改需要 `user` scope**，仅有 `repo` 不够。

```bash
# 用 gh 补 scope（会打开浏览器）
gh auth refresh -h github.com -s user

# 或者使用带 user scope 的 classic PAT
export GITHUB_TOKEN=ghp_xxx
```

然后：

```bash
# 1. 预览：会创建哪些列表、更新哪些仓库
pnpm starlists <you> --publish --publish-dry-run

# 2. 正式写入（默认保留仓库已有的其它列表，只增量添加目标列表）
pnpm starlists <you> --publish --yes

# 3. 如果希望列表归属严格等于本次分类（会移除手工加入的其它列表）
pnpm starlists <you> --publish --replace-lists --yes

# 4. 不想要「资源与模板」「待归类」两个列表
pnpm starlists <you> --publish --skip-levels resource,unclassified --yes
```

实现细节：

- 列表名使用 `🧩 内核与系统底层` 这样的固定名称；同名列表会被复用，不会重复创建。
- 使用 `updateUserListsForItem` 一次性设置某个仓库的列表集合；默认先读取现有归属做并集，保证不破坏手工整理。
- 未变化（集合相同）的仓库不会发请求；失败会记录，最终以退出码 1 结束。
- 列表成员查询按 100 个分页，避免超过 100 项时静默截断。
- 删除 GitHub List 不会取消 star；`--replace-lists` 只改变分类归属。

> 隐私提醒：`out/` 和 `data.json` 可能包含你 star 的私有仓库名称。仓库的 `.gitignore` 已忽略 `out/`，分享前请自行检查。

## 缓存与限流

- Star 列表缓存：`.cache/star-lists/stars/`，默认 12 小时。
- 深度分析缓存：`.cache/star-lists/deep/`，默认 7 天，以 `deep:v2:owner/name@pushed_at` 为键（规则升级后会自动失效）。
- 使用 `--refresh` 强制刷新，`--no-cache` 完全禁用，`--cache-ttl 0` 等价于总是过期。
- API 返回 `403 + X-RateLimit-Remaining: 0` 时会给出重置时间；429 / 5xx 自动退避重试（最多 3 次）。
- GraphQL 的 `RATE_LIMITED` / secondary rate limit 会在同步时退避重试。

## 离线数据格式

`--input` 接受三种形式：

```jsonc
// 1) 完整 Dataset（本工具生成的 data.json）
{ "username": "demo", "profile": {}, "repos": [{ "repo": {...}, "signals": {...} }], ... }

// 2) 简化 fixture
{ "username": "demo", "repos": [{ "full_name": "torvalds/linux", "description": "...", "topics": [], "stargazers_count": 1 }] }

// 3) 仓库数组
[{ "full_name": "owner/repo", "description": "..." }]
```

仓库字段兼容 GitHub REST API 的 snake_case（`full_name`、`stargazers_count`、`node_id`…）。如果想在没有网络时模拟深度分析，可在条目上附加 `signals`（结构见 `src/types.ts` 的 `DeepSignals`），`fixtures/stars.demo.json` 有完整示例。

## 开发

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest 单元测试
pnpm build       # 输出 dist/
pnpm demo        # 离线生成演示清单
```

```text
src/
├── cli.ts            # 命令行入口
├── pipeline.ts       # 拉取 → 过滤 → 初分类 → 深度分析 → 终分类
├── engine.ts         # 模型分类引擎（OpenAI 兼容接口）
├── github.ts         # REST / GraphQL / raw 客户端，分页与限流
├── auth.ts           # token 发现
├── cache.ts          # 文件缓存
├── classify.ts       # 打分、置信度、待复核
├── anchors.ts        # 知名仓库锚点
├── rules.ts          # topics / 名称 / 描述规则
├── manifests.ts      # manifest / README 解析与深度信号
├── deep.ts           # 文件树抓取与深度分析编排
├── manual.ts         # 人工分类应用
├── publish.ts        # GitHub Lists 同步
├── output.ts         # 写文件与清理旧清单
├── render/
│   ├── markdown.ts   # README / 清单 / review / JSON
│   └── console.ts    # 终端摘要
├── web/
│   └── server.ts     # 本地 Web UI API + 静态服务
└── types.ts
web/                  # index.html / app.js / styles.css
tests/                # 分类器、解析器、分页、缓存、渲染、发布、流水线、引擎、Web
fixtures/             # 离线演示数据
```

## 已知限制

- 分类是**启发式**的，不保证 100% 准确；仓库描述缺失、topics 随意、README 写法差异都会影响结果。低置信度项目请以 `review.md` 为准人工确认。
- 一个仓库只进入一个列表（单归属），但 GitHub Lists 本身支持多归属；需要多归属时可手工追加。
- 深度分析对大仓库（如 Linux 内核）的文件树可能被 GitHub 截断，只分析根目录可见的 manifest。
- 私有仓库会跳过深度分析（raw 文件不可匿名读取）；公开 star 数据可正常读取。
- 匿名模式不适合大 star 列表；请配置 token。
- 模型引擎依赖外部 OpenAI 兼容接口：端侧小模型的 JSON 能力有限，远程大模型会产生费用和隐私风险；解析失败/漏返回会自动回退规则引擎，并写入 `warnings`。
- GitHub Lists 的字段与 scope 要求可能随 GitHub 调整；如遇 schema 变化，请更新 `src/publish.ts` 中的查询。

## License

[MIT](./LICENSE)
