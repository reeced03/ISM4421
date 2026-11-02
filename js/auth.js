// Optional "Sign in with Google" using Google Identity Services. There is no
// backend: this identifies the visitor to the page for display only, so never
// use it to protect data. The client ID is public by design.
const CLIENT_ID = "970082081053-ueh13pd9ujp6raduvt7c088oarfrjnod.apps.googleusercontent.com";
const GSI_SRC = "https://accounts.google.com/gsi/client";
const STORAGE_KEY = "profile";

const root = document.querySelector("#auth");

// ---------- Profile (per-viewer, best effort) ----------
function loadProfile() {
  try {
    const p = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return p && typeof p.name === "string" ? p : null;
  } catch { return null; }
}
function saveProfile(profile) {
  try {
    if (profile) localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}

// Decode the ID token's payload (base64url-encoded UTF-8 JSON).
function decodeCredential(credential) {
  const b64 = credential.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

// ---------- Rendering ----------
function renderSignedOut() {
  root.replaceChildren();
  if (!window.google?.accounts?.id) return;
  const narrow = matchMedia("(max-width: 640px)").matches;
  google.accounts.id.renderButton(root, {
    type: narrow ? "icon" : "standard",
    theme: "outline", size: "medium", shape: "pill", text: "signin_with",
  });
}

function renderSignedIn(profile) {
  const user = document.createElement("span");
  user.className = "auth-user";
  user.title = profile.email || profile.name;

  if (profile.picture) {
    const img = document.createElement("img");
    img.className = "auth-avatar";
    img.src = profile.picture;
    img.alt = "";
    img.width = 28;
    img.height = 28;
    img.referrerPolicy = "no-referrer"; // Google's photo host can reject requests with a referrer
    user.append(img);
  }
  const name = document.createElement("span");
  name.className = "auth-name";
  name.textContent = profile.givenName || profile.name;
  user.append(name);

  const out = document.createElement("button");
  out.type = "button";
  out.className = "auth-out";
  out.textContent = "Sign out";
  out.addEventListener("click", signOut);

  root.replaceChildren(user, out);
}

// ---------- Sign in / out ----------
function onCredential({ credential }) {
  const t = decodeCredential(credential);
  const profile = { name: t.name || t.email, givenName: t.given_name, email: t.email, picture: t.picture };
  saveProfile(profile);
  renderSignedIn(profile);
}

function signOut() {
  saveProfile(null);
  window.google?.accounts?.id?.disableAutoSelect();
  renderSignedOut();
}

// ---------- Startup ----------
const saved = loadProfile();
if (saved) renderSignedIn(saved);

// Load Google's script last: if it is blocked, the rest of the site is unaffected.
const script = document.createElement("script");
script.src = GSI_SRC;
script.async = true;
script.onload = () => {
  google.accounts.id.initialize({ client_id: CLIENT_ID, callback: onCredential });
  if (!loadProfile()) renderSignedOut();
};
document.head.append(script);
