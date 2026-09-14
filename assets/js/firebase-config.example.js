/* ============================================================
   FLEXFAM — Firebase web config (EXAMPLE / TEMPLATE)

   Setup:
   1. Copy this file to:  assets/js/firebase-config.js
   2. Firebase Console → Project settings → General → Your apps
      → Web app → "SDK setup and configuration" → Config
   3. Paste your real values below.

   NOTE: The Firebase *web* config is a public identifier, not a
   secret — data safety is enforced by firestore.rules. Never put
   service-account keys or any private secret in frontend code.
   `assets/js/firebase-config.js` is gitignored so each deployment
   keeps its own copy.
   ============================================================ */

window.FF_FIREBASE_CONFIG = {
  apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "your-project-id.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project-id.appspot.com",
  messagingSenderId: "PASTE_YOUR_SENDER_ID",
  appId: "PASTE_YOUR_APP_ID",
};

/* Admin allowlist — must match the email(s) you allow in firestore.rules.
   Only these Firebase Auth (email/password) accounts can open admin.html. */
window.FF_ADMIN_EMAILS = ["admin@example.com"];
