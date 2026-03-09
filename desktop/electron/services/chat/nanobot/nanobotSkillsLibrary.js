const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SKILLS_LIBRARY_DIR_NAME = 'nanobot-skills';
const SKILLS_LIBRARY_TEMP_DIR_NAME = '.tmp';
const SKILL_FILE_NAME = 'SKILL.md';

function normalizeText(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }
  return value.trim();
}

function createSkillsError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function escapePowerShellLiteral(value) {
  return String(value || '').replace(/'/g, "''");
}

function runCommand(command, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf-8');
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

function stripOptionalQuotes(value) {
  const text = normalizeText(value);
  if (!text) {
    return '';
  }
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith('\'') && text.endsWith('\''))) {
    return text.slice(1, -1).trim();
  }
  return text;
}

function parseSkillFrontmatter(content = '') {
  const text = typeof content === 'string' ? content : '';
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match?.[1]) {
    return {};
  }

  const result = {};
  const lines = match[1].split(/\r?\n/);
  for (const line of lines) {
    const item = line.trim();
    if (!item || item.startsWith('#')) {
      continue;
    }

    const separatorIndex = item.indexOf(':');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = item.slice(0, separatorIndex).trim();
    const rawValue = item.slice(separatorIndex + 1).trim();
    result[key] = stripOptionalQuotes(rawValue);
  }

  return {
    name: normalizeText(result.name),
    description: normalizeText(result.description),
    always: normalizeText(result.always).toLowerCase() === 'true',
  };
}

function validateSkillDirectoryName(name) {
  const skillName = normalizeText(name);
  if (!skillName || skillName === '.' || skillName === '..') {
    return '';
  }
  if (skillName.includes('/') || skillName.includes('\\') || skillName.includes('\0')) {
    return '';
  }
  return skillName;
}

function normalizeZipEntry(entry) {
  return String(entry || '').replace(/\\/g, '/').trim();
}

function assertZipEntriesSafe(entries = []) {
  for (const rawEntry of entries) {
    const entry = normalizeZipEntry(rawEntry);
    if (!entry) {
      continue;
    }

    if (entry.startsWith('/') || entry.startsWith('//') || /^[A-Za-z]:/.test(entry)) {
      throw createSkillsError(
        'nanobot_skills_invalid_archive',
        `ZIP contains unsafe entry path: ${entry}`,
      );
    }

    const segments = entry.split('/').filter(Boolean);
    if (segments.some((segment) => segment === '.' || segment === '..')) {
      throw createSkillsError(
        'nanobot_skills_invalid_archive',
        `ZIP contains path traversal entry: ${entry}`,
      );
    }
  }
}

async function removeIfExists(targetPath) {
  try {
    await fs.rm(targetPath, { recursive: true, force: true });
  } catch {
    // noop
  }
}

async function parseSkillMetadata(skillFilePath) {
  try {
    const content = await fs.readFile(skillFilePath, 'utf-8');
    return parseSkillFrontmatter(content);
  } catch {
    return {};
  }
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

class NanobotSkillsLibrary {
  constructor(app, { nanobotRuntimeManager = null } = {}) {
    this.app = app;
    this.nanobotRuntimeManager = nanobotRuntimeManager;
    this.rootDir = path.join(this.app.getPath('userData'), SKILLS_LIBRARY_DIR_NAME);
    this.tempDir = path.join(this.rootDir, SKILLS_LIBRARY_TEMP_DIR_NAME);
  }

  async init() {
    await fs.mkdir(this.rootDir, { recursive: true });
    await fs.mkdir(this.tempDir, { recursive: true });
  }

  getRootDir() {
    return this.rootDir;
  }

  getRuntimeBuiltinSkillsRoot() {
    const status = this.nanobotRuntimeManager?.getStatus?.();
    if (!status?.installed || !status?.repoPath) {
      return '';
    }
    return path.join(status.repoPath, 'nanobot', 'skills');
  }

  async listSkills() {
    await this.init();

    const customSkills = await this.listSkillsInRoot({
      rootPath: this.rootDir,
      source: 'custom',
      removable: true,
    });

    const builtinRoot = this.getRuntimeBuiltinSkillsRoot();
    const builtinSkills = builtinRoot
      ? await this.listSkillsInRoot({
          rootPath: builtinRoot,
          source: 'builtin',
          removable: false,
        })
      : [];

    return {
      libraryPath: this.rootDir,
      customSkills,
      builtinSkills,
    };
  }

  async listSkillsInRoot({ rootPath, source, removable }) {
    const skills = [];
    if (!rootPath) {
      return skills;
    }

    try {
      const entries = await fs.readdir(rootPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        if (entry.name === SKILLS_LIBRARY_TEMP_DIR_NAME) {
          continue;
        }

        const skillName = validateSkillDirectoryName(entry.name);
        if (!skillName) {
          continue;
        }

        const skillDirPath = path.join(rootPath, skillName);
        const skillFilePath = path.join(skillDirPath, SKILL_FILE_NAME);
        if (!(await pathExists(skillFilePath))) {
          continue;
        }

        const metadata = await parseSkillMetadata(skillFilePath);
        skills.push({
          source,
          removable,
          skillName,
          name: metadata.name || skillName,
          description: metadata.description || '',
          always: Boolean(metadata.always),
        });
      }
    } catch {
      return [];
    }

    return skills.sort((a, b) => a.skillName.localeCompare(b.skillName, 'en-US'));
  }

  async listZipEntries(zipPath) {
    if (process.platform === 'win32') {
      const escapedZipPath = escapePowerShellLiteral(zipPath);
      const command = [
        '$ErrorActionPreference = "Stop"',
        'Add-Type -AssemblyName System.IO.Compression.FileSystem',
        `$zip = [System.IO.Compression.ZipFile]::OpenRead('${escapedZipPath}')`,
        'try { foreach ($entry in $zip.Entries) { [Console]::Out.WriteLine($entry.FullName) } } finally { $zip.Dispose() }',
      ].join('; ');
      const result = await runCommand('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        command,
      ]);
      return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    }

    const result = await runCommand('unzip', ['-Z1', zipPath]);
    return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  async extractZip(zipPath, outputDir) {
    if (process.platform === 'win32') {
      const escapedZipPath = escapePowerShellLiteral(zipPath);
      const escapedOutputDir = escapePowerShellLiteral(outputDir);
      const command = `Expand-Archive -LiteralPath '${escapedZipPath}' -DestinationPath '${escapedOutputDir}' -Force`;
      await runCommand('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        command,
      ]);
      return;
    }

    await runCommand('unzip', ['-oq', zipPath, '-d', outputDir]);
  }

  async findSkillDirectories(directory) {
    const discovered = [];
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const fullPath = path.join(directory, entry.name);
      const skillFilePath = path.join(fullPath, SKILL_FILE_NAME);
      if (await pathExists(skillFilePath)) {
        discovered.push(fullPath);
        continue;
      }
      const nested = await this.findSkillDirectories(fullPath);
      discovered.push(...nested);
    }
    return discovered;
  }

  async importZip(zipPath) {
    await this.init();

    const resolvedZipPath = path.resolve(String(zipPath || ''));
    if (!resolvedZipPath || path.extname(resolvedZipPath).toLowerCase() !== '.zip') {
      throw createSkillsError('nanobot_skills_invalid_archive', 'Please choose a ZIP file.');
    }

    const zipEntries = await this.listZipEntries(resolvedZipPath);
    assertZipEntriesSafe(zipEntries);

    const workspace = path.join(
      this.tempDir,
      `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    const extractedDir = path.join(workspace, 'content');
    const stagedInstallDir = path.join(workspace, 'staged');

    await fs.mkdir(extractedDir, { recursive: true });
    await fs.mkdir(stagedInstallDir, { recursive: true });

    let installedSkillNames = [];
    try {
      await this.extractZip(resolvedZipPath, extractedDir);
      const skillDirs = await this.findSkillDirectories(extractedDir);
      if (!skillDirs.length) {
        throw createSkillsError(
          'nanobot_skills_invalid_archive',
          'No valid skill found in ZIP. Each skill must contain a SKILL.md file.',
        );
      }

      const candidateByName = new Map();
      for (const skillDirPath of skillDirs) {
        const dirName = validateSkillDirectoryName(path.basename(skillDirPath));
        if (!dirName) {
          throw createSkillsError(
            'nanobot_skills_invalid_archive',
            `Invalid skill directory name: ${path.basename(skillDirPath)}`,
          );
        }

        if (candidateByName.has(dirName)) {
          throw createSkillsError(
            'nanobot_skills_invalid_archive',
            `ZIP contains duplicate skill directory: ${dirName}`,
          );
        }

        candidateByName.set(dirName, skillDirPath);
      }

      const conflicts = [];
      for (const skillName of candidateByName.keys()) {
        const targetPath = path.join(this.rootDir, skillName);
        if (await pathExists(targetPath)) {
          conflicts.push(skillName);
        }
      }

      if (conflicts.length) {
        throw createSkillsError(
          'nanobot_skills_conflict',
          `Skill already exists: ${conflicts.join(', ')}`,
        );
      }

      for (const [skillName, sourceDirPath] of candidateByName.entries()) {
        const stagedSkillPath = path.join(stagedInstallDir, skillName);
        await fs.cp(sourceDirPath, stagedSkillPath, {
          recursive: true,
          force: false,
          errorOnExist: true,
        });
      }

      for (const skillName of candidateByName.keys()) {
        const sourcePath = path.join(stagedInstallDir, skillName);
        const targetPath = path.join(this.rootDir, skillName);
        await fs.rename(sourcePath, targetPath);
        installedSkillNames.push(skillName);
      }
    } catch (error) {
      for (const installedSkillName of installedSkillNames) {
        await removeIfExists(path.join(this.rootDir, installedSkillName));
      }
      throw error;
    } finally {
      await removeIfExists(workspace);
    }

    const listing = await this.listSkills();
    const importedSkills = listing.customSkills.filter((skill) => installedSkillNames.includes(skill.skillName));
    return {
      importedSkills,
      importedCount: importedSkills.length,
      ...listing,
    };
  }

  async deleteSkill(skillName) {
    await this.init();

    const normalizedSkillName = validateSkillDirectoryName(skillName);
    if (!normalizedSkillName) {
      throw createSkillsError('nanobot_skills_invalid_name', 'Invalid skill name.');
    }

    const targetDir = path.join(this.rootDir, normalizedSkillName);
    const skillFilePath = path.join(targetDir, SKILL_FILE_NAME);
    if (!(await pathExists(skillFilePath))) {
      throw createSkillsError('nanobot_skills_not_found', `Skill not found: ${normalizedSkillName}`);
    }

    await fs.rm(targetDir, { recursive: true, force: true });
    const listing = await this.listSkills();
    return {
      deletedSkillName: normalizedSkillName,
      ...listing,
    };
  }
}

module.exports = {
  NanobotSkillsLibrary,
  parseSkillFrontmatter,
  SKILLS_LIBRARY_DIR_NAME,
  SKILL_FILE_NAME,
};
