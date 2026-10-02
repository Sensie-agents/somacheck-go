// Web session seam. There is no web sign-in yet (WP12 wires Supabase Auth and
// replaces this body). Until then no token exists and signed-in surfaces
// must say so instead of pretending.
export function getAccessToken() {
  return null;
}
