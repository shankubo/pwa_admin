import type { ReactElement } from "react";

export interface ExternalRoute {
  path: string;
  element: ReactElement;
}

// Point d'extension pour un plugin externe privé (ex: pwa-admin-plugin-imanote).
// Vide par défaut — un installeur de plugin réécrit ce fichier pour ajouter
// ses propres écrans. Reste versionné avec ce contenu vide pour qu'un
// `git checkout -f origin/master` sur pwa_admin ne casse jamais le build :
// au pire le plugin redevient invisible jusqu'au prochain `install.sh`.
export const externalRoutes: ExternalRoute[] = [];
