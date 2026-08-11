export const APP_VERSION =
  `Build #${__BUILD_NUMBER__}` + (__GIT_DATE__ ? ` · ${__GIT_DATE__} · ${__GIT_COMMIT__}` : ` · ${__GIT_COMMIT__}`);
