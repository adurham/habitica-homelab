import mongoose from 'mongoose';
import _ from 'lodash';
import baseModel from '../libs/baseModel';

const { Schema } = mongoose;

// A standard Web Push PushSubscription: an endpoint URL (push service-specific)
// and the client keys used to encrypt the payload.
export const schema = new Schema({
  endpoint: { $type: String, required: true },
  keys: {
    p256dh: { $type: String, required: true },
    auth: { $type: String, required: true },
  },
  // Optional free-form label the client can set (e.g. "iPhone 15 - Safari") so
  // users can identify which subscription to revoke from the UI later.
  label: { $type: String, default: '' },
}, {
  strict: true,
  minimize: false,
  _id: false,
  typeKey: '$type',
});

schema.plugin(baseModel, {
  noSet: ['_id', 'endpoint'],
  timestamps: true,
  _id: false,
});

// Match pushDevice.cleanupCorruptData semantics so bad state doesn't break
// the sendNotification loop downstream.
schema.statics.cleanupCorruptData = function cleanup (subs) {
  if (!subs) return subs;
  const filtered = subs.filter(s => s && s.endpoint && s.keys && s.keys.p256dh && s.keys.auth);
  return _.uniqWith(filtered, (a, b) => a.endpoint === b.endpoint);
};

export const model = mongoose.model('WebPushSubscription', schema);
