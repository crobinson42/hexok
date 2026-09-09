import { createApp } from './create-app.js';

/**
 * Event handlers do not run until `start()`. Publish still records the
 * envelope; `start()` subscribes NotifyOnClose so the demo actually notifies.
 */
const { app, notifier } = createApp();
await app.start();
const closed = await app.local.incident.close({ id: '1' });
console.log('closed', closed);
console.log('notified', notifier.sent);
await app.stop();
