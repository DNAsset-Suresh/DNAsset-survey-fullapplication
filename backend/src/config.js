import { z } from 'zod';

export function configuration(env = process.env) {
  const number = (name, fallback, max) => z.coerce.number().int().min(1).max(max).parse(env[name] || fallback);
  const url = env.SUPABASE_URL || '';
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY || '';
  const secretKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '';
  const production = env.NODE_ENV === 'production';
  const origins = (env.FRONTEND_ORIGINS || 'http://localhost:3000').split(',').map(s => s.trim());
  const databaseUrl = env.USE_LOCAL_DB === 'true' ? '' : (env.DATABASE_URL || '');
  const isLocal = env.USE_LOCAL_DB === 'true' || Boolean(databaseUrl);
  const useFirebase = env.USE_FIREBASE === 'true';
  const configured = Boolean((url && publishableKey && secretKey) || isLocal || useFirebase);
  if (production && (!configured || origins.some(o => !o.startsWith('https://')))) {
    throw new Error('Production requires Supabase configuration and explicit HTTPS frontend origins.');
  }
  const smtpUser = env.SMTP_USER || '';
  const smtpPass = (env.SMTP_PASSWORD || env.SMTP_PASS || '').replace(/\s+/g, '');
  const adminEmail = (env.ADMIN_NOTIFICATION_EMAIL || env.ADMIN_EMAIL || smtpUser || '').trim();
  const smtpPort = number('SMTP_PORT', 465, 65535);
  const smtpSecure = env.SMTP_SECURE !== undefined ? env.SMTP_SECURE === 'true' : smtpPort === 465;
  const smtp = {
    host: env.SMTP_HOST || 'smtp.gmail.com',
    port: smtpPort,
    secure: smtpSecure,
    user: smtpUser,
    pass: smtpPass,
    from: env.SMTP_FROM || (smtpUser ? `DNAssets Survey <${smtpUser}>` : 'no-reply@dnassets.com'),
    adminEmail,
    enabled: env.EMAIL_NOTIFICATIONS_ENABLED !== 'false' && Boolean(smtpUser && smtpPass)
  };
  const firebase = {
    apiKey: env.FIREBASE_API_KEY || "AIzaSyAvyzaIN-J-EFmo3TXGSMgVFCejr3icWWs",
    authDomain: env.FIREBASE_AUTH_DOMAIN || "dnassetssurvey.firebaseapp.com",
    databaseURL: env.FIREBASE_DATABASE_URL || "https://dnassetssurvey-default-rtdb.firebaseio.com",
    projectId: env.FIREBASE_PROJECT_ID || "dnassetssurvey",
    storageBucket: env.FIREBASE_STORAGE_BUCKET || "dnassetssurvey.firebasestorage.app",
    messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID || "819233928046",
    appId: env.FIREBASE_APP_ID || "1:819233928046:web:3403cd2d00fe8c3132077f",
    measurementId: env.FIREBASE_MEASUREMENT_ID || "G-KPL15TZRK4"
  };
  return { url, publishableKey, secretKey, configured, isLocal, production, databaseUrl,
    useFirebase,
    firebase,
    surveyBackupEnabled:env.SURVEY_BACKUP_ENABLED!=='false',surveyBackupDirectory:env.SURVEY_BACKUP_DIRECTORY||'backups/operations',
    storageCleanupEnabled: env.STORAGE_CLEANUP_ENABLED === 'true',
    databaseCaFile: env.PGSSLROOTCERT || '', localDatabaseFile:env.LOCAL_DATABASE_FILE || '',storageDirectory:env.LOCAL_STORAGE_DIRECTORY || '',
    bucket: env.SUPABASE_STORAGE_BUCKET || 'land-documents', port: number('PORT', 3000, 65535),
    maxFileBytes: number('MAX_FILE_SIZE_MB', 20, 50) * 1024 * 1024, origins,
    trustProxy: z.coerce.number().int().min(0).max(5).parse(env.TRUST_PROXY_HOPS || 0),
    smtp };
}
