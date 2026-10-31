import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, orderBy, limit as firestoreLimit } from 'firebase/firestore';
import { getDatabase, ref as rtdbRef, get as rtdbGet, set as rtdbSet, update as rtdbUpdate, remove as rtdbRemove } from 'firebase/database';
import { getStorage, ref as storageRef, uploadBytes, getBytes, deleteObject, getDownloadURL } from 'firebase/storage';
import { randomUUID } from 'node:crypto';
import { hashPassword, checkPassword, sessionStore } from './localSecurity.js';
import { fail } from '../validators.js';

export const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || "AIzaSyAvyzaIN-J-EFmo3TXGSMgVFCejr3icWWs",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "dnassetssurvey.firebaseapp.com",
  databaseURL: process.env.FIREBASE_DATABASE_URL || "https://dnassetssurvey-default-rtdb.firebaseio.com",
  projectId: process.env.FIREBASE_PROJECT_ID || "dnassetssurvey",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "dnassetssurvey.firebasestorage.app",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "819233928046",
  appId: process.env.FIREBASE_APP_ID || "1:819233928046:web:3403cd2d00fe8c3132077f",
  measurementId: process.env.FIREBASE_MEASUREMENT_ID || "G-KPL15TZRK4"
};

// Initialize or reuse Firebase Client App
const firebaseApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const firebaseAuth = getAuth(firebaseApp);
const firestoreDb = getFirestore(firebaseApp);
const rtdb = getDatabase(firebaseApp);
const firebaseStorage = getStorage(firebaseApp);

export { firebaseApp, firebaseAuth, firestoreDb, rtdb, firebaseStorage };

// In-memory sessions store for JWT-compatible API auth
const sessions = sessionStore();

/**
 * Creates Firebase Storage wrapper matching existing Supabase storage API:
 *   storage.from(bucket).upload(path, buffer, options)
 *   storage.from(bucket).download(path)
 *   storage.from(bucket).remove([paths])
 *   storage.from(bucket).createSignedUrl(path, expiresIn, options)
 */
export function createFirebaseStorage(customStorage = firebaseStorage) {
  return {
    from(bucketName) {
      return {
        async upload(storagePath, buffer, options = {}) {
          try {
            const fileRef = storageRef(customStorage, storagePath);
            const metadata = { contentType: options.contentType || 'application/octet-stream' };
            await uploadBytes(fileRef, buffer, metadata);
            return { error: null };
          } catch (err) {
            console.error('[Firebase Storage] Upload error:', err.message);
            return { error: err };
          }
        },
        async download(storagePath) {
          try {
            const fileRef = storageRef(customStorage, storagePath);
            const bytes = await getBytes(fileRef);
            return { data: new Blob([bytes]), error: null };
          } catch (err) {
            console.error('[Firebase Storage] Download error:', err.message);
            return { data: null, error: err };
          }
        },
        async remove(paths) {
          try {
            for (const sp of paths) {
              const fileRef = storageRef(customStorage, sp);
              await deleteObject(fileRef).catch(e => {
                if (e.code !== 'storage/object-not-found') throw e;
              });
            }
            return { error: null };
          } catch (err) {
            console.error('[Firebase Storage] Remove error:', err.message);
            return { error: err };
          }
        },
        async createSignedUrl(storagePath, expiresIn = 60, options = {}) {
          try {
            const fileRef = storageRef(customStorage, storagePath);
            const downloadUrl = await getDownloadURL(fileRef);
            return {
              data: {
                signedUrl: downloadUrl + (options.download ? `?download=${encodeURIComponent(options.download)}` : '')
              },
              error: null
            };
          } catch (err) {
            console.warn('[Firebase Storage] createSignedUrl fallback:', err.message);
            return {
              data: {
                signedUrl: `/api/storage/download/${encodeURIComponent(storagePath)}`
              },
              error: null
            };
          }
        }
      };
    }
  };
}

