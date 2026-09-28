'use strict';

/**
 * Hackerly runtime configuration.
 *
 * Every value has a working default so that `docker compose up` and
 * `npm start` produce a fully functional, self-contained portal with no
 * environment file and no network access. Firebase is strictly optional.
 */

const path = require('node:path');

const root = path.join(__dirname, '..');

function bool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 10000),
  host: process.env.HOST || '0.0.0.0',

  // Storage — SQLite file, kept outside the app source so it survives rebuilds.
  databasePath: process.env.DATABASE_PATH || path.join(root, 'data', 'hackerly.db'),

  // Public origin, used for canonical URLs and the seeded absolute links.
  publicOrigin: (process.env.PUBLIC_ORIGIN || 'http://localhost:10000').replace(/\/+$/, ''),

  // Sessions
  sessionCookieName: process.env.SESSION_COOKIE || 'hkl_session',
  sessionTtlDays: int(process.env.SESSION_TTL_DAYS, 30),
  // Set true when serving over HTTPS so the session cookie carries Secure.
  secureCookies: bool(process.env.SECURE_COOKIES, false),

  // Trust proxy for correct req.protocol / client IPs behind a load balancer.
  trustProxy: bool(process.env.TRUST_PROXY, false),

  // Seed demo content on first boot. Never destructive.
  seedOnBoot: bool(process.env.SEED_ON_BOOT, true),
  seedDemo: bool(process.env.SEED_DEMO, true),

  // Firebase is optional. When credentials are absent Hackerly runs fully local.
  firebase: {
    enabled: bool(process.env.FIREBASE_ENABLED, false),
    // Path to a service-account JSON file. Never commit this file.
    serviceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT || '',
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    // Optional: verify Firebase Auth ID tokens presented by the hosted web client.
    verifyIdTokens: bool(process.env.FIREBASE_VERIFY_ID_TOKENS, false),
  },

  root,
};

module.exports = config;
