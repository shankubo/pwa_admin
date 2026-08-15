import type { NavItem } from "./navItems";

// Point d'extension pour un plugin externe privé (ex: pwa-admin-plugin-imanote).
// Vide par défaut — un installeur de plugin réécrit ce fichier pour ajouter
// ses propres entrées de menu. Reste versionné avec ce contenu vide pour
// qu'un `git checkout -f origin/master` sur pwa_admin ne casse jamais le
// build : au pire le plugin redevient invisible jusqu'au prochain `install.sh`.
export const externalNavItems: NavItem[] = [];
