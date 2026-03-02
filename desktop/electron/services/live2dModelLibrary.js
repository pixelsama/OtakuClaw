const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const MODEL_PROTOCOL = 'openclaw-model';

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function createImportFolderName(zipPath) {
  const baseName = path.basename(zipPath, path.extname(zipPath));
  const normalized = baseName
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const safeName = normalized || 'live2d-model';
  const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${safeName}-${timestamp}-${suffix}`;
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json' || ext === '.model3.json' || ext === '.motion3.json' || ext === '.exp3.json') {
    return 'application/json; charset=utf-8';
  }
  if (ext === '.moc3') {
    return 'application/octet-stream';
  }
  if (ext === '.png') {
    return 'image/png';
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    return 'image/jpeg';
  }
  if (ext === '.webp') {
    return 'image/webp';
  }
  if (ext === '.wav') {
    return 'audio/wav';
  }
  if (ext === '.mp3') {
    return 'audio/mpeg';
  }
  if (ext === '.ogg') {
    return 'audio/ogg';
  }
  return 'application/octet-stream';
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

function escapePowerShellLiteral(value) {
  return value.replace(/'/g, "''");
}

async function removeIfExists(targetPath) {
  try {
    await fs.rm(targetPath, { recursive: true, force: true });
  } catch {
    // noop
  }
}

class Live2DModelLibrary {
  constructor(app) {
    this.app = app;
    this.rootDir = path.join(this.app.getPath('userData'), 'live2d-models');
    this.tempDir = path.join(this.rootDir, '.tmp');
  }

  async init() {
    await fs.mkdir(this.rootDir, { recursive: true });
    await fs.mkdir(this.tempDir, { recursive: true });
  }

  getProtocol() {
    return MODEL_PROTOCOL;
  }

  getRootDir() {
    return this.rootDir;
  }

  toModelUrl(absolutePath) {
    const relativePath = toPosixPath(path.relative(this.rootDir, absolutePath));
    const encoded = relativePath
      .split('/')
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return `${MODEL_PROTOCOL}:///${encoded}`;
  }

  resolveProtocolUrl(requestUrl) {
    const parsed = new URL(requestUrl);
    if (parsed.protocol !== `${MODEL_PROTOCOL}:`) {
      throw new Error('unsupported_protocol');
    }

    // Chromium may normalize custom URLs into two forms:
    // - openclaw-model:///folder/file.model3.json
    // - openclaw-model://folder/file.model3.json
    // For the second form, the first path segment is placed in `host`.
    const hostPart = parsed.host ? parsed.host.replace(/^\/+/, '') : '';
    const pathnamePart = parsed.pathname ? parsed.pathname.replace(/^\/+/, '') : '';
    const encodedRelativePath = [hostPart, pathnamePart].filter(Boolean).join('/');
    const relativePath = decodeURIComponent(encodedRelativePath).replace(/^\/+/, '');
    if (!relativePath) {
      throw new Error('empty_model_path');
    }

    const resolved = path.resolve(this.rootDir, relativePath);
    const rootWithSeparator = this.rootDir.endsWith(path.sep)
      ? this.rootDir
      : `${this.rootDir}${path.sep}`;

    if (resolved !== this.rootDir && !resolved.startsWith(rootWithSeparator)) {
      throw new Error('invalid_model_path');
    }

    return resolved;
  }

  async readAssetFromProtocolUrl(requestUrl) {
    const absolutePath = this.resolveProtocolUrl(requestUrl);
    const data = await fs.readFile(absolutePath);
    return {
      buffer: data,
      mimeType: getMimeType(absolutePath),
    };
  }

  async listModels() {
    await this.init();
    const files = await this.findModelFiles(this.rootDir);
    const models = files
      .map((filePath) => {
        const fileName = path.basename(filePath, '.model3.json');
        const parentName = path.basename(path.dirname(filePath));
        const name = parentName && parentName !== fileName ? `${parentName}/${fileName}` : fileName;
        const relativePath = toPosixPath(path.relative(this.rootDir, filePath));

        return {
          id: relativePath,
          name,
          path: this.toModelUrl(filePath),
          relativePath,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

    return models;
  }

  async importZip(zipPath) {
    await this.init();

    const importWorkspace = path.join(
      this.tempDir,
      `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    const extractedDir = path.join(importWorkspace, 'content');
    await fs.mkdir(extractedDir, { recursive: true });

    let targetDir = null;

    try {
      await this.extractZip(zipPath, extractedDir);
      const modelFilesInTemp = await this.findModelFiles(extractedDir);
      if (modelFilesInTemp.length === 0) {
        throw new Error('压缩包中未找到 .model3.json 文件。');
      }

      const targetFolder = createImportFolderName(zipPath);
      targetDir = path.join(this.rootDir, targetFolder);
      await fs.rename(extractedDir, targetDir);

      const importedModelFiles = await this.findModelFiles(targetDir);
      const importedModels = importedModelFiles.map((filePath) => {
        const fileName = path.basename(filePath, '.model3.json');
        const parentName = path.basename(path.dirname(filePath));
        const name = parentName && parentName !== fileName ? `${parentName}/${fileName}` : fileName;
        return {
          name,
          path: this.toModelUrl(filePath),
        };
      });

      return {
        folder: targetFolder,
        models: importedModels,
      };
    } finally {
      await removeIfExists(importWorkspace);
    }
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

  async findModelFiles(directory) {
    const result = [];
    const entries = await fs.readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === '.tmp') {
        continue;
      }

      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        const nested = await this.findModelFiles(fullPath);
        result.push(...nested);
        continue;
      }

      if (entry.isFile() && entry.name.toLowerCase().endsWith('.model3.json')) {
        result.push(fullPath);
      }
    }

    return result;
  }
}

module.exports = {
  Live2DModelLibrary,
  MODEL_PROTOCOL,
};
