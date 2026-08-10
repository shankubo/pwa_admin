/** A server registered client-side to switch between — each is a fully
 * independent pwa-admin deployment (own DB, own auth, own Tailscale
 * identity), not a remote host managed through a shared backend. */
export interface ServerConnection {
  id: string;
  label: string;
  baseUrl: string;
}
