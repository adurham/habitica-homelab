import nconf from 'nconf';
import {
  disableCache,
} from '../../middlewares/cache';

const api = {};

/**
 * @api {get} /api/v3/status Get Habitica's API status
 * @apiName GetStatus
 * @apiGroup Status
 *
 * @apiSuccess {String} data.status 'up' if everything is ok
 *
 * @apiSuccessExample {JSON} Server is Up
 * {
 *   'status': 'up',
 * }
 */
api.getStatus = {
  method: 'GET',
  url: '/status',
  // explicitly disable caching so that the server is always checked
  middlewares: [disableCache],
  async handler (req, res) {
    res.respond(200, {
      status: 'up',
    });
  },
};

/**
 * @api {get} /api/v3/status/web-push Web Push public config
 * @apiName GetWebPushConfig
 * @apiGroup Status
 *
 * @apiSuccess {Boolean} data.enabled Whether the server has Web Push configured
 * @apiSuccess {String}  [data.publicKey] VAPID public key (urlsafe-base64)
 */
api.getWebPushConfig = {
  method: 'GET',
  url: '/status/web-push',
  middlewares: [disableCache],
  async handler (req, res) {
    const publicKey = nconf.get('WEB_PUSH_VAPID_PUBLIC_KEY');
    res.respond(200, {
      enabled: Boolean(publicKey),
      publicKey: publicKey || null,
    });
  },
};

export default api;
