import type { Dispatch, SetStateAction } from 'react';
import { CAPABILITY_SECTIONS, capabilitiesOf } from '../domain/capabilities.ts';
import type { ProjectNode } from '../domain/project.ts';

export interface AgentPanelProps {
  selected: ProjectNode | undefined;
  composerText: string;
  setComposerText: Dispatch<SetStateAction<string>>;
  sendToAgent: () => void;
  manualMode: boolean;
  setManualMode: Dispatch<SetStateAction<boolean>>;
  capabilitiesOpen: boolean;
  setCapabilitiesOpen: Dispatch<SetStateAction<boolean>>;
  capabilityDetail: string;
  setCapabilityDetail: Dispatch<SetStateAction<string>>;
  agentLog: { role: 'user' | 'agent'; text: string }[];
}

/** The bottom composer: context line, message input, mode/capability toggles,
 * the message log and the placeholder capability panel. Sending builds a plan;
 * it never triggers a provider call on its own. */
export function AgentPanel({ selected, composerText, setComposerText, sendToAgent, manualMode, setManualMode,
  capabilitiesOpen, setCapabilitiesOpen, capabilityDetail, setCapabilityDetail, agentLog }: AgentPanelProps) {
  return <div className="composer" data-testid="composer">
    <div className="composer-context" data-testid="composer-context">{selected ? `上下文：${selected.title}` : '先选一个节点作为上下文；这里不会自动生成。'}</div>
    <div className="composer-row">
      <input aria-label="给 Agent 发消息" placeholder="随心输入" value={composerText} onChange={event => setComposerText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') sendToAgent(); }} />
      <button className="linkish" aria-pressed={manualMode} data-testid="mode-toggle" onClick={() => setManualMode(value => !value)}>{manualMode ? '手动确认' : '自动执行'}</button>
      <button className="linkish" aria-expanded={capabilitiesOpen} data-testid="capability-toggle" onClick={() => { setCapabilitiesOpen(value => !value); setCapabilityDetail(''); }}>能力</button>
      <button className="primary" data-testid="composer-send" onClick={sendToAgent}>发送</button>
    </div>
    {agentLog.length > 0 && <ul className="composer-log" data-testid="composer-log">{agentLog.slice(-4).map((entry, index) => <li key={index} className={entry.role}>{entry.text}</li>)}</ul>}
    {capabilitiesOpen && <section className="capability-panel" data-testid="capability-panel"
      onKeyDown={event => { if (event.key === 'Escape') { setCapabilitiesOpen(false); setCapabilityDetail(''); } }}>
      <header><span className="eyebrow">能力</span>
        <button className="linkish" data-testid="capability-close" aria-label="关闭能力面板" onClick={() => { setCapabilitiesOpen(false); setCapabilityDetail(''); }}>关闭</button></header>
      <p className="muted">这里只列出占位条目：不安装、不授权、不联网、不写存储。</p>
      {CAPABILITY_SECTIONS.map(section => <div className="capability-section" key={section.kind} data-testid={`capability-section-${section.kind}`}>
        <h3>{section.title}</h3>
        <p className="muted">{section.note}</p>
        <ul>{capabilitiesOf(section.kind).map(item => <li key={item.id}>
          <button className="capability-row" data-testid={`capability-${item.id}`} onClick={() => setCapabilityDetail(item.id)}>
            <strong>{item.name}</strong><span className="badge">未接入</span><p>{item.summary}</p>
          </button>
          {capabilityDetail === item.id && <p className="capability-detail" data-testid={`capability-detail-${item.id}`}>{item.detail}</p>}
        </li>)}</ul>
      </div>)}
    </section>}
  </div>;
}
