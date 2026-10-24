import type { RefObject } from 'react';
import type { MockRun } from '../providers/mock-provider.ts';
import type { ArkRun } from '../providers/ark-provider.ts';
import type { SpeechRun } from '../providers/speech-provider.ts';
import type { VideoRun } from '../providers/video-provider.ts';

export interface RunPanelsProps {
  videoRun: VideoRun | null;
  videoRunRef: RefObject<VideoRun | null>;
  applyVideoRun: (next: VideoRun | null) => void;
  cancelVideoRun: (run: VideoRun) => VideoRun;
  arkRun: ArkRun | null;
  arkRunRef: RefObject<ArkRun | null>;
  applyArkRun: (next: ArkRun | null) => void;
  cancelArkRun: (run: ArkRun) => ArkRun;
  speechRun: SpeechRun | null;
  speechRunRef: RefObject<SpeechRun | null>;
  applySpeechRun: (next: SpeechRun | null) => void;
  cancelSpeechRun: (run: SpeechRun) => SpeechRun;
  run: MockRun | null;
  runRef: RefObject<MockRun | null>;
  applyRun: (next: MockRun | null) => void;
  cancelRun: (run: MockRun) => MockRun;
  spent: number;
  exportResult: () => Promise<void>;
}

/** Per-run status panels under the draft form: real video / ark image /
 * speech / mock, each with its cancel entry and result summary. */
export function RunPanels({ videoRun, videoRunRef, applyVideoRun, cancelVideoRun, arkRun, arkRunRef, applyArkRun, cancelArkRun,
  speechRun, speechRunRef, applySpeechRun, cancelSpeechRun, run, runRef, applyRun, cancelRun, spent, exportResult }: RunPanelsProps) {
  return <>
    {videoRun && <div className="run-panel" data-testid="video-panel"><span className="eyebrow">真实视频任务</span>
      <p>状态：<output data-testid="video-state">{videoRun.state}</output> · 轮询 <output data-testid="video-polls">{videoRun.polls}</output></p>
      {videoRun.taskId && <p className="muted">任务 {videoRun.taskId.slice(0, 12)}… · {videoRun.request.resolution} · {videoRun.request.duration}s</p>}
      {videoRun.state === 'running' && <button className="linkish" onClick={() => applyVideoRun(cancelVideoRun(videoRunRef.current ?? videoRun))}>取消真实视频任务</button>}
      {videoRun.state === 'failed' && <p className="error" role="alert">{videoRun.error}</p>}
      {videoRun.state === 'canceled' && <p className="muted">已取消。轮询停止，结果不写回。</p>}
    </div>}
    {arkRun && <div className="run-panel" data-testid="ark-panel"><span className="eyebrow">真实图片运行</span>
      <p>状态：<output data-testid="ark-state">{arkRun.state}</output></p>
      {(arkRun.state === 'queued' || arkRun.state === 'running') && <button className="linkish" onClick={() => applyArkRun(cancelArkRun(arkRunRef.current ?? arkRun))}>取消真实运行</button>}
      {arkRun.state === 'failed' && <p className="error" role="alert">{arkRun.error}</p>}
      {arkRun.state === 'canceled' && <p className="muted">已取消。请求若已发出，其结果会被丢弃且不扣 平台代币。</p>}
    </div>}
    {speechRun && <div className="run-panel" data-testid="speech-panel"><span className="eyebrow">真实语音运行</span>
      <p>状态：<output data-testid="speech-state">{speechRun.state}</output></p>
      {(speechRun.state === 'queued' || speechRun.state === 'running') && <button className="linkish" onClick={() => applySpeechRun(cancelSpeechRun(speechRunRef.current ?? speechRun))}>取消语音运行</button>}
      {speechRun.state === 'failed' && <p className="error" role="alert">{speechRun.error}</p>}
      {speechRun.state === 'canceled' && <p className="muted">已取消：请求未发出，没有调用模型，也没有结果。</p>}
      {speechRun.result && <div className="simulated-result" data-testid="speech-result"><span className="eyebrow">真实音频</span><p>{speechRun.result.originalDuration.toFixed(1)}s · {speechRun.result.mime} · {speechRun.result.cost} 平台代币</p><p className="muted">按原始时长以 1 元/分钟换算（100 平台代币 = 1 元）；实际以服务端账单为准。</p></div>}
    </div>}
    {run && <div className="run-panel" data-testid="run-panel"><span className="eyebrow">模拟运行</span>
      <p>状态：<output data-testid="run-state">{run.state}</output></p>
      {(run.state === 'queued' || run.state === 'running') && <button className="linkish" onClick={() => applyRun(cancelRun(runRef.current ?? run))}>取消运行</button>}
      {run.state === 'failed' && <p className="error" role="alert">{run.error}</p>}
      {run.state === 'canceled' && <p className="muted">已取消：没有写入结果，画布、连线与引用保持不变。</p>}
      {run.state === 'succeeded' && <button className="linkish" data-testid="export-result" onClick={() => void exportResult()}>导出本次结果</button>}
      <p className="muted">本次消耗：<output data-testid="run-cost">{run.state === 'succeeded' ? spent : 0}</output> 平台代币（模拟）</p>
      {run.result && <div className="simulated-result" data-testid="simulated-result"><span className="eyebrow">模拟结果</span><p>{run.result.mode} · {run.result.status} · cost {run.result.cost}</p><p className="muted">{run.result.note} · seed {run.result.seed}</p></div>}
    </div>}
  </>;
}
