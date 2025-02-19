'use strict';

const {
  Controller,
} = require('egg');
const url = require('url');
const cookie = require('cookie');

const ALLOWED_PROXY_HEADERS = [
  'set-cookie',
  'content-type',
];

class SceneController extends Controller {

  async index() {
    const ctx = this.ctx;
    const params = ctx.params;
    const projectName = params.projectName;
    const pathname = params.pathname;
    const method = ctx.method;

    const {
      uniqId: projectUniqId,
    } = await ctx.service.project.queryProjectByName({
      projectName,
    });

    const cookieKeyPair = cookie.parse(ctx.header.cookie || '');
    const tagName = cookieKeyPair && cookieKeyPair.DATAHUB_CACHE_TAG;

    const interfaceData = await ctx.service.interface.queryInterfaceByHTTPContext({
      projectUniqId,
      pathname,
      method,
      tagName,
    });

    if (!interfaceData) {
      this.fail(`${method} ${pathname} not found`);
      return;
    }

    const {
      proxyConfig,
    } = interfaceData;

    if (!tagName) {
      const {
        enabled: proxyEnabled,
        proxyList = [],
        activeIndex = 0,
      } = proxyConfig;

      ctx.logger.debug('proxy config %s', JSON.stringify(proxyConfig, null, 2));
      if (proxyEnabled && proxyList[activeIndex].proxyUrl) {
        ctx[Symbol.for('context#useProxy')] = true;
        const parsedUrl = url.parse(proxyList[activeIndex].proxyUrl);
        let proxyUrl = `${parsedUrl.protocol}//${parsedUrl.host}/${pathname}`;
        const parseOrigindUrl = url.parse(ctx.request.url);
        if (parseOrigindUrl.search) {
          proxyUrl += parseOrigindUrl.search;
        }
        const _res = await ctx.curl(proxyUrl, {
          method: ctx.method,
          headers: Object.assign({}, ctx.headers, {
            host: parsedUrl.host,
          }),
          followRedirect: true,
          timeout: 120 * 1000,
          data: ctx.request.body,
          dataType: 'text',
        });
        for (const key of ALLOWED_PROXY_HEADERS) {
          _res.headers[key] && ctx.set(key, _res.headers[key]);
        }
        ctx[Symbol.for('context#proxyResponseStatus')] = _res.status;
        ctx.status = _res.status;
        ctx.body = _res.data;
        return;
      }
    }

    const {
      currentScene,
      uniqId,
      originInterfaceId,
    } = interfaceData;

    const interfaceUniqId = (tagName && originInterfaceId) ? originInterfaceId : uniqId;

    let res;
    // try to use custom scene by default
    if (ctx.query.__datahub_scene) {
      res = await ctx.service.scene.querySceneByInterfaceUniqIdAndSceneName({
        interfaceUniqId,
        sceneName: ctx.query.__datahub_scene,
      });
    }
    if (!res) {
      res = await ctx.service.scene.querySceneByInterfaceUniqIdAndSceneName({
        interfaceUniqId,
        sceneName: currentScene,
      });
    }

    const {
      contextConfig,
      data,
    } = res;

    if (contextConfig.responseDelay) {
      ctx[Symbol.for('context#rewriteResponseDelay')] = Number.parseFloat(contextConfig.responseDelay);
    }
    if (contextConfig.responseStatus) {
      ctx[Symbol.for('context#rewriteResponseStatus')] = Number.parseInt(contextConfig.responseStatus, 10);
    }
    if (contextConfig.responseHeaders) {
      ctx[Symbol.for('context#rewriteResponseHeaders')] = contextConfig.responseHeaders;
    }

    ctx.body = data;
  }

  fail(message) {
    const ctx = this.ctx;
    ctx.set('x-datahub-fail', message);
    ctx.status = 400;
    ctx.body = {};
  }
}

module.exports = SceneController;
