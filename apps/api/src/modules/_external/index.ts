import type { FastifyInstance } from "fastify";

// Point d'extension pour un plugin externe privé (ex: pwa-admin-plugin-imanote).
// No-op par défaut — un installeur de plugin réécrit ce fichier pour enregistrer
// ses propres routes. Reste versionné avec ce contenu no-op pour qu'un
// `git checkout -f origin/master` sur pwa_admin ne casse jamais le build :
// au pire le plugin redevient invisible jusqu'au prochain `install.sh`.
export async function registerExternalModules(_api: FastifyInstance): Promise<void> {}
