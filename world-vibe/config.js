// Single source of truth for the World Vibe install CTA. When the App Store
// listing goes live, change this one value; no other file needs an edit.
window.SOMACHECK_INSTALL_URL = window.SOMACHECK_INSTALL_URL || 'https://testflight.apple.com/join/C4mAH3zz';

// Web sign-in (Supabase Auth magic link). The publishable key is public by
// design and the only key that may ever appear here; never a service key.
// Empty until the release sets it: the Sign in control stays hidden while empty.
window.SOMACHECK_SUPABASE_PUBLISHABLE_KEY = window.SOMACHECK_SUPABASE_PUBLISHABLE_KEY || '';
