import { useCallback, useEffect, useState } from 'react';
import { createProject } from '../domain/project.ts';
import { ProjectStore, type ProjectSummary } from '../persistence/project-store.ts';
import '../styles/62-projects.css';

const pad = (value: number) => String(value).padStart(2, '0');

// 时间戳统一成 2026-10-23 02:30 这种紧凑口径；不用 toLocaleString，
// 避免不同浏览器 / 语言环境产出不同格式。
const stamp = (iso?: string) => {
  if (!iso) return '没有记录时间';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '没有记录时间';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const initialOf = (name: string) => {
  const trimmed = name.trim();
  return trimmed ? Array.from(trimmed)[0].toUpperCase() : '画';
};

// Local project list. Single view by design: no team, no sharing, no search.
export function ProjectList() {
  const [store] = useState(() => new ProjectStore());
  const [rows, setRows] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState('');
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try { setRows(await store.list()); } catch (reason) { setError(String(reason)); }
  }, [store]);

  useEffect(() => { void refresh(); }, [refresh]);

  const open = (id: string) => { location.href = `/?project=${encodeURIComponent(id)}`; };

  const createNew = async () => {
    setBusy(true);
    try {
      const project = createProject();
      await store.save(project, null);
      open(project.id);
    } catch (reason) { setError(String(reason)); setBusy(false); }
  };

  const rename = async (row: ProjectSummary) => {
    const next = (names[row.id] ?? row.name).trim();
    if (!next || next === row.name) { setNames(current => ({ ...current, [row.id]: row.name })); return; }
    setSaving(true);
    try {
      const loaded = await store.load(row.id);
      if (!loaded) throw new Error('Project is no longer stored.');
      await store.save({ ...loaded, name: next }, loaded.revision);
      await refresh();
    } catch (reason) { setError(String(reason)); } finally { setSaving(false); }
  };

  return <div className="projects">
    <header className="masthead projects-masthead">
      <a className="wordmark projects-brand" href="/">flowforge<span>项目</span></a>
      <span className="save-state" role="status" data-testid="list-status">{saving ? '正在重命名 / 保存' : '本地列表就绪'}</span>
      <button className="primary projects-new" onClick={() => void createNew()} disabled={busy} aria-label="New project">新建项目 <span>＋</span></button>
    </header>
    <section className="projects-head">
      <div className="projects-head-copy">
        <span className="eyebrow">本地项目 · 只在这台机器</span>
        <h1>我的项目</h1>
      </div>
      <p>所有项目都只存在这个浏览器的本地数据库中。<em>没有账号、没有团队、不同步。</em></p>
    </section>
    <main className="projects-body">
      {error && <p className="error" role="alert">{error}</p>}
      {rows === null ? <p className="muted projects-loading">正在读取本地数据…</p> : rows.length === 0
        ? <div className="projects-empty-card" data-testid="projects-empty">
            <span className="projects-empty-icon" aria-hidden="true">
              <svg viewBox="0 0 32 32" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.4">
                <rect x="4" y="6" width="24" height="20" rx="4" />
                <path d="M10 20l4.5-5 3.5 4 3-2.5 3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="12" cy="12" r="1.6" />
              </svg>
            </span>
            <h2>还没有本地项目。</h2>
            <p>新建一个项目即可开始画布；内容只保存在这个浏览器里。</p>
            <button className="projects-empty-new" onClick={() => void createNew()} disabled={busy}>新建项目 <span>＋</span></button>
          </div>
        : <ul className="project-rows" aria-label="Local projects">{rows.map(row => <li className="project-row" data-testid={`project-${row.id}`} key={row.id}>
            <div className="project-thumb" aria-hidden="true">
              <span className="project-thumb-letter">{initialOf(row.name)}</span>
              <span className="project-thumb-tag"><svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="2" y="3" width="12" height="10" rx="2" /><path d="M2 7h12M6 3v10" /></svg>画布</span>
            </div>
            <div className="project-row-main">
              <label className="project-name">
                <input aria-label={`Rename ${row.name}`} value={names[row.id] ?? row.name}
                  onChange={event => setNames(current => ({ ...current, [row.id]: event.target.value }))}
                  onBlur={() => void rename(row)}
                  onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
              </label>
              <div className="project-row-foot">
                <span className="project-meta" data-testid={`modified-${row.id}`}>{stamp(row.updatedAt)} · r{row.revision}</span>
                <button className="project-open" onClick={() => open(row.id)} aria-label={`Open ${row.name}`}>打开</button>
              </div>
            </div>
          </li>)}</ul>}
      <p className="boundary">改名与画布走同一条带版本校验的保存路径，不调用模型。</p>
    </main>
    <footer className="page-footer"><span>本地优先 · 独立实现</span><span>项目内容不会离开这个浏览器</span><span>无遥测</span></footer>
  </div>;
}
