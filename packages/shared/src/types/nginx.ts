// Compatibility shim — every apps/web/apps/api consumer has already been
// migrated to import from "./webserver.js" directly (see the Apache-parity
// implementation plan's Phase 5), EXCEPT the private, git-untracked imanote
// plugin (packages/shared/src/types/imanote.ts imports NginxCertStatus from
// here, apps/api/src/modules/imanote/imanote.service.ts imports NginxService
// by its unchanged name/path). This file therefore stays PERMANENTLY, not
// just for a transition window — removing it breaks a plugin this repo
// doesn't control the source of. New code should import from "./webserver.js"
// directly; this file exists solely for imanote's sake.
export type {
  WebServerStatus as NginxStatus,
  VhostSummary as NginxVhostSummary,
  VhostDetail as NginxVhostDetail,
  VhostAccessibility as NginxVhostAccessibility,
  ErrorLogEntry as NginxErrorLogEntry,
  VhostErrorSummary as NginxVhostErrorSummary,
  ConfigBackupRun as NginxConfigBackupRun,
  ConfigSnapshot as NginxConfigSnapshot,
  CertStatus as NginxCertStatus,
  GuidedHeaders as NginxGuidedHeaders,
  GuidedMode as NginxGuidedMode,
  GuidedTls as NginxGuidedTls,
  GuidedGzip as NginxGuidedGzip,
  GuidedLocations as NginxGuidedLocations,
  GuidedFormModel as NginxGuidedFormModel,
} from "./webserver.js";
