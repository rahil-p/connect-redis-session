# connect-redis-session

Redis session storage for Express supporting the latest [`node-redis`][node-redis] client.

[![npm](https://img.shields.io/npm/v/connect-redis-session?logo=npm)](https://www.npmjs.com/package/connect-redis-session)
[![codecov](https://codecov.io/gh/rahil-p/connect-redis-session/branch/main/graph/badge.svg?token=P0nIvyEnTS)](https://codecov.io/gh/rahil-p/connect-redis-session)
[![github-workflow](https://img.shields.io/github/workflow/status/rahil-p/connect-redis-session/npm%20publish?logo=github)](https://github.com/rahil-p/connect-redis-session/actions)

___

### Features:

- Promise-based methods for direct interaction with the sessions store
- Atomic single-key operations (`get`, `set`, `touch`, `destroy`)
- Batched multi-key operations (`all`, `length`, `clear`) for efficient performance
- Safeguards for handling race conditions caused by concurrent requests
- First class support for [Typescript](https://www.typescriptlang.org/)


### Compatibility:

- Redis server 2.6.0+
- [`node-redis`][node-redis] 4.0.0+
- [`express-session`][express-session] 1.17.0+

___

## Installation
```shell
npm install connect-redis-session # redis@^4 express-session@^1.17
```

```shell
yarn add connect-redis-session # redis@^4 express-session@^1.17 
```



## Usage

### Quick Start
```js
const session = require('express-session');
const redis = require('redis');
const { RedisStore } = require('connect-redis-session');

// Create the Redis client
const client = redis.createClient();

// Configure the Redis store
const store = new RedisStore({ client });

// Configure the Express session middleware
app.use(
    session({
        store,
        secret: 'swordfish',
        saveUninitialized: false, // recommended
        resave: false, // recommended
        // ...
    }),
);
```

### Access with Promises

The `RedisStore.access` field exposes methods for directly interacting with the store using Promises.

```js
const updateSession = async (sid) => {
    // Get a session from the store
    const session = await store.access.get(sid);

    // Create or update a session
    await store.access.set(sid, { ...session, foo: 'bar' })

    // Delete a session
    await store.access.destroy(sid);

    // Get all sessions
    const sessions = await session.access.all();

    // Count all sessions
    const n = await session.access.length();

    // Clear all session keys from the store
    await store.access.clear();
}
```

## Options

```js
const store = new RedisStore({
    client,
    prefix: 'sessions:',
    scanCount: 100,
    ttlSeconds: 86400,
    concurrencyGraceSeconds: 300,
    disableTouch: false,
})
```

___

### `client`

object | **required**

An initialized [`node-redis`][node-redis] v4 client.

Prior to server listening, the client's `connect` method should be called.

<details>

<summary>example</summary>

```js
(async () => {
    await client.connect();
    server.listen(80);
})();
```

</details>

___

### `prefix`

string • `'sessions:'`

A prefix used for each key in the session store.

___

### `scanCount`

number • `100`

The maximum number of keys batched in Redis `SCAN` calls.  This also helps limit the memory load on subsequent calls
using the key batches (e.g. `MGET`, `DEL`).

___

### `ttlSeconds`

number | `false` • `86400` _1 day_

The fallback duration in
seconds after which a created or updated session should be expired.

This field is only used when a session is missing the
[`cookie.expires`](https://github.com/expressjs/session#cookieexpires) field.

When set to `0` or `false`, the store will reject sessions missing the
[`cookie.expires`](https://github.com/expressjs/session#cookieexpires) field.

___

### `concurrencyGraceSeconds`

number • `300`

The duration in seconds after [tombstone](https://en.wikipedia.org/wiki/Tombstone_(data_store)) records are removed from
the store.

Tombstone records are used to prevent a destroyed session from being updated or touched. This lock is retained for the 
duration specified by this setting.

___

### `disableTouch`

boolean • `false`

Disables renewing the session's time to live when the session's [`touch`](https://github.com/expressjs/session#sessiontouch)
method is used.

Setting this option to `true` is not recommended and should share the same value as the session's
[`resave`](https://github.com/expressjs/session#saveuninitialized)
option.

___

### `serializer`

object

A custom serializer implementing the following encoding and decoding methods for storing session data as Redis string
values:

- `stringify`: `(value: SessionData) => string`
- `parse`: `(text: string) => SessionData`

Refer to the global [`JSON`][mdn-json] object for an example.

___

## License
[MIT License](https://github.com/rahil-p/connect-redis-session/blob/master/LICENSE)

[node-redis]: https://github.com/redis/node-redis
[express-session]: https://github.com/expressjs/session
[mdn-json]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON
