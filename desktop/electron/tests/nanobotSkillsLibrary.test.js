const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { NanobotSkillsLibrary } = require('../services/chat/nanobot/nanobotSkillsLibrary');

function createApp(userDataPath) {
  return {
    getPath(name) {
      assert.equal(name, 'userData');
      return userDataPath;
    },
  };
}

test('listSkills returns custom skills and runtime builtin skills', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nanobot-skills-list-test-'));
  const repoPath = path.join(tmpDir, 'nanobot-runtime', 'repo');
  const runtimeManager = {
    getStatus: () => ({
      installed: true,
      repoPath,
    }),
  };
  const library = new NanobotSkillsLibrary(createApp(tmpDir), { nanobotRuntimeManager: runtimeManager });
  await library.init();

  await fs.mkdir(path.join(tmpDir, 'nanobot-skills', 'my-custom'), { recursive: true });
  await fs.writeFile(
    path.join(tmpDir, 'nanobot-skills', 'my-custom', 'SKILL.md'),
    '---\nname: my-custom\ndescription: custom desc\n---\n',
    'utf-8',
  );

  await fs.mkdir(path.join(repoPath, 'nanobot', 'skills', 'memory'), { recursive: true });
  await fs.writeFile(
    path.join(repoPath, 'nanobot', 'skills', 'memory', 'SKILL.md'),
    '---\nname: memory\ndescription: builtin desc\nalways: true\n---\n',
    'utf-8',
  );

  const result = await library.listSkills();
  assert.equal(result.customSkills.length, 1);
  assert.equal(result.customSkills[0].skillName, 'my-custom');
  assert.equal(result.customSkills[0].description, 'custom desc');
  assert.equal(result.builtinSkills.length, 1);
  assert.equal(result.builtinSkills[0].skillName, 'memory');
  assert.equal(result.builtinSkills[0].always, true);
});

test('importZip installs multiple skills from one archive', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nanobot-skills-import-test-'));
  const library = new NanobotSkillsLibrary(createApp(tmpDir));
  await library.init();

  library.listZipEntries = async () => [
    'bundle/weather/SKILL.md',
    'bundle/github/SKILL.md',
  ];
  library.extractZip = async (_zipPath, outputDir) => {
    await fs.mkdir(path.join(outputDir, 'bundle', 'weather'), { recursive: true });
    await fs.mkdir(path.join(outputDir, 'bundle', 'github'), { recursive: true });
    await fs.writeFile(
      path.join(outputDir, 'bundle', 'weather', 'SKILL.md'),
      '---\nname: weather\ndescription: weather skill\n---\n',
      'utf-8',
    );
    await fs.writeFile(
      path.join(outputDir, 'bundle', 'github', 'SKILL.md'),
      '---\nname: github\ndescription: github skill\n---\n',
      'utf-8',
    );
  };

  const imported = await library.importZip(path.join(tmpDir, 'skills-pack.zip'));
  assert.equal(imported.importedCount, 2);
  assert.ok(imported.customSkills.some((item) => item.skillName === 'weather'));
  assert.ok(imported.customSkills.some((item) => item.skillName === 'github'));
});

test('importZip rejects on conflicts without partial install', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nanobot-skills-conflict-test-'));
  const library = new NanobotSkillsLibrary(createApp(tmpDir));
  await library.init();

  await fs.mkdir(path.join(tmpDir, 'nanobot-skills', 'weather'), { recursive: true });
  await fs.writeFile(path.join(tmpDir, 'nanobot-skills', 'weather', 'SKILL.md'), '# existing', 'utf-8');

  library.listZipEntries = async () => [
    'bundle/weather/SKILL.md',
    'bundle/github/SKILL.md',
  ];
  library.extractZip = async (_zipPath, outputDir) => {
    await fs.mkdir(path.join(outputDir, 'bundle', 'weather'), { recursive: true });
    await fs.mkdir(path.join(outputDir, 'bundle', 'github'), { recursive: true });
    await fs.writeFile(path.join(outputDir, 'bundle', 'weather', 'SKILL.md'), '# weather', 'utf-8');
    await fs.writeFile(path.join(outputDir, 'bundle', 'github', 'SKILL.md'), '# github', 'utf-8');
  };

  await assert.rejects(
    () => library.importZip(path.join(tmpDir, 'skills-pack.zip')),
    (error) => error && error.code === 'nanobot_skills_conflict',
  );

  const listing = await library.listSkills();
  assert.equal(listing.customSkills.length, 1);
  assert.equal(listing.customSkills[0].skillName, 'weather');
  assert.equal(listing.customSkills.some((item) => item.skillName === 'github'), false);
});

test('deleteSkill removes installed custom skill', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nanobot-skills-delete-test-'));
  const library = new NanobotSkillsLibrary(createApp(tmpDir));
  await library.init();

  await fs.mkdir(path.join(tmpDir, 'nanobot-skills', 'weather'), { recursive: true });
  await fs.writeFile(path.join(tmpDir, 'nanobot-skills', 'weather', 'SKILL.md'), '# weather', 'utf-8');

  const deleted = await library.deleteSkill('weather');
  assert.equal(deleted.deletedSkillName, 'weather');
  assert.equal(deleted.customSkills.length, 0);
});
