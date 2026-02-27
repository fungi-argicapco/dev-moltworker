import type { Sandbox } from '@cloudflare/sandbox';

export interface SyncResult {
  success: boolean;
  lastSync?: string;
  error?: string;
  details?: string;
}

const LAST_SYNC_FILE = '/tmp/.last-sync';

// R2 keys for each sync target
const R2_KEYS = {
  config: 'backups/config.tar.gz',
  workspace: 'backups/workspace.tar.gz',
  skills: 'backups/skills.tar.gz',
} as const;

// Container paths for each sync target
const CONTAINER_PATHS = {
  config: '/root/.openclaw',
  workspace: '/root/clawd',
  skills: '/root/clawd/skills',
} as const;

/**
 * Detect which config directory exists in the container.
 */
async function detectConfigDir(sandbox: Sandbox): Promise<string | null> {
  const check = await sandbox.exec(
    'test -f /root/.openclaw/openclaw.json && echo openclaw || ' +
    '(test -f /root/.clawdbot/clawdbot.json && echo clawdbot || echo none)',
  );
  const result = check.stdout?.trim();
  if (result === 'openclaw') return '/root/.openclaw';
  if (result === 'clawdbot') return '/root/.clawdbot';
  return null;
}

/**
 * Tar a directory in the container and return it as a Uint8Array.
 * Returns null if the directory doesn't exist.
 */
async function tarFromContainer(
  sandbox: Sandbox,
  dirPath: string,
  excludes: string[] = [],
): Promise<Uint8Array | null> {
  // Check if directory exists
  const check = await sandbox.exec(`test -d ${dirPath} && echo yes || echo no`);
  if (check.stdout?.trim() !== 'yes') return null;

  // Build exclude flags
  const excludeFlags = excludes.map((e) => `--exclude='${e}'`).join(' ');

  // Tar to a temp file (binary stdout from exec can be unreliable)
  const tarFile = `/tmp/sync-${Date.now()}.tar.gz`;
  const tarResult = await sandbox.exec(
    `tar czf ${tarFile} -C $(dirname ${dirPath}) $(basename ${dirPath}) ${excludeFlags} 2>/dev/null; echo $?`,
    { timeout: 120000 },
  );

  if (!tarResult.success) {
    console.error('[SYNC] tar failed:', tarResult.stderr?.slice(-500));
    return null;
  }

  // Read the tar file as base64 string (binary-safe transfer)
  const b64Result = await sandbox.exec(`base64 -w0 ${tarFile} && echo`);
  // Clean up temp file
  await sandbox.exec(`rm -f ${tarFile}`);

  const b64 = b64Result.stdout?.trim();
  if (!b64) return null;

  // Decode base64 to Uint8Array
  const binaryString = atob(b64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Extract a tarball into the container at the specified target directory.
 */
async function untarToContainer(
  sandbox: Sandbox,
  data: ArrayBuffer | ReadableStream,
  targetDir: string,
): Promise<boolean> {
  const tarFile = `/tmp/restore-${Date.now()}.tar.gz`;

  // Convert data to base64 string and write via exec (binary-safe)
  let bytes: Uint8Array;
  if (data instanceof ArrayBuffer) {
    bytes = new Uint8Array(data);
  } else {
    // ReadableStream — collect chunks
    const reader = data.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    bytes = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
  }

  // Encode as base64 for binary-safe transfer
  let b64 = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    b64 += String.fromCharCode(...slice);
  }
  b64 = btoa(b64);

  // Write via base64 decode in container
  await sandbox.exec(`echo '${b64}' | base64 -d > ${tarFile}`);

  // Ensure target parent directory exists
  await sandbox.exec(`mkdir -p ${targetDir}`);

  // Extract to the target directory (tarball contains relative paths)
  const result = await sandbox.exec(`tar xzf ${tarFile} -C ${targetDir} 2>&1`, { timeout: 120000 });

  // Clean up
  await sandbox.exec(`rm -f ${tarFile}`);

  if (!result.success) {
    console.error('[SYNC] untar failed:', result.stderr?.slice(-500));
    return false;
  }

  return true;
}

/**
 * Backup: Sync container directories to R2 via Worker binding.
 * Replaces rclone-based sync with tar + R2 binding (no S3 credentials needed).
 */
export async function syncToR2(sandbox: Sandbox, bucket: R2Bucket): Promise<SyncResult> {
  const configDir = await detectConfigDir(sandbox);
  if (!configDir) {
    return {
      success: false,
      error: 'Sync aborted: no config file found',
      details: 'Neither openclaw.json nor clawdbot.json found in config directory.',
    };
  }

  // Sync config (required)
  const configTar = await tarFromContainer(sandbox, configDir, [
    '*.lock',
    '*.log',
    '*.tmp',
    '.git',
  ]);
  if (!configTar) {
    return { success: false, error: 'Config backup failed: could not create tarball' };
  }
  await bucket.put(R2_KEYS.config, configTar, {
    httpMetadata: { contentType: 'application/gzip' },
    customMetadata: { source: configDir, timestamp: new Date().toISOString() },
  });

  // Sync workspace (non-fatal)
  const workspaceTar = await tarFromContainer(sandbox, CONTAINER_PATHS.workspace, [
    'skills',
    '.git',
    'node_modules',
  ]);
  if (workspaceTar) {
    await bucket.put(R2_KEYS.workspace, workspaceTar, {
      httpMetadata: { contentType: 'application/gzip' },
      customMetadata: { source: CONTAINER_PATHS.workspace, timestamp: new Date().toISOString() },
    });
  }

  // Sync skills (non-fatal)
  const skillsTar = await tarFromContainer(sandbox, CONTAINER_PATHS.skills, []);
  if (skillsTar) {
    await bucket.put(R2_KEYS.skills, skillsTar, {
      httpMetadata: { contentType: 'application/gzip' },
      customMetadata: { source: CONTAINER_PATHS.skills, timestamp: new Date().toISOString() },
    });
  }

  // Write timestamp
  await sandbox.exec(`date -Iseconds > ${LAST_SYNC_FILE}`);
  const tsResult = await sandbox.exec(`cat ${LAST_SYNC_FILE}`);
  const lastSync = tsResult.stdout?.trim();

  return { success: true, lastSync };
}

/**
 * Restore: Pull backups from R2 and extract into the container.
 * Called at container startup to restore persisted state.
 */
export async function restoreFromR2(sandbox: Sandbox, bucket: R2Bucket): Promise<SyncResult> {
  let restoredAny = false;

  // Restore config — extract to /root (tarball contains .openclaw/...)
  const configObj = await bucket.get(R2_KEYS.config);
  if (configObj) {
    console.log('[SYNC] Restoring config from R2...');
    const ok = await untarToContainer(sandbox, configObj.body, '/root');
    if (ok) {
      restoredAny = true;
      console.log('[SYNC] Config restored');
    } else {
      return { success: false, error: 'Config restore failed: could not extract tarball' };
    }
  } else {
    console.log('[SYNC] No config backup found in R2, starting fresh');
  }

  // Restore workspace — extract to /root (tarball contains clawd/...)
  const workspaceObj = await bucket.get(R2_KEYS.workspace);
  if (workspaceObj) {
    console.log('[SYNC] Restoring workspace from R2...');
    const ok = await untarToContainer(sandbox, workspaceObj.body, '/root');
    if (ok) {
      restoredAny = true;
      console.log('[SYNC] Workspace restored');
    }
  }

  // Restore skills — extract to /root/clawd (tarball contains skills/...)
  const skillsObj = await bucket.get(R2_KEYS.skills);
  if (skillsObj) {
    console.log('[SYNC] Restoring skills from R2...');
    const ok = await untarToContainer(sandbox, skillsObj.body, '/root/clawd');
    if (ok) {
      restoredAny = true;
      console.log('[SYNC] Skills restored');
    }
  }

  const lastSync = configObj?.customMetadata?.timestamp;

  return {
    success: true,
    lastSync,
    details: restoredAny ? 'Restored from R2 backup' : 'No backups found, starting fresh',
  };
}
