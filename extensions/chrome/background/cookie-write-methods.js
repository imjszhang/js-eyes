'use strict';

(() => {
function createMethods(extensionApi) {
  if (!extensionApi) throw new TypeError('extensionApi is required');
  return {
async handleSetCookies(message) {
    try {
      const { cookies = [], overwrite = 'merge', domain = '', requestId } = message;
      if (!Array.isArray(cookies)) {
        this.sendMessage({
          type: 'error',
          message: 'cookies 必须是数组',
          requestId,
        });
        return;
      }

      const planned = [];
      const reasons = [];
      let skipped = 0;
      for (const raw of cookies) {
        const skip = this.skipSetCookieReason(raw);
        if (skip) {
          skipped += 1;
          reasons.push({ name: raw && raw.name ? raw.name : null, reason: skip });
          continue;
        }
        planned.push(raw);
      }

      if (overwrite === 'replace' && domain) {
        const existing = await this.getCookiesByDomain(domain, true);
        const incoming = new Set(planned.map((cookie) => this.cookieIdentity(cookie)));
        for (const cookie of existing) {
          if (incoming.has(this.cookieIdentity(cookie))) continue;
          const url = this.buildCookieUrl(cookie);
          if (!url || !cookie.name) continue;
          try {
            await extensionApi.cookies.remove({ url, name: cookie.name });
          } catch (error) {
            console.warn(`[Cookie写入] 删除失败 ${cookie.name}: ${error.message}`);
          }
        }
      }

      let set = 0;
      for (const cookie of planned) {
        try {
          const details = this.toExtensionSetCookie(cookie);
          if (!details.url) {
            skipped += 1;
            reasons.push({ name: cookie.name || null, reason: 'missing-domain' });
            continue;
          }
          await extensionApi.cookies.set(details);
          set += 1;
        } catch (error) {
          skipped += 1;
          reasons.push({ name: cookie.name || null, reason: 'set-failed' });
          console.warn(`[Cookie写入] 写入失败 ${cookie.name}: ${error.message}`);
        }
      }

      this.sendMessage({
        type: 'set_cookies_complete',
        set,
        skipped,
        reasons,
        requestId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('处理写入Cookies请求时出错:', error);
      this.sendMessage({
        type: 'error',
        message: error.message,
        requestId: message.requestId,
      });
    }
  },

cookieIdentity(cookie) {
    const domain = String(cookie && cookie.domain || '').replace(/^\./, '').toLowerCase();
    const path = cookie && cookie.path ? cookie.path : '/';
    const name = cookie && cookie.name ? cookie.name : '';
    return `${name}\0${domain}\0${path}`;
  },

buildCookieUrl(cookie) {
    const host = String(cookie && cookie.domain || '').replace(/^\./, '');
    if (!host) return null;
    const scheme = cookie && cookie.secure ? 'https' : 'http';
    const path = cookie && cookie.path && String(cookie.path).startsWith('/')
      ? cookie.path
      : `/${(cookie && cookie.path) || ''}`;
    return `${scheme}://${host}${path}`;
  },

skipSetCookieReason(cookie) {
    if (!cookie || typeof cookie !== 'object' || !cookie.name) return 'invalid';
    if (cookie.partitionKey || cookie.partition || cookie.partitioned) return 'chips-partition';
    if (cookie.storeId && cookie.storeId !== '0' && cookie.storeId !== 0 && cookie.storeId !== 'default') {
      return 'unknown-store';
    }
    const sameSiteValues = ['strict', 'lax', 'none', 'unspecified', 'no_restriction', 'default'];
    if (cookie.sameSite && !sameSiteValues.includes(String(cookie.sameSite).toLowerCase())) {
      return 'unknown-samesite';
    }
    const secure = cookie.secure === true;
    const sameSite = String(cookie.sameSite || '').toLowerCase();
    if ((sameSite === 'none' || sameSite === 'no_restriction') && !secure) return 'samesite-none';
    if (cookie.name.startsWith('__Host-')) {
      if (!secure || (cookie.path && cookie.path !== '/') || (cookie.domain && String(cookie.domain).startsWith('.'))) {
        return 'host-prefix';
      }
    }
    if (cookie.name.startsWith('__Secure-') && !secure) return 'secure-prefix';
    const expires = cookie.expires ?? cookie.expirationDate ?? cookie.expiry;
    if (typeof expires === 'number' && expires > 0) {
      const ms = expires > 1e12 ? expires : expires * 1000;
      if (ms <= Date.now()) return 'expired';
    }
    if (!cookie.domain) return 'missing-domain';
    return null;
  },

toExtensionSetCookie(cookie) {
    const details = {
      url: this.buildCookieUrl(cookie),
      name: cookie.name,
      value: cookie.value == null ? '' : String(cookie.value),
      path: cookie.path || '/',
      secure: cookie.secure === true,
      httpOnly: cookie.httpOnly === true,
    };
    if (!cookie.name.startsWith('__Host-') && cookie.domain) {
      details.domain = cookie.domain;
    }
    const expires = cookie.expires ?? cookie.expirationDate ?? cookie.expiry;
    if (cookie.session !== true && typeof expires === 'number' && expires > 0) {
      details.expirationDate = expires > 1e12 ? Math.floor(expires / 1000) : expires;
    }
    const sameSite = String(cookie.sameSite || '').toLowerCase();
    if (sameSite === 'strict') details.sameSite = 'strict';
    else if (sameSite === 'lax') details.sameSite = 'lax';
    else if (sameSite === 'none' || sameSite === 'no_restriction') details.sameSite = 'no_restriction';
    else if (sameSite === 'unspecified' || sameSite === 'default') details.sameSite = 'unspecified';
    return details;
  },
  };
}

const sharedMethods = { createMethods };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = sharedMethods;
}
globalThis.JSEyesCookieWriteMethods = sharedMethods;
})();
