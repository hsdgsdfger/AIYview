'use strict';

/**
 * 网络白名单（纯逻辑层）
 *
 * 产品硬约束：零网络请求。渲染进程只允许本地资源与开发期 HMR 地址，
 * 其它 http/https 一律拦截。无法解析的 URL 按“拦截”处理（fail closed）。
 */

const LOCAL_SCHEMES = new Set(['file:', 'data:', 'blob:', 'devtools:', 'about:', 'chrome:', 'chrome-extension:', 'javascript:']);

function parse(rawUrl) {
  try {
    return new URL(String(rawUrl));
  } catch {
    return null;
  }
}

function sameOrigin(a, b) {
  return a.protocol === b.protocol && a.host === b.host;
}

/**
 * @param {string} rawUrl
 * @param {{devServerUrl?: string}} [options]
 * @returns {boolean} true = 应当拦截
 */
function isBlockedUrl(rawUrl, options = {}) {
  const url = parse(rawUrl);
  if (!url) return true;

  if (LOCAL_SCHEMES.has(url.protocol)) return false;

  const dev = options.devServerUrl ? parse(options.devServerUrl) : null;
  if (dev && (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'ws:')) {
    if (url.protocol === 'ws:' || url.protocol === 'wss:') {
      return dev.host === url.host ? false : true;
    }
    return sameOrigin(dev, url) ? false : true;
  }

  return true;
}

/**
 * 给 session.webRequest 用的判定函数：返回值表示是否放行。
 */
function shouldAllowRequest(rawUrl, options = {}) {
  return !isBlockedUrl(rawUrl, options);
}

module.exports = {
  LOCAL_SCHEMES,
  isBlockedUrl,
  shouldAllowRequest,
};
