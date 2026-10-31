// Firebase Web SDK integration for DNAssets Survey Portal
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-analytics.js";

export const firebaseConfig = {
  apiKey: "AIzaSyAvyzaIN-J-EFmo3TXGSMgVFCejr3icWWs",
  authDomain: "dnassetssurvey.firebaseapp.com",
  databaseURL: "https://dnassetssurvey-default-rtdb.firebaseio.com",
  projectId: "dnassetssurvey",
  storageBucket: "dnassetssurvey.firebasestorage.app",
  messagingSenderId: "819233928046",
  appId: "1:819233928046:web:3403cd2d00fe8c3132077f",
  measurementId: "G-KPL15TZRK4"
};

// Initialize Firebase App
export const app = initializeApp(firebaseConfig);

// Initialize Firebase Analytics safely (never breaks if adblocker or cookies blocked)
export let analytics = null;
if (typeof window !== 'undefined') {
  isSupported().then(supported => {
    if (supported) {
      analytics = getAnalytics(app);
      console.log('[Firebase] Analytics connected:', firebaseConfig.measurementId);
    }
  }).catch(() => {
    // Offline or adblocker safe fallback
  });
}

export default app;

