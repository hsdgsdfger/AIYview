'use strict';

const { shouldAllowRequest } = require('../core/netPolicy.cjs');

/**
 * 零网络：除本地资源与开发期 HMR 外，所有请求在 session 层直接取消。
 */
function applyNetworkPolicy(ses, options = {}) {
  const devServerUrl = options.devServerUrl || '';
  ses.webRequest.onBeforeRequest((details, callback) => {
    const allow = shouldAllowRequest(details.url, { devServerUrl });
    if (!allow && options.onBlocked) options.onBlocked(details.url);
    callback({ cancel: !allow });
  });

  ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
}

module.exports = { applyNetworkPolicy };
