import { authWithHeaders } from '../../middlewares/auth';
import {
  BadRequest,
  NotFound,
} from '../../libs/errors';
import { model as PushDevice } from '../../models/pushDevice';
import { model as WebPushSubscription } from '../../models/webPushSubscription';

const api = {};

/**
 * @apiIgnore
 * @api {post} /api/v3/user/push-devices Add a push device to a user
 * @apiName UserAddPushDevice
 * @apiGroup User
 *
 * @apiParam (Body) {String} regId The id of the push device
 * @apiParam (Body) {String} type The type of push device
 *
 * @apiSuccess {Object} data List of push devices
 * @apiSuccess {String} message Success message
 */
api.addPushDevice = {
  method: 'POST',
  url: '/user/push-devices',
  middlewares: [authWithHeaders()],
  async handler (req, res) {
    const { user } = res.locals;

    req.checkBody('regId', res.t('regIdRequired')).notEmpty();
    req.checkBody('type', res.t('typeRequired')).notEmpty().isIn(['ios', 'android']);

    const validationErrors = req.validationErrors();
    if (validationErrors) throw validationErrors;

    const { pushDevices } = user;

    const item = {
      regId: req.body.regId,
      type: req.body.type,
    };

    // When adding a duplicate push device, fail silently instead of throwing an error
    if (pushDevices.find(device => device.regId === item.regId)) {
      res.respond(200, user.pushDevices, res.t('pushDeviceAdded'));
      return;
    }

    // Concurrency safe update
    const pushDevice = (new PushDevice(item)).toJSON(); // Create a mongo doc
    await user.updateOne({
      $push: { pushDevices: pushDevice },
    }).exec();

    // Update the response
    user.pushDevices.push(pushDevice);

    res.respond(200, user.pushDevices, res.t('pushDeviceAdded'));
  },
};

/**
 * @apiIgnore
 * @api {delete} /api/v3/user/push-devices/:regId remove a push device from a user
 * @apiName UserRemovePushDevice
 * @apiGroup User
 *
 * @apiParam (Path) {String} regId The id of the push device
 *
 * @apiSuccess {Object} data List of push devices
 * @apiSuccess {String} message Success message
 */
api.removePushDevice = {
  method: 'DELETE',
  url: '/user/push-devices/:regId',
  middlewares: [authWithHeaders()],
  async handler (req, res) {
    const { user } = res.locals;

    req.checkParams('regId', res.t('regIdRequired')).notEmpty();

    const validationErrors = req.validationErrors();
    if (validationErrors) throw validationErrors;

    const { regId } = req.params;

    const { pushDevices } = user;

    const indexOfPushDevice = pushDevices.findIndex(element => element.regId === regId);

    if (indexOfPushDevice === -1) {
      throw new NotFound(res.t('pushDeviceNotFound'));
    }

    // Concurrency safe update
    const pullQuery = { $pull: { pushDevices: { regId } } };
    await user.updateOne(pullQuery).exec();

    // Update the response
    pushDevices.splice(indexOfPushDevice, 1);

    res.respond(200, user.pushDevices, res.t('pushDeviceRemoved'));
  },
};

/**
 * @apiIgnore
 * @api {post} /api/v3/user/web-push/subscribe Register a Web Push subscription
 * @apiName UserAddWebPushSubscription
 * @apiGroup User
 *
 * @apiParam (Body) {String} endpoint The subscription endpoint URL
 * @apiParam (Body) {Object} keys Subscription keys
 * @apiParam (Body) {String} keys.p256dh ECDH P-256 public key
 * @apiParam (Body) {String} keys.auth Auth secret
 * @apiParam (Body) {String} [label] Human-readable device label
 *
 * @apiSuccess {Object} data List of subscriptions
 */
api.addWebPushSubscription = {
  method: 'POST',
  url: '/user/web-push/subscribe',
  middlewares: [authWithHeaders()],
  async handler (req, res) {
    const { user } = res.locals;

    if (!req.body || !req.body.endpoint) {
      throw new BadRequest('endpoint is required');
    }
    if (!req.body.keys || !req.body.keys.p256dh || !req.body.keys.auth) {
      throw new BadRequest('keys.p256dh and keys.auth are required');
    }

    const subs = user.webPushSubscriptions || [];
    const item = {
      endpoint: req.body.endpoint,
      keys: { p256dh: req.body.keys.p256dh, auth: req.body.keys.auth },
      label: req.body.label || '',
    };

    // De-dupe by endpoint. If present, just update the keys/label in place —
    // a browser can rotate keys while keeping the endpoint stable.
    const existing = subs.find(s => s.endpoint === item.endpoint);
    if (existing) {
      await user.updateOne({
        $set: {
          'webPushSubscriptions.$[el].keys': item.keys,
          'webPushSubscriptions.$[el].label': item.label,
        },
      }, { arrayFilters: [{ 'el.endpoint': item.endpoint }] }).exec();
      existing.keys = item.keys;
      existing.label = item.label;
      res.respond(200, user.webPushSubscriptions);
      return;
    }

    const sub = (new WebPushSubscription(item)).toJSON();
    await user.updateOne({ $push: { webPushSubscriptions: sub } }).exec();
    user.webPushSubscriptions.push(sub);

    res.respond(200, user.webPushSubscriptions);
  },
};

/**
 * @apiIgnore
 * @api {post} /api/v3/user/web-push/unsubscribe Remove a Web Push subscription
 * @apiName UserRemoveWebPushSubscription
 * @apiGroup User
 *
 * @apiParam (Body) {String} endpoint The subscription endpoint to remove
 *
 * @apiSuccess {Object} data List of remaining subscriptions
 */
api.removeWebPushSubscription = {
  method: 'POST',
  url: '/user/web-push/unsubscribe',
  middlewares: [authWithHeaders()],
  async handler (req, res) {
    const { user } = res.locals;

    const endpoint = req.body && req.body.endpoint;
    if (!endpoint) throw new BadRequest('endpoint is required');

    const subs = user.webPushSubscriptions || [];
    const idx = subs.findIndex(s => s.endpoint === endpoint);
    if (idx === -1) throw new NotFound('Subscription not found');

    await user.updateOne({ $pull: { webPushSubscriptions: { endpoint } } }).exec();
    subs.splice(idx, 1);

    res.respond(200, user.webPushSubscriptions);
  },
};

export default api;
