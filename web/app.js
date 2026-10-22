window.addEventListener('error', (event) => {
  const banner = document.getElementById('banner');
  if (banner) {
    banner.textContent = `页面脚本错误：${event.message}`;
    banner.className = 'banner error';
  }
});
window.addEventListener('unhandledrejection', (event) => {
  const banner = document.getElementById('banner');
  if (banner) {
    banner.textContent = `请求失败：${event.reason?.message ?? event.reason}`;
    banner.className = 'banner error';
  }
});

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  levels: [],
  datasets: [],
  dataset: null,
  dir: '',
  revision: '',
  original: new Map(),
  changes: new Map(),
  confirmations: new Set(),
  filter: 'all',
  query: '',
  detailName: null,
  busy: false,
  pollTimer: null,
  toastTimer: null,
};

const el = {
  app: $('#app'),
  sidebarToggle: $('#sidebar-toggle'),
  analyzeForm: $('#analyze-form'),
  analyzeBtn: $('#analyze-btn'),
  jobStatus: $('#job-status'),
  engine: $('#engine'),
  engineConfig: $('#engine-config'),
  engineBaseUrl: $('#engineBaseUrl'),
  engineModel: $('#engineModel'),
  engineApiKey: $('#engineApiKey'),
  datasetSelect: $('#dataset-select'),
  datasetMeta: $('#dataset-meta'),
  reloadDatasets: $('#reload-datasets'),
  title: $('#title'),
  subtitle: $('#subtitle'),
  stats: $('#stats'),
  board: $('#board'),
  search: $('#search'),
  filter: $('#filter'),
  visibleCount: $('#visible-count'),
  saveBtn: $('#save-btn'),
  unsavedCount: $('#unsaved-count'),
  download: $('#download'),
  banner: $('#banner'),
  publishBtn: $('#publish-btn'),
  publishReport: $('#publish-report'),
  skipLevels: $('#skip-levels'),
  detailDialog: $('#detail-dialog'),
  detailTitle: $('#detail-title'),
  detailLink: $('#detail-link'),
  detailDesc: $('#detail-desc'),
  detailMeta: $('#detail-meta'),
  detailEvidence: $('#detail-evidence'),
  detailLevel: $('#detail-level'),
  detailConfirm: $('#detail-confirm'),
  toast: $('#toast'),
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatStars(stars) {
  if (stars >= 1000) {
    const value = stars / 1000;
    return `${value >= 10 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(stars ?? 0);
}

function levelMeta(id) {
  return state.levels.find((level) => level.id === id);
}

function labelOf(id) {
  const meta = levelMeta(id);
  return meta ? `${meta.emoji} ${meta.zh}` : id;
}

function toast(message, kind = '') {
  el.toast.textContent = message;
  el.toast.className = `toast ${kind}`;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 3200);
}

function showBanner(message, kind = '') {
  if (!message) {
    el.banner.classList.add('hidden');
    el.banner.textContent = '';
    return;
  }
  el.banner.textContent = message;
  el.banner.className = `banner ${kind}`;
}

const SIDEBAR_PREF_KEY = 'starlists.sidebarCollapsed';

function readSidebarPref() {
  try {
    return localStorage.getItem(SIDEBAR_PREF_KEY) === '1';
  } catch {
    return false;
  }
}

function setSidebarCollapsed(collapsed, persist = true) {
  el.app.classList.toggle('sidebar-collapsed', collapsed);
  el.sidebarToggle.textContent = collapsed ? '»' : '«';
  el.sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  el.sidebarToggle.setAttribute('aria-label', collapsed ? '展开侧栏' : '收起侧栏');
  el.sidebarToggle.title = collapsed ? '展开侧栏' : '收起侧栏';
  if (persist) {
    try {
      localStorage.setItem(SIDEBAR_PREF_KEY, collapsed ? '1' : '0');
    } catch {
      // 浏览器禁用存储时仅本次生效
    }
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error = new Error(data?.error || `请求失败（${response.status}）`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function pendingCount() {
  return state.changes.size + state.confirmations.size;
}

function setBusy(busy) {
  state.busy = busy;
  el.analyzeBtn.disabled = busy;
  el.publishBtn.disabled = busy;
  el.saveBtn.disabled = busy || pendingCount() === 0;
}

function setJob(message, isError = false) {
  if (!message) {
    el.jobStatus.classList.add('hidden');
    return;
  }
  el.jobStatus.textContent = message;
  el.jobStatus.className = `job-status ${isError ? 'error' : ''}`;
}

function buildLevelSelect(selected, className = '') {
  const select = document.createElement('select');
  if (className) select.className = className;
  for (const level of state.levels) {
    const option = document.createElement('option');
    option.value = level.id;
    option.textContent = `${level.emoji} ${level.zh}`;
    option.selected = level.id === selected;
    select.append(option);
  }
  return select;
}

function manualEvidence(level) {
  return {
    level,
    weight: 100,
    reason: '人工手动分类（未保存）',
    source: 'manual',
  };
}

function applyLocalLevel(name, level, renderNow = true) {
  const item = state.dataset?.repos.find((repo) => repo.repo.nameWithOwner === name);
  if (!item) return;
  const original = state.original.get(name);
  if (!original) return;
  item.level = level;
  item.confidence = 1;
  item.needsReview = false;
  item.runnerUp = original.level !== level ? original.level : original.runnerUp;
  item.evidence = [
    manualEvidence(level),
    ...original.evidence.filter((entry) => entry.source !== 'manual'),
  ].slice(0, 16);
  if (original.level === level) {
    state.changes.delete(name);
    state.confirmations.delete(name);
    // 回退到原始对象，避免残留“未保存”证据
    const index = state.dataset.repos.indexOf(item);
    if (index >= 0) state.dataset.repos[index] = structuredClone(original);
  } else {
    state.changes.set(name, level);
    state.confirmations.delete(name);
  }
  if (renderNow) render();
}

/** 复核确认：层级不变，只标记为已复核并写入待保存的人工证据。 */
function applyLocalConfirmation(name, renderNow = true) {
  const item = state.dataset?.repos.find((repo) => repo.repo.nameWithOwner === name);
  const original = state.original.get(name);
  if (!item || !original || !item.needsReview || item.level !== original.level) return;
  item.confidence = 1;
  item.needsReview = false;
  item.evidence = [
    {
      level: item.level,
      weight: 100,
      reason: '人工复核确认（未保存）',
      source: 'manual',
    },
    ...original.evidence.filter(
      (entry) => !(entry.source === 'manual' && entry.reason.startsWith('人工复核确认')),
    ),
  ].slice(0, 16);
  state.changes.delete(name);
  state.confirmations.add(name);
  if (renderNow) render();
}

/** 重新套用一批待保存的人工分类；数据集中已不存在的项继续留在 changes 里。 */
function reapplyPending(pending) {
  for (const [name, level] of pending) {
    const exists = state.dataset?.repos.some((item) => item.repo.nameWithOwner === name);
    if (exists) applyLocalLevel(name, level, false);
    else state.changes.set(name, level);
  }
}

/** 重新套用一批待保存的复核确认；已不在待复核状态的项自动丢弃。 */
function reapplyPendingConfirmations(pending) {
  for (const name of pending) {
    const exists = state.dataset?.repos.some((item) => item.repo.nameWithOwner === name);
    if (exists) applyLocalConfirmation(name, false);
    else state.confirmations.add(name);
  }
}

function confirmDiscardUnsaved(action) {
  const pending = pendingCount();
  if (pending === 0) return true;
  return window.confirm(
    `当前有 ${pending} 个未保存的人工修改，${action}会丢失这些修改。继续？`,
  );
}

function openDetail(name) {
  const item = state.dataset?.repos.find((repo) => repo.repo.nameWithOwner === name);
  if (!item) return;
  state.detailName = name;
  el.detailTitle.textContent = name;
  el.detailLink.textContent = item.repo.url;
  el.detailLink.href = item.repo.url;
  el.detailDesc.textContent = item.repo.description || '（无描述）';
  el.detailMeta.replaceChildren();
  const pills = [
    `⭐ ${formatStars(item.repo.stars)}`,
    item.repo.language || '未知语言',
    `${Math.round(item.confidence * 100)}%`,
    item.needsReview ? '待复核' : '已确认',
    ...(item.repo.topics ?? []).slice(0, 8),
  ];
  for (const text of pills) {
    const span = document.createElement('span');
    span.className = 'pill';
    span.textContent = text;
    el.detailMeta.append(span);
  }
  el.detailLevel.replaceChildren();
  const select = buildLevelSelect(item.level);
  for (const option of [...select.options]) el.detailLevel.append(option);
  el.detailEvidence.replaceChildren();
  for (const evidence of item.evidence) {
    const li = document.createElement('li');
    const head = document.createElement('div');
    head.className = 'ev-head';
    head.textContent = `${labelOf(evidence.level)} · ${evidence.source} · ${evidence.weight}`;
    const reason = document.createElement('div');
    reason.textContent = evidence.reason;
    li.append(head, reason);
    el.detailEvidence.append(li);
  }
  el.detailConfirm.disabled = !item.needsReview;
  el.detailConfirm.title = item.needsReview
    ? '保持当前层级，标记为已复核'
    : '当前分类无需复核';
  el.detailDialog.showModal();
}

function createCard(item) {
  const name = item.repo.nameWithOwner;
  const changed = state.changes.has(name);
  const isManual = changed || item.evidence.some((entry) => entry.source === 'manual');
  const card = document.createElement('article');
  card.className = `card${changed ? ' changed' : ''}${item.needsReview ? ' review' : ''}${isManual ? ' manual' : ''}`;
  card.draggable = true;
  card.dataset.name = name;

  const top = document.createElement('div');
  top.className = 'card-top';
  const nameEl = document.createElement('div');
  nameEl.className = 'card-name';
  nameEl.textContent = name;
  const stars = document.createElement('div');
  stars.className = 'card-stars';
  stars.textContent = `⭐ ${formatStars(item.repo.stars)}`;
  top.append(nameEl, stars);

  const desc = document.createElement('p');
  desc.className = 'card-desc';
  desc.textContent = item.repo.description || '（无描述）';

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  const lang = document.createElement('span');
  lang.className = 'pill';
  lang.textContent = item.repo.language || '未知';
  const confidence = document.createElement('span');
  confidence.className = 'pill conf';
  confidence.textContent = `${Math.round(item.confidence * 100)}%`;
  meta.append(lang, confidence);
  if (item.needsReview) {
    const review = document.createElement('span');
    review.className = 'pill review';
    review.textContent = '待复核';
    meta.append(review);
  }
  if (isManual) {
    const manual = document.createElement('span');
    manual.className = 'pill manual';
    manual.textContent = '人工';
    meta.append(manual);
  }
  if (item.repo.archived) {
    const archived = document.createElement('span');
    archived.className = 'pill';
    archived.textContent = '已归档';
    meta.append(archived);
  }

  const actions = document.createElement('div');
  actions.className = 'card-actions';
  const select = buildLevelSelect(item.level);
  select.addEventListener('click', (event) => event.stopPropagation());
  select.addEventListener('change', (event) => {
    event.stopPropagation();
    applyLocalLevel(name, select.value);
  });
  actions.append(select);

  card.append(top, desc, meta, actions);
  card.addEventListener('click', () => openDetail(name));
  card.addEventListener('dragstart', (event) => {
    event.dataTransfer.setData('text/plain', name);
    event.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
  return card;
}

function visibleRepos() {
  if (!state.dataset) return [];
  const query = state.query.trim().toLowerCase();
  return state.dataset.repos.filter((item) => {
    const manual = state.changes.has(item.repo.nameWithOwner) || item.evidence.some((entry) => entry.source === 'manual');
    if (state.filter === 'review' && !item.needsReview) return false;
    if (state.filter === 'manual' && !manual) return false;
    if (!query) return true;
    const haystack = [
      item.repo.nameWithOwner,
      item.repo.description ?? '',
      item.repo.language ?? '',
      ...(item.repo.topics ?? []),
    ].join(' ').toLowerCase();
    return haystack.includes(query);
  });
}

function renderStats() {
  el.stats.replaceChildren();
  if (!state.dataset) return;
  const repos = state.dataset.repos;
  const unclassified = repos.filter((item) => item.level === 'unclassified').length;
  const review = repos.filter((item) => item.needsReview).length;
  const manual = repos.filter((item) => item.evidence.some((entry) => entry.source === 'manual')).length;
  const stats = [
    ['总计', repos.length, ''],
    ['已归类', repos.length - unclassified, 'ok'],
    ['待复核', review, 'warn'],
    ['人工', manual, 'accent'],
  ];
  for (const [label, value, kind] of stats) {
    const span = document.createElement('span');
    span.className = `stat ${kind}`;
    const strong = document.createElement('strong');
    strong.textContent = String(value);
    const text = document.createElement('span');
    text.textContent = label;
    span.append(strong, text);
    el.stats.append(span);
  }
  if (state.dataset.engine && state.dataset.engine !== 'rules') {
    const engine = document.createElement('span');
    engine.className = 'stat accent';
    engine.textContent = `引擎：${state.dataset.engine === 'edge' ? '端侧小模型' : '大模型'}`;
    el.stats.append(engine);
  }
}

function renderBoard() {
  const items = visibleRepos();
  el.board.replaceChildren();
  if (!state.dataset) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '还没有加载数据。左侧点击「开始分析」，或选择已有数据集。';
    el.board.append(empty);
    el.visibleCount.textContent = '';
    return;
  }
  el.visibleCount.textContent = `显示 ${items.length} / ${state.dataset.repos.length}`;
  for (const level of state.levels) {
    const column = document.createElement('section');
    column.className = 'column';
    column.dataset.level = level.id;
    const head = document.createElement('div');
    head.className = 'column-head';
    const title = document.createElement('div');
    title.className = 'column-title';
    title.textContent = `${level.emoji} ${level.zh}`;
    const count = document.createElement('span');
    count.className = 'column-count';
    count.textContent = String(items.filter((item) => item.level === level.id).length);
    head.append(title, count);
    const body = document.createElement('div');
    body.className = 'column-body';
    const list = items
      .filter((item) => item.level === level.id)
      .sort((a, b) => b.repo.stars - a.repo.stars);
    for (const item of list) body.append(createCard(item));
    column.append(head, body);
    column.addEventListener('dragover', (event) => {
      event.preventDefault();
      column.classList.add('drag-over');
    });
    column.addEventListener('dragleave', () => column.classList.remove('drag-over'));
    column.addEventListener('drop', (event) => {
      event.preventDefault();
      column.classList.remove('drag-over');
      const name = event.dataTransfer.getData('text/plain');
      if (name) applyLocalLevel(name, level.id);
    });
    el.board.append(column);
  }
}

function renderMeta() {
  if (!state.dataset) {
    el.datasetMeta.textContent = '尚未加载数据集';
    return;
  }
  const dataset = state.dataset;
  el.datasetMeta.innerHTML = `
    <div><strong>${escapeHtml(dataset.username)}</strong> · ${dataset.totalAnalyzed} 个仓库</div>
    <div>${escapeHtml(state.dir)}</div>
    <div>抓取：${escapeHtml(dataset.fetchedAt?.slice(0, 16).replace('T', ' ') ?? '—')}</div>
  `;
}

function renderActions() {
  const hasData = Boolean(state.dataset);
  const pending = pendingCount();
  el.saveBtn.disabled = state.busy || !hasData || pending === 0;
  el.unsavedCount.textContent = pending ? `(${pending})` : '';
  el.download.classList.toggle('disabled', !hasData);
  el.download.href = hasData ? `/api/export?dir=${encodeURIComponent(state.dir)}` : '#';
}

function render() {
  renderStats();
  renderMeta();
  renderActions();
  renderBoard();
  if (state.dataset) {
    el.title.textContent = `@${state.dataset.username}`;
    const engine = state.dataset.engine && state.dataset.engine !== 'rules'
      ? ` · 引擎 ${state.dataset.engine === 'edge' ? '端侧小模型' : '大模型'}`
      : '';
    el.subtitle.textContent = `${state.dataset.totalAnalyzed} 个仓库 · ${state.dir}${engine}`;
  }
}

async function loadDatasets() {
  const data = await api('/api/datasets');
  state.datasets = data.datasets ?? [];
  el.datasetSelect.replaceChildren();
  if (state.datasets.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '（out/ 下没有数据集）';
    el.datasetSelect.append(option);
    return;
  }
  for (const dataset of state.datasets) {
    const option = document.createElement('option');
    option.value = dataset.dir;
    option.textContent = `${dataset.dir} · ${dataset.username} · ${dataset.totalAnalyzed}`;
    el.datasetSelect.append(option);
  }
  const preferred = state.datasets.find((dataset) => dataset.dir === 'out/Core2002') ?? state.datasets[0];
  if (preferred) {
    el.datasetSelect.value = preferred.dir;
    if (!state.dataset) await loadDataset(preferred.dir);
  }
}

async function loadDataset(dir, options = {}) {
  if (!dir) return false;
  try {
    const data = await api(`/api/dataset?dir=${encodeURIComponent(dir)}`);
    const { revision, ...dataset } = data;
    const pending = options.preserveChanges ? new Map(state.changes) : new Map();
    const pendingConfirmations = options.preserveChanges
      ? new Set(state.confirmations)
      : new Set();
    state.dataset = dataset;
    state.dir = dir;
    state.revision = typeof revision === 'string' ? revision : '';
    state.original = new Map(
      dataset.repos.map((item) => [item.repo.nameWithOwner, structuredClone(item)]),
    );
    state.changes.clear();
    state.confirmations.clear();
    reapplyPending(pending);
    reapplyPendingConfirmations(pendingConfirmations);
    showBanner('');
    el.datasetSelect.value = dir;
    render();
    return true;
  } catch (error) {
    // 加载失败时让下拉框回到真正的当前数据集
    if (state.dir) el.datasetSelect.value = state.dir;
    toast(error.message, 'error');
    return false;
  }
}

async function saveManual() {
  if (!state.dataset || pendingCount() === 0) return;
  const sent = new Map(state.changes);
  const sentConfirmations = new Set(state.confirmations);
  const levels = new Map(
    state.dataset.repos.map((item) => [item.repo.nameWithOwner, item.level]),
  );
  const changes = [
    ...[...sent.entries()].map(([nameWithOwner, level]) => ({ nameWithOwner, level })),
    ...[...sentConfirmations].map((nameWithOwner) => ({
      nameWithOwner,
      level: levels.get(nameWithOwner) ?? 'unclassified',
      reviewed: true,
    })),
  ];
  setBusy(true);
  try {
    const result = await api('/api/reclassify', {
      method: 'POST',
      body: JSON.stringify({ dir: state.dir, changes, revision: state.revision }),
    });
    const missing = new Set(result.missing ?? []);
    // 保存请求发出后看板仍可操作，这里记录请求返回时的本地意图。
    const desired = new Map(
      state.dataset.repos.map((item) => [item.repo.nameWithOwner, item.level]),
    );
    const desiredConfirmations = new Set(state.confirmations);
    const savedLevels = new Map(
      result.dataset.repos.map((item) => [item.repo.nameWithOwner, item.level]),
    );
    // 只移除“已提交且请求期间没再被改”的项；请求期间的新修改、服务端未找到的项继续留在 pending。
    const pending = new Map();
    for (const [name, level] of state.changes) {
      if (missing.has(name) || sent.get(name) !== level) pending.set(name, level);
    }
    // 请求期间被改回先前层级的项：本地意图与刚保存的结果不同，也要保留。
    for (const name of sent.keys()) {
      if (pending.has(name) || state.changes.has(name)) continue;
      const local = desired.get(name);
      const saved = savedLevels.get(name);
      if (local && saved && local !== saved) pending.set(name, local);
    }
    // 请求期间新增的复核确认继续保留；服务端未找到的确认也保留。
    const pendingConfirmations = new Set();
    for (const name of desiredConfirmations) {
      if (!sentConfirmations.has(name) && !pending.has(name)) pendingConfirmations.add(name);
    }
    for (const name of sentConfirmations) {
      if (missing.has(name)) pendingConfirmations.add(name);
    }
    state.dataset = result.dataset;
    state.revision = typeof result.revision === 'string' ? result.revision : state.revision;
    state.original = new Map(
      result.dataset.repos.map((item) => [item.repo.nameWithOwner, structuredClone(item)]),
    );
    state.changes.clear();
    state.confirmations.clear();
    reapplyPending(pending);
    reapplyPendingConfirmations(pendingConfirmations);
    toast(`已保存 ${result.changed} 项变更`, 'ok');
    if (result.missing?.length) {
      showBanner(`有 ${result.missing.length} 个仓库未找到，修改仍保留在待保存列表：${result.missing.join(', ')}`);
    } else if (pendingCount() > 0) {
      showBanner(`保存期间又有 ${pendingCount()} 个修改，尚未保存。`);
    } else {
      showBanner('');
    }
    render();
  } catch (error) {
    if (error.status === 409) {
      // 其他窗口改过数据：重新加载并把本地待保存的修改重新套用，避免静默覆盖。
      const reloaded = await loadDataset(state.dir, { preserveChanges: true });
      showBanner(
        reloaded
          ? '数据已被其他窗口或进程修改，已重新加载；你的修改仍在待保存列表中。'
          : '数据已被其他窗口或进程修改，自动重新加载失败，请手动刷新页面。',
        'error',
      );
    }
    toast(error.message, 'error');
  } finally {
    setBusy(false);
    renderActions();
  }
}

function collectEngineConfig() {
  const engine = el.engine.value;
  if (engine === 'rules') return { engine };
  return {
    engine,
    engineBaseUrl: el.engineBaseUrl.value.trim(),
    engineModel: el.engineModel.value.trim(),
    engineApiKey: el.engineApiKey.value.trim(),
    engineBatchSize: $('#engineBatchSize').value,
    engineConcurrency: $('#engineConcurrency').value,
  };
}

async function startAnalyze(event) {
  event.preventDefault();
  if (state.busy) return;
  if (!confirmDiscardUnsaved('重新分析')) return;
  const username = $('#username').value.trim();
  const input = $('#input').value.trim();
  if (!username && !input) {
    showBanner('请填写 GitHub 用户名，或提供本地 data.json 路径。', 'error');
    return;
  }
  const body = {
    username,
    input,
    deep: $('#deep').checked,
    deepMax: $('#deepMax').value,
    minStars: $('#minStars').value,
    since: $('#since').value,
    limit: $('#limit').value,
    excludeForks: $('#excludeForks').checked,
    excludeArchived: $('#excludeArchived').checked,
    refresh: $('#refresh').checked,
    noCache: $('#noCache').checked,
    token: $('#token').value.trim(),
    ...collectEngineConfig(),
  };
  setBusy(true);
  setJob('正在启动分析…');
  showBanner('');
  try {
    const { jobId } = await api('/api/analyze', { method: 'POST', body: JSON.stringify(body) });
    await pollJob(jobId, 'analyze');
  } catch (error) {
    setJob(error.message, true);
    setBusy(false);
  }
}

async function pollJob(jobId, kind) {
  clearInterval(state.pollTimer);
  return new Promise((resolve) => {
    const tick = async () => {
      try {
        const job = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
        setJob(job.message || '处理中…', job.state === 'error');
        if (job.state === 'running') return;
        clearInterval(state.pollTimer);
        setBusy(false);
        if (job.state === 'error') {
          setJob(job.error || '任务失败', true);
          toast(job.error || '任务失败', 'error');
          resolve();
          return;
        }
        if (kind === 'analyze') {
          setJob('分析完成，正在加载结果…');
          if (!confirmDiscardUnsaved('载入分析结果')) {
            showBanner(
              `分析已完成并写入 ${job.result?.outDir ?? 'out/'}；当前未保存的修改已保留，切换数据集后可查看结果。`,
            );
            setJob('分析完成（结果未载入）');
            resolve();
            return;
          }
          await loadDatasets();
          if (job.result?.outDir) await loadDataset(job.result.outDir);
          const warnings = job.result?.warnings ?? [];
          if (warnings.length) showBanner(warnings.join(' · '));
          setJob(
            `完成：${job.result?.totalAnalyzed ?? 0} 个仓库，引擎 ${job.result?.engine ?? 'rules'}`,
          );
        } else {
          el.publishReport.textContent = JSON.stringify(job.result, null, 2);
          el.publishReport.classList.remove('hidden');
          setJob('发布任务完成');
          toast('发布任务完成', 'ok');
        }
        resolve();
      } catch (error) {
        clearInterval(state.pollTimer);
        setBusy(false);
        setJob(error.message, true);
        toast(error.message, 'error');
        resolve();
      }
    };
    tick();
    state.pollTimer = setInterval(tick, 900);
  });
}

async function publish() {
  if (!state.dataset || state.busy) return;
  const dryRun = $('#publish-dry-run').checked;
  if (!dryRun && !window.confirm('即将写入 GitHub Lists，可能修改/删除仓库的列表归属。确认继续？')) return;
  const skipLevels = $$('#skip-levels input:checked').map((input) => input.value);
  setBusy(true);
  setJob(dryRun ? '正在生成发布预览…' : '正在发布…');
  try {
    const { jobId } = await api('/api/publish', {
      method: 'POST',
      body: JSON.stringify({
        dir: state.dir,
        token: $('#token').value.trim(),
        dryRun,
        confirm: !dryRun,
        replaceLists: $('#replace-lists').checked,
        skipLevels,
      }),
    });
    await pollJob(jobId, 'publish');
  } catch (error) {
    setJob(error.message, true);
    setBusy(false);
  }
}

function syncEngineConfig() {
  const engine = el.engine.value;
  el.engineConfig.classList.toggle('hidden', engine === 'rules');
  if (engine === 'edge') {
    if (!el.engineBaseUrl.value) el.engineBaseUrl.value = 'http://127.0.0.1:11434/v1';
    if (!el.engineModel.value) el.engineModel.value = 'qwen2.5:3b';
  }
  if (engine === 'large') {
    el.engineBaseUrl.placeholder = 'https://api.deepseek.com/v1';
    el.engineModel.placeholder = 'deepseek-chat';
  }
}

function bind() {
  el.sidebarToggle.addEventListener('click', () => {
    setSidebarCollapsed(!el.app.classList.contains('sidebar-collapsed'));
  });
  el.analyzeForm.addEventListener('submit', startAnalyze);
  el.engine.addEventListener('change', syncEngineConfig);
  el.saveBtn.addEventListener('click', saveManual);
  el.reloadDatasets.addEventListener('click', () => loadDatasets().catch((error) => toast(error.message, 'error')));
  el.datasetSelect.addEventListener('change', () => {
    const next = el.datasetSelect.value;
    if (!next || next === state.dir) return;
    if (!confirmDiscardUnsaved('切换数据集')) {
      el.datasetSelect.value = state.dir;
      return;
    }
    loadDataset(next);
  });
  el.search.addEventListener('input', () => {
    state.query = el.search.value;
    renderBoard();
  });
  el.filter.addEventListener('change', () => {
    state.filter = el.filter.value;
    renderBoard();
  });
  el.publishBtn.addEventListener('click', publish);
  el.detailConfirm.addEventListener('click', () => {
    if (!state.detailName) return;
    applyLocalConfirmation(state.detailName);
    el.detailDialog.close();
    toast('已标记为复核确认，请点击顶部「保存人工分类」写入');
  });
  $('#detail-save').addEventListener('click', (event) => {
    event.preventDefault();
    if (!state.detailName) return;
    applyLocalLevel(state.detailName, el.detailLevel.value);
    el.detailDialog.close();
  });
  el.detailDialog.addEventListener('click', (event) => {
    if (event.target === el.detailDialog) el.detailDialog.close();
  });
}

function buildSkipLevels() {
  el.skipLevels.replaceChildren();
  for (const level of state.levels) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = level.id;
    const text = document.createElement('span');
    text.textContent = `${level.emoji} ${level.zh}`;
    label.append(input, text);
    el.skipLevels.append(label);
  }
}

async function init() {
  bind();
  setSidebarCollapsed(readSidebarPref(), false);
  syncEngineConfig();
  try {
    const data = await api('/api/levels');
    state.levels = data.levels ?? [];
    buildSkipLevels();
    await loadDatasets();
    render();
  } catch (error) {
    showBanner(`无法连接服务：${error.message}`, 'error');
    toast(error.message, 'error');
  }
}

await init();
