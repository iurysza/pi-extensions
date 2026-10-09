import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configPath, loadDefaultModel, saveDefaultModel } from '../src/config.js';

test('model configuration respects the Pi directory and creates missing parents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-model-'));
  const previous = process.env.PI_CODING_AGENT_DIR;
  try {
    process.env.PI_CODING_AGENT_DIR = join(root, 'agent');
    assert.equal(configPath(), join(root, 'agent', 'pi-cursor-cloud.json'));
    assert.equal(loadDefaultModel(), undefined);
    await saveDefaultModel('saved');
    assert.equal(loadDefaultModel(), 'saved');
    assert.deepEqual(JSON.parse(await readFile(configPath(), 'utf8')), { defaultModel: 'saved' });
    const injected = join(root, 'test.json');
    for (const content of ['{', 'null', '[]', '{}', '{"defaultModel":42}', '{"defaultModel":" "}']) {
      await writeFile(injected, content);
      assert.equal(loadDefaultModel(injected), undefined);
    }
    await writeFile(injected, '{"defaultModel":" trimmed "}');
    assert.equal(loadDefaultModel(injected), 'trimmed');
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
