import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { demoProject } from '../../src/domain/project.ts';
import { localPlan, planFromModel, stripCodeFence, type PlanContext } from '../../src/domain/llm-plan.ts';
import { plannerEnabled, requestPlan } from '../../src/providers/llm-planner.ts';
import { resetTextTransport, setTextTransport, type TextTransport } from '../../src/providers/text-provider.ts';

const project = demoProject();
const context: PlanContext = {
  allowedModels: ['mock-still-a', 'ark-text-endpoint'],
  nodeIds: project.nodes.map(node => node.id),
};
const imageId = project.nodes.find(node => node.kind === 'image')!.id;

afterEach(() => { resetTextTransport(); });

describe('slice 3.2-llm plan parsing', () => {
  it('01 strips a markdown fence before parsing', () => {
    assert.equal(stripCodeFence('```json\n{"a":1}\n```'), '{"a":1}');
    assert.equal(stripCodeFence('  {"a":1}  '), '{"a":1}');
  });

  it('02 accepts a well formed model plan and drops unknown fields', () => {
    const raw = JSON.stringify({
      steps: [
        { action: 'generate', nodeId: imageId, note: '画一张蓝色玻璃瓶', extra: 'ignored' },
        { action: 'reference', nodeId: imageId, note: 'x'.repeat(400) },
      ],
      targetModel: 'mock-still-a',
      estimate: { kind: 'image', amount: 5.005, unit: 'credits', currency: 'CNY' },
      executed: true,
    });
    const checked = planFromModel(raw, context);
    assert.equal(checked.ok, true);
    if (!checked.ok) return;
    assert.equal(checked.plan.source, 'model');
    assert.equal(checked.plan.targetNodeId, imageId);
    assert.equal(checked.plan.kind, 'generate');
    assert.equal(checked.plan.estimate, 5);
    assert.equal(checked.plan.modelEstimate, 5.01);
    assert.equal(checked.plan.steps.length, 2);
    assert.equal(checked.plan.steps[1].detail.length, 200);
    assert.equal(checked.plan.modelKnown, true);
    assert.ok(!('executed' in checked.plan));
  });

  it('03 keeps a plan whose model is not enabled, but blocks confirmation', () => {
    const raw = JSON.stringify({
      steps: [{ action: 'generate', nodeId: imageId, note: 'draw' }],
      targetModel: 'gpt-not-enabled',
      estimate: { kind: 'image', amount: 5, unit: 'credits' },
    });
    const checked = planFromModel(raw, context);
    assert.equal(checked.ok, true);
    if (!checked.ok) return;
    assert.equal(checked.plan.modelKnown, false);
  });

  it('04 rejects malformed output instead of executing it', () => {
    for (const raw of [
      'not json at all',
      '{"steps":[]}',
      JSON.stringify({ steps: [{ action: 'delete', nodeId: imageId, note: 'x' }], targetModel: 'a', estimate: { kind: 'image', amount: 1, unit: 'credits' } }),
      JSON.stringify({ steps: [{ action: 'generate', nodeId: 'ghost', note: 'x' }], targetModel: 'a', estimate: { kind: 'image', amount: 1, unit: 'credits' } }),
      JSON.stringify({ steps: [{ action: 'generate', nodeId: imageId, note: 'x' }], targetModel: 'a', estimate: { kind: 'image', amount: -1, unit: 'credits' } }),
      JSON.stringify({ steps: [{ action: 'generate', nodeId: imageId, note: 'x' }], targetModel: 'a', estimate: { kind: 'image', amount: 1, unit: 'usd' } }),
      JSON.stringify({ steps: [{ action: 'generate', nodeId: imageId, note: 'x' }], estimate: { kind: 'image', amount: 1, unit: 'credits' } }),
      JSON.stringify({ steps: Array.from({ length: 9 }, () => ({ action: 'reference', nodeId: imageId, note: 'x' })), targetModel: 'a', estimate: { kind: 'image', amount: 1, unit: 'credits' } }),
    ]) {
      const checked = planFromModel(raw, context);
      assert.equal(checked.ok, false, `should reject: ${raw.slice(0, 60)}`);
    }
  });

  it('05 the local fallback stays marked as local and names the node model', () => {
    const plan = localPlan(project, imageId, '生成一张图');
    assert.equal(plan.source, 'local');
    assert.equal(plan.targetModel, 'mock-still-a');
    assert.equal(plan.modelKnown, true);
  });
});

describe('slice 3.2-llm planner call', () => {
  it('06 does nothing when the text endpoint is not enabled', async () => {
    delete process.env.ARK_TEXT_ENABLED;
    assert.equal(plannerEnabled(), false);
    const outcome = await requestPlan({ message: 'hi', context: 'ctx', planContext: context });
    assert.equal(outcome.plan, null);
    assert.match(String(outcome.error), /未启用/u);
  });

  it('07 sends one chat request and returns the parsed plan', async () => {
    process.env.ARK_TEXT_ENABLED = '1';
    process.env.ARK_TEXT_ENDPOINT = 'ep-test-planner';
    process.env.ARK_API_KEY = 'test-key-not-real';
    const calls: { url: string; body: string }[] = [];
    const transport: TextTransport = async (url, init) => {
      calls.push({ url, body: String(init.body) });
      return new Response(JSON.stringify({
        model: 'ep-test-planner',
        choices: [{ message: { content: `\`\`\`json\n${JSON.stringify({
          steps: [{ action: 'generate', nodeId: imageId, note: 'draw' }],
          targetModel: 'mock-still-a',
          estimate: { kind: 'image', amount: 5, unit: 'credits' },
        })}\n\`\`\`` } }],
        usage: { prompt_tokens: 120, completion_tokens: 60 },
      }), { status: 200 });
    };
    setTextTransport(transport);
    const outcome = await requestPlan({ message: '生成一张图', context: `- ${imageId} · image`, planContext: context });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/chat\/completions$/u);
    assert.match(calls[0].body, /"role":"system"/u);
    assert.equal(outcome.error, null);
    assert.equal(outcome.plan?.source, 'model');
    assert.equal(outcome.promptTokens, 120);
    assert.equal(outcome.completionTokens, 60);
    delete process.env.ARK_TEXT_ENABLED;
    delete process.env.ARK_TEXT_ENDPOINT;
    delete process.env.ARK_API_KEY;
  });

  it('08 falls back (no retry) when the model answers with garbage', async () => {
    process.env.ARK_TEXT_ENABLED = '1';
    process.env.ARK_TEXT_ENDPOINT = 'ep-test-planner';
    process.env.ARK_API_KEY = 'test-key-not-real';
    let calls = 0;
    setTextTransport(async () => {
      calls += 1;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'sure! here is a plan:' } }] }), { status: 200 });
    });
    const outcome = await requestPlan({ message: '规划一下', context: 'ctx', planContext: context });
    assert.equal(calls, 1);
    assert.equal(outcome.plan, null);
    assert.match(String(outcome.error), /JSON/u);
    delete process.env.ARK_TEXT_ENABLED;
    delete process.env.ARK_TEXT_ENDPOINT;
    delete process.env.ARK_API_KEY;
  });
});
