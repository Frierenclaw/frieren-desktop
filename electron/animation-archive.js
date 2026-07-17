import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import * as tar from 'tar';

function sanitizeVrmaName(rawName) {
  const base = path.basename(rawName).replace(/[\x00-\x1f]/g, '').trim();
  if (!base || !base.toLowerCase().endsWith('.vrma')) return null;
  if (base === '.vrma' || base.includes('..')) return null;
  return base;
}

async function writeAnimationFile(destDir, name, buffer) {
  const safeName = sanitizeVrmaName(name);
  if (!safeName) return null;

  let finalName = safeName;
  let counter = 1;
  while (fs.existsSync(path.join(destDir, finalName))) {
    finalName = `${safeName.replace(/\.vrma$/i, '')}_${counter}.vrma`;
    counter += 1;
  }

  const filePath = path.join(destDir, finalName);
  await fsp.writeFile(filePath, buffer, { mode: 0o644 });
  return { name: path.basename(finalName, path.extname(finalName)), filePath };
}

async function extractZip(buffer, destDir) {
  const zip = new AdmZip(buffer);
  const results = [];

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    if (!entry.entryName.toLowerCase().endsWith('.vrma')) continue;

    const data = entry.getData();
    const written = await writeAnimationFile(destDir, entry.entryName, data);
    if (written) results.push(written);
  }

  return results;
}

async function extractTarGz(buffer, destDir) {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'frieren-anim-'));
  const tempTarPath = path.join(tempRoot, 'archive.tar.gz');
  const tempExtractDir = path.join(tempRoot, 'extracted');
  await fsp.mkdir(tempExtractDir, { recursive: true });

  try {
    await fsp.writeFile(tempTarPath, buffer);

    await tar.x({
      file: tempTarPath,
      cwd: tempExtractDir,
      filter: (entryPath) => entryPath.toLowerCase().endsWith('.vrma'),
    });

    const results = [];
    const walk = async (dir) => {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.vrma')) {
          const data = await fsp.readFile(fullPath);
          const written = await writeAnimationFile(destDir, entry.name, data);
          if (written) results.push(written);
        }
      }
    };
    await walk(tempExtractDir);

    return results;
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

export async function downloadAndExtractAnimations(url, destDir) {
  await fsp.rm(destDir, { recursive: true, force: true });
  await fsp.mkdir(destDir, { recursive: true });

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download animations (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());

  const lowerUrl = url.toLowerCase().split('?')[0];

  if (lowerUrl.endsWith('.vrma')) {
    const fallbackName = `${crypto.randomUUID()}.vrma`;
    const urlName = path.basename(new URL(url).pathname) || fallbackName;
    const written = await writeAnimationFile(destDir, urlName, buffer);
    return written ? [written] : [];
  }

  if (lowerUrl.endsWith('.zip')) {
    return extractZip(buffer, destDir);
  }

  if (lowerUrl.endsWith('.tar.gz') || lowerUrl.endsWith('.tgz')) {
    return extractTarGz(buffer, destDir);
  }

  throw new Error(`Unsupported animation archive format: ${url}`);
}