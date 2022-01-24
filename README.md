# red-store

This module provides Redis session storage for Express for the [`node-redis`][node-redis] v4 client.

[![npm](https://img.shields.io/npm/v/red-store?logo=npm)](https://www.npmjs.com/package/red-store)


### Features:

- Promise-based methods for direct interaction with the sessions store
- Safeguards for handling race conditions caused by concurrent requests
- Batched multi-key operations (`all`, `length`, `clear`) for efficient performance
- Atomic `set` operations

### Compatibility:

- Redis server: 2.6.0+
- Redis client: [`node-redis`][node-redis] 4.0.2+
- Express session: 1.7.0+

___

## Installation
```shell
npm install red-store
```
```shell
yarn add red-store
```

## Usage

### Quick Start
```js
const redis = require('redis');
const { RedisStore } = require('red-store')

const store = new RedisStore({
    client: redis.createClient()
});
```

### Express Session

```js
app.use(
    session({
        store,
        saveUninitialized: false, // recommended
        resave: false, // recommended
        // ...
    })
)
```

Disabling `saveUninitialized` helps reduce traffic and memory usage for your Redis store.

Disabling `resave` helps prevent concurrent requests from overwriting sessions.

### Direct Access

The `access` field exposes commands for interacting with the store using Promises.

```js
// Get a session from the store
const session = await store.access.get(sessionId);

// Create or update a session
await store.access.set(sessionId, sessionData)

// Delete a session
await store.access.destroy(sessionId);

// Clear all session keys from the store
await store.access.clear();
```

## Options

### client

This module exclusively supports the [`node-redis`][node-redis] v4 client.

### prefix

**string** | default: `'sessions:'`

A prefix used for each key in the session store.

### scanCount

**number** | default: `100`

The maximum number of keys batched in Redis `SCAN` calls.  This also helps limit the memory load on subsequent calls 
using the key batches (e.g. `MGET`, `DEL`).

### ttl

**number** | default: `86400` (1 day)

This field is only used when a session cookie is missing the `expires` field.

It represents the fallback duration in seconds after which a created or updated session should be expired when the 
cookie `expires` date is missing.


### disableTouch

**boolean** | default: `false`

Disables renewing the session's time to live when the `touch` method is used.

Setting this option to `true` is not recommended; this toggle should be mutually exclusive with the `session.resave` 
option, which should be set to false.

### concurrencyMerge

**boolean** | default: `false`

Determines whether session race conditions should be resolved by deep merging changes; by default, race conditions are
handled by overriding with the latest session data saved.

## License
[MIT License](https://github.com/rahil-p/passport-discord-token/blob/master/LICENSE)

[node-redis]: https://github.com/redis/node-redis
