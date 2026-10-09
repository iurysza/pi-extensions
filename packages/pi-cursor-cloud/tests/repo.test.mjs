import test from 'node:test';
import assert from 'node:assert/strict';
import { originToHttps, resolveRepo } from '../src/repo.js';

test('GitHub SSH and HTTPS origins normalize without .git', () => {
  for (const url of ['git@github.com:owner/repo.git', 'ssh://git@github.com/owner/repo.git', 'https://github.com/owner/repo.git', 'https://github.com/owner/repo/']) assert.equal(originToHttps(url), 'https://github.com/owner/repo');
  for (const url of ['https://token@github.com/owner/repo', 'https://github.com.evil/owner/repo', '/local/repo', 'https://gitlab.com/owner/repo', 'https://github.com/../repo', 'https://github.com/a/.git']) assert.throws(() => originToHttps(url));
});

const git = async (_cwd, args) => {
  if (args[0] === 'remote') return 'git@github.com:owner/repo.git';
  if (args[0] === 'symbolic-ref') return 'feature/docs';
  if (args[0] === 'show-ref' && args.at(-1) === 'refs/remotes/origin/feature/docs') return 'sha';
  throw new Error('no ref');
};

test('tracked current branch wins and an unpushed branch falls back to main', async () => {
  assert.deepEqual(await resolveRepo('/cwd', undefined, undefined, git), { repo: 'https://github.com/owner/repo', ref: 'feature/docs' });
  const missing = async (cwd, args) => { if (args[0] === 'show-ref') throw new Error('missing'); return git(cwd, args); };
  assert.equal((await resolveRepo('/cwd', undefined, undefined, missing)).ref, 'main');
});

test('explicit repository and ref work outside git and do not inherit another repo branch', async () => {
  const unavailable = async () => { throw new Error('no git'); };
  assert.deepEqual(await resolveRepo('/cwd', 'https://github.com/other/repo', 'v1', unavailable), { repo: 'https://github.com/other/repo', ref: 'v1' });
  assert.equal((await resolveRepo('/cwd', 'https://github.com/other/repo', undefined, git)).ref, 'main');
  await assert.rejects(resolveRepo('/cwd', undefined, undefined, unavailable), /Pass repo explicitly/);
  await assert.rejects(resolveRepo('/cwd', 'https://github.com/a/b', 'bad\nref', git), /Invalid repository ref/);
});
