/**
 * Omega Profile Admin Routes
 *
 * Protected admin endpoints for managing Omega user profiles.
 * Routes:
 *   GET  /api/omega/profiles            — List all profiles (summary)
 *   GET  /api/omega/profiles/:userId    — Get full profile for a user
 *   POST /api/omega/backup              — Trigger manual backup to R2
 *   POST /api/omega/restore             — Restore from R2 backup
 *   GET  /api/omega/backups             — List available R2 backups
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types';
import {
  loadProfile,
  backupProfilesToR2,
  restoreProfilesFromR2,
  listBackups,
} from '../integrations/omega-profiles';

const omegaAdmin = new Hono<AppEnv>();

// ── List all profiles (summary view) ────────────────────────────────────────
omegaAdmin.get('/profiles', async (c) => {
  const kv = c.env.OMEGA_PROFILES;
  if (!kv) {
    return c.json({ error: 'OMEGA_PROFILES KV not configured' }, 500);
  }

  const profiles: Array<{
    userId: number;
    displayName: string;
    interactionCount: number;
    understandingConfidence: number;
    lastSeen: string;
    topInterests: string[];
  }> = [];

  let cursor: string | undefined;
  do {
    const list = await kv.list({ prefix: 'user:', cursor });
    for (const key of list.keys) {
      const profile = await kv.get(key.name, 'json') as Record<string, unknown> | null;
      if (profile) {
        const topicFreq = (profile.topicFrequency || {}) as Record<string, number>;
        const topInterests = Object.entries(topicFreq)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 3)
          .map(([t]) => t);
        profiles.push({
          userId: profile.userId as number,
          displayName: profile.displayName as string,
          interactionCount: profile.interactionCount as number,
          understandingConfidence: profile.understandingConfidence as number,
          lastSeen: profile.lastSeen as string,
          topInterests,
        });
      }
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);

  return c.json({
    totalProfiles: profiles.length,
    profiles: profiles.sort((a, b) => b.interactionCount - a.interactionCount),
  });
});

// ── Get full profile for a specific user ────────────────────────────────────
omegaAdmin.get('/profiles/:userId', async (c) => {
  const kv = c.env.OMEGA_PROFILES;
  if (!kv) {
    return c.json({ error: 'OMEGA_PROFILES KV not configured' }, 500);
  }

  const userId = parseInt(c.req.param('userId'), 10);
  if (isNaN(userId)) {
    return c.json({ error: 'Invalid userId' }, 400);
  }

  const profile = await loadProfile(kv, userId, '');
  if (profile.interactionCount === 0 && profile.displayName === '') {
    return c.json({ error: 'Profile not found' }, 404);
  }

  return c.json(profile);
});

// ── Trigger manual backup to R2 ────────────────────────────────────────────
omegaAdmin.post('/backup', async (c) => {
  const kv = c.env.OMEGA_PROFILES;
  const r2 = c.env.MOLTBOT_BUCKET;
  if (!kv || !r2) {
    return c.json({ error: 'OMEGA_PROFILES KV or R2 bucket not configured' }, 500);
  }

  try {
    const result = await backupProfilesToR2(kv, r2);
    return c.json({
      success: true,
      ...result,
      message: `Backed up ${result.profileCount} profiles to ${result.backupKey}`,
    });
  } catch (err) {
    console.error('[Omega Admin] Backup failed:', err);
    return c.json({ error: 'Backup failed', details: String(err) }, 500);
  }
});

// ── Restore from R2 backup ─────────────────────────────────────────────────
omegaAdmin.post('/restore', async (c) => {
  const kv = c.env.OMEGA_PROFILES;
  const r2 = c.env.MOLTBOT_BUCKET;
  if (!kv || !r2) {
    return c.json({ error: 'OMEGA_PROFILES KV or R2 bucket not configured' }, 500);
  }

  let backupKey: string | undefined;
  try {
    const body = await c.req.json<{ backupKey?: string }>();
    backupKey = body.backupKey;
  } catch {
    // No body — will restore from latest
  }

  try {
    const result = await restoreProfilesFromR2(kv, r2, backupKey);
    return c.json({
      success: true,
      ...result,
      source: backupKey || 'omega-profiles/latest.json',
      message: `Restored ${result.restored} profiles, merged ${result.merged}, skipped ${result.skipped} (newer in KV)`,
    });
  } catch (err) {
    console.error('[Omega Admin] Restore failed:', err);
    return c.json({ error: 'Restore failed', details: String(err) }, 500);
  }
});

// ── List available R2 backups ──────────────────────────────────────────────
omegaAdmin.get('/backups', async (c) => {
  const r2 = c.env.MOLTBOT_BUCKET;
  if (!r2) {
    return c.json({ error: 'R2 bucket not configured' }, 500);
  }

  try {
    const backups = await listBackups(r2);
    return c.json({
      totalBackups: backups.length,
      backups: backups.sort((a, b) => b.uploaded.getTime() - a.uploaded.getTime()),
    });
  } catch (err) {
    console.error('[Omega Admin] List backups failed:', err);
    return c.json({ error: 'Failed to list backups', details: String(err) }, 500);
  }
});

export default omegaAdmin;
