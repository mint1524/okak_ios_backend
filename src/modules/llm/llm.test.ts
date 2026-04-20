import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getLLMProvider } from './provider.js';

describe('mock LLM provider', () => {
  it('returns deterministic completion', async () => {
    const provider = getLLMProvider();
    const result = await provider.complete({
      model: 'okak-standard',
      reasoningLevel: 'medium',
      searchEnabled: false,
      messages: [{ role: 'user', content: 'Привет' }]
    });
    assert.ok(result.content.includes('OKAK okak-standard'));
    assert.ok(result.tokenCount > 0);
  });

  it('streams chunks until done', async () => {
    const provider = getLLMProvider();
    const events: string[] = [];
    let combined = '';
    for await (const evt of provider.stream({
      model: 'okak-standard',
      reasoningLevel: 'medium',
      searchEnabled: false,
      messages: [{ role: 'user', content: 'Test' }]
    })) {
      events.push(evt.type);
      if (evt.type === 'delta') combined += evt.content;
      if (evt.type === 'done') combined = evt.content;
    }
    assert.equal(events[0], 'start');
    assert.equal(events[events.length - 1], 'done');
    assert.ok(combined.length > 0);
  });
});
