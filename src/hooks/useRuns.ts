import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { applySimulatedResult, applyTextResult, isMediaNode, type Project } from '../domain/project.ts';
import { startRun, tickRun, cancelRun, runControls, type MockRun } from '../providers/mock-provider.ts';
import { tickArkRun, cancelArkRun, ARK_IMAGE_MODELS, type ArkRun } from '../providers/ark-provider.ts';
import { tickSpeechRun, cancelSpeechRun, type SpeechRun } from '../providers/speech-provider.ts';
import { videoCost, tickVideoRun, cancelVideoRun, VIDEO_POLL_INTERVAL_MS, type VideoRun } from '../providers/video-provider.ts';
import { applyRealResult, stillRunning } from '../providers/real-provider.ts';
import { tickTextRun, cancelTextRun, type TextRun } from '../providers/text-provider.ts';
import { TEXT_CREDITS_PER_CALL } from '../domain/money.ts';
import { spendCredits, spendAmount, priceFor, walletOf } from '../domain/pricing.ts';
import { addVariant, type EditorState } from '../domain/editor.ts';
import type { ProjectStore } from '../persistence/project-store.ts';
import type { Command } from '../domain/history.ts';

export interface RunDeps {
  change: (next: Project, command?: Command) => void;
  projectRef: RefObject<Project>;
  store: ProjectStore;
  refreshAssets: () => Promise<void>;
  setNotice: Dispatch<SetStateAction<string>>; setEditor: Dispatch<SetStateAction<EditorState | null>>;
}

/** All five run lifecycles (mock, ark image, speech, video, text): state +
 * refs, pending targets, and the timer effects advancing each run. Providers
 * own the pacing; effects schedule ticks and guard cancels. */
export function useRuns({ change, projectRef, store, refreshAssets, setNotice, setEditor }: RunDeps) {
  const [run, setRun] = useState<MockRun | null>(null);
  const pendingTarget = useRef('');
  // The ref is the source of truth for ticks: React may schedule two timers
  // for the same render, and both must read the previous tick's state.
  const runRef = useRef<MockRun | null>(null);
  const applyRun = (next: MockRun | null) => { runRef.current = next; setRun(next); };
  // Slice 1.2: a real Ark run lives beside the mock run; only one is active.
  const [arkRun, setArkRun] = useState<ArkRun | null>(null);
  const arkRunRef = useRef<ArkRun | null>(null);
  const applyArkRun = (next: ArkRun | null) => { arkRunRef.current = next; setArkRun(next); };
  // Slice 1.4: a real speech run lives beside the Ark run; only one active.
  const [speechRun, setSpeechRun] = useState<SpeechRun | null>(null);
  const speechRunRef = useRef<SpeechRun | null>(null);
  const applySpeechRun = (next: SpeechRun | null) => { speechRunRef.current = next; setSpeechRun(next); };
  const [videoRun, setVideoRun] = useState<VideoRun | null>(null);
  const videoRunRef = useRef<VideoRun | null>(null);
  const applyVideoRun = (next: VideoRun | null) => { videoRunRef.current = next; setVideoRun(next); };
  // Slice 1.4-text: one request, no retry; the answer lands in the node content.
  const [textRun, setTextRun] = useState<TextRun | null>(null);
  const textRunRef = useRef<TextRun | null>(null);
  const applyTextRun = (next: TextRun | null) => { textRunRef.current = next; setTextRun(next); };
  const [textModel, setTextModel] = useState<string>('simulated');
  const [outcome, setOutcome] = useState<'succeed' | 'fail'>('succeed');
  const pendingEditor = useRef(false); // Slice 2.3-real: the editor's pending real variant flag.

  // Slice 1.2: the real run advances on its own effect. tickArkRun performs the
  // HTTP call exactly once when it first sees `running`; no automatic retry.
  useEffect(() => {
    if (!arkRun || (arkRun.state !== 'queued' && arkRun.state !== 'running')) return undefined;
    const timer = window.setTimeout(() => {
      const current = arkRunRef.current;
      if (!current || current.id !== arkRun.id) return;
      void (async () => {
        const next = await tickArkRun(current);
        // Cancel race: the user may have canceled while the HTTP call was in
        // flight, so the held run must still be this run and still running.
        if (!stillRunning(arkRunRef.current, next.id)) {
          pendingTarget.current = '';
          if (arkRunRef.current?.state === 'canceled') setNotice('已取消：请求已返回，但结果被丢弃，未扣本地平台代币。');
          return;
        }
        applyArkRun(next);
        if (next.state === 'failed') { pendingTarget.current = ''; return; }
        if (next.state !== 'succeeded' || !next.result) return;
        const forEditor = pendingEditor.current;
        pendingEditor.current = false;
        const targetId = pendingTarget.current;
        pendingTarget.current = '';
        if (!forEditor && (!targetId || !projectRef.current.nodes.some(node => node.id === targetId))) return;
        const blob = new Blob([next.result.bytes.slice().buffer as ArrayBuffer], { type: next.result.mime });
        if (forEditor) {
          try {
            const asset = await store.addAssetFromBlob(blob, `ark-editor-${Date.now()}.png`, 'other');
            await refreshAssets();
            const cost = ARK_IMAGE_MODELS.find(entry => entry.id === next.result?.model)?.estimate ?? 0;
            const wallet = spendAmount(projectRef.current, cost);
            change(wallet, { kind: 'snapshot' });
            setEditor(current => current ? addVariant(current, asset.path) : current);
            setNotice(`真实变体已生成并加入列表：扣本地 ${cost} 平台代币（1 元 = 100 平台代币；实际以方舟账单为准）。保存到节点仍走原有路径。`);
          } catch (reason) { setNotice(String(reason)); }
          return;
        }
        try {
          const asset = await store.addAssetFromBlob(blob, `ark-${Date.now()}.png`, 'other');
          await refreshAssets();
          const cost = ARK_IMAGE_MODELS.find(entry => entry.id === next.result?.model)?.estimate ?? 0;
          const wallet = spendAmount(projectRef.current, cost);
          change(applyRealResult(wallet, targetId, asset.path), { kind: 'snapshot' });
          setNotice(`真实生成完成：模型 ${next.result.model}，usage ${next.result.outputTokens} output_tokens，扣本地 ${cost} 平台代币（1 元 = 100 平台代币；实际费用以方舟账单为准）。已存为本地素材并就地显示（real）。`);
        } catch (reason) { setNotice(String(reason)); }
      })();
    }, 200);
    return () => window.clearTimeout(timer);
  }, [arkRun]);

  // Slice 1.4: the real speech run advances on its own effect. tickSpeechRun
  // performs the synchronous HTTP call exactly once; no automatic retry.
  useEffect(() => {
    if (!speechRun || (speechRun.state !== 'queued' && speechRun.state !== 'running')) return undefined;
    const timer = window.setTimeout(() => {
      const current = speechRunRef.current;
      if (!current || current.id !== speechRun.id) return;
      void (async () => {
        const next = await tickSpeechRun(current);
        // Cancel race guard, same rule as the Ark run: never apply or charge a
        // result whose run was canceled while the request was in flight.
        if (!stillRunning(speechRunRef.current, next.id)) {
          pendingTarget.current = '';
          if (speechRunRef.current?.state === 'canceled') setNotice('已取消：请求已返回，但结果被丢弃，未扣本地平台代币。');
          return;
        }
        applySpeechRun(next);
        if (next.state === 'failed') { pendingTarget.current = ''; setNotice(`真实音频失败：${next.error}`); return; }
        if (next.state !== 'succeeded' || !next.result) return;
        const targetId = pendingTarget.current;
        pendingTarget.current = '';
        if (!targetId || !projectRef.current.nodes.some(node => node.id === targetId)) return;
        const blob = new Blob([next.result.bytes.slice().buffer as ArrayBuffer], { type: next.result.mime });
        try {
          const asset = await store.addGeneratedBlob(blob, `speech-${Date.now()}.mp3`, 'sound');
          await refreshAssets();
          const wallet = spendAmount(projectRef.current, next.result.cost);
          change(applyRealResult(wallet, targetId, asset.path), { kind: 'snapshot' });
          setNotice(`真实音频完成：${next.result.originalDuration.toFixed(1)} 秒，扣本地 ${next.result.cost} 平台代币（1 元/分钟，1 元 = 100 平台代币；实际以豆包语音账单为准）。已存为本地素材并就地显示（real）。`);
        } catch (reason) { setNotice(String(reason)); }
      })();
    }, 200);
    return () => window.clearTimeout(timer);
  }, [speechRun]);

  // Slice 1.4-text: one chat completion, no retry. The answer replaces the node
  // content and the prompt is captured on the node meta before the write.
  useEffect(() => {
    if (!textRun || (textRun.state !== 'queued' && textRun.state !== 'running')) return undefined;
    const timer = window.setTimeout(() => {
      const current = textRunRef.current;
      if (!current || current.id !== textRun.id) return;
      void (async () => {
        const next = await tickTextRun(current);
        // Cancel race guard, same rule as the other real runs.
        if (!stillRunning(textRunRef.current, next.id)) {
          if (textRunRef.current?.state === 'canceled') setNotice('已取消：请求已返回，但结果被丢弃，未扣本地平台代币。');
          return;
        }
        applyTextRun(next);
        if (next.state === 'failed') { setNotice(`真实文本失败（不重试）：${next.error}`); return; }
        if (next.state !== 'succeeded' || !next.result) return;
        try {
          const wallet = spendAmount(projectRef.current, TEXT_CREDITS_PER_CALL);
          change(applyTextResult(wallet, next.request.nodeId, next.result.text, {
            model: next.result.model, promptTokens: next.result.promptTokens, completionTokens: next.result.completionTokens,
          }), { kind: 'snapshot' });
          setNotice(`真实文本已写入节点：${next.result.promptTokens} prompt / ${next.result.completionTokens} completion tokens，扣本地 ${TEXT_CREDITS_PER_CALL} 平台代币（实际以方舟账单为准）。`);
        } catch (reason) { setNotice(String(reason)); }
      })();
    }, 200);
    return () => window.clearTimeout(timer);
  }, [textRun]);

  // Slice 1.3: the video task advances in its own loop (submit → poll → download).
  // The provider enforces the 3 s poll interval and the 10 minute ceiling; the
  // effect only schedules the next step, and a canceled run drops late results.
  useEffect(() => {
    // Slice 1.6: `startVideoRun` parks the run in `queued`; the first tick is
    // what moves it to `running` and then submits. Arming only on `running`
    // left the run stuck forever (found in the proxy smoke run).
    if (!videoRun || (videoRun.state !== 'queued' && videoRun.state !== 'running')) return undefined;
    const timer = window.setTimeout(() => {
      const current = videoRunRef.current;
      if (!current || current.id !== videoRun.id) return;
      void (async () => {
        const next = await tickVideoRun(current);
        if (next.state === 'failed') {
          if (stillRunning(videoRunRef.current, next.id)) { applyVideoRun(next); pendingTarget.current = ''; setNotice(`真实视频失败：${next.error}`); }
          return;
        }
        if (next.state !== 'succeeded' || !next.result) {
          // Keep polling: a fresh object identity keeps this effect re-armed.
          if (stillRunning(videoRunRef.current, next.id)) applyVideoRun(next === current ? { ...next } : next);
          return;
        }
        if (!stillRunning(videoRunRef.current, next.id)) {
          pendingTarget.current = '';
          if (videoRunRef.current?.state === 'canceled') setNotice('已取消：视频任务结果被丢弃，未扣本地平台代币。');
          return;
        }
        const targetId = pendingTarget.current;
        pendingTarget.current = '';
        if (!targetId || !projectRef.current.nodes.some(node => node.id === targetId)) return;
        // Terminal state first: a storage failure must not leave the panel stuck
        // on `running` while the task has actually finished.
        applyVideoRun(next);
        const blob = new Blob([next.result.bytes.slice().buffer as ArrayBuffer], { type: next.result.mime });
        try {
          const cost = videoCost(next.result.duration);
          if (cost > walletOf(projectRef.current)) throw new Error(`模拟额度不足：需要 ${cost}，剩余 ${walletOf(projectRef.current)}。`);
          const asset = await store.addGeneratedBlob(blob, `ark-video-${Date.now()}.mp4`, 'other');
          await refreshAssets();
          const wallet = spendAmount(projectRef.current, cost);
          change(applyRealResult(wallet, targetId, asset.path), { kind: 'snapshot' });
          setNotice(`真实视频完成：${next.result.resolution} · ${next.result.duration}s，扣本地 ${cost} 平台代币（1 元 = 100 平台代币；实际以方舟账单为准）。已存为本地素材并就地显示（real）。`);
        } catch (reason) { setNotice(String(reason)); }
      })();
    }, VIDEO_POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [videoRun]);

  // The mock lifecycle advances on a fixed delay so every state stays reachable
  // and testable; no background queue and no timer survives the run.
  useEffect(() => {
    if (!run || (run.state !== 'queued' && run.state !== 'running')) return undefined;
    const timer = window.setTimeout(() => {
      const current = runRef.current;
      if (!current || current.id !== run.id) return;
      const next = tickRun(current);
      if (next !== current) {
        applyRun(next);
        // A finished run writes its simulated result into the node itself, so the
        // card renders the result in place (observed target behavior).
        if (next.state === 'succeeded' && pendingTarget.current
          && projectRef.current.nodes.some(node => node.id === pendingTarget.current)) {
          const target = projectRef.current.nodes.find(node => node.id === pendingTarget.current);
          if (target && isMediaNode(target)) {
            const wallet = spendCredits(projectRef.current, target.kind);
            change(applySimulatedResult(wallet, target.id, next.id), { kind: 'snapshot' });
            setNotice(`Simulated run finished: ${priceFor(target.kind)} credits deducted locally. No payment was made.`);
          }
          pendingTarget.current = '';
        }
      }
    }, 280);
    return () => window.clearTimeout(timer);
  }, [run]);

  return {
    run, runRef, applyRun, cancelRun,
    arkRun, arkRunRef, applyArkRun, cancelArkRun,
    speechRun, speechRunRef, applySpeechRun, cancelSpeechRun,
    videoRun, videoRunRef, applyVideoRun, cancelVideoRun,
    textRun, textRunRef, applyTextRun, cancelTextRun,
    textModel, setTextModel, outcome, setOutcome,
    pendingTarget, pendingEditor,
  };
}
