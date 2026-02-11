# Zero-com

The 0 bytes utility for transparently communicating client and server in full-stack projects through compile-time code transformation, with end-to-end static type checking.

## Table of Contents

- [Usage](#usage)
- [Transport layer](#transport-layer)
- [Context](#context)
- [Server-to-Server Calls](#server-to-server-calls)
- [Plugin options](#plugin-options)
- [Complete Example](#complete-example)

## Usage

Zero-com can be used with either Webpack or Rollup.

### Webpack

To use Zero-com with Webpack, you need to add the `ZeroComWebpackPlugin` to your `webpack.config.js` file.

```javascript
// webpack.config.js
const { ZeroComWebpackPlugin } = require('zero-com/webpack');

module.exports = {
  // ... your webpack config
  plugins: [
    new ZeroComWebpackPlugin({
      development: true,
    }),
  ],
};
```

### Rollup

To use Zero-com with Rollup, you need to add the `zeroComRollupPlugin` to your `rollup.config.js` file.

```javascript
// rollup.config.js
import zeroComRollupPlugin from 'zero-com/rollup';

export default {
  // ... your rollup config
  plugins: [
    zeroComRollupPlugin({
      development: true,
    }),
  ],
};
```

The above code will identify all the references from client-side code to the server-side files and will tranform the modules to comunicate through your defined transport layer. The only callable functions in the server-side modules will be the exported async functions. See the example below.

Server side
```ts
// server/phones.ts
import { func } from 'zero-com';

export const getPhones = func(async () => {
  // ...
})
```

Client side
```tsx
// client/phones.tsx
import { getPhones } '../server/phones'
```

## Transport layer

Zero-com does not define any transport layer, it is up to you to create one or reuse your own. This means you have complete control over how data is sent between the client and server.

### Client-side

All messages from the client-side will be sent using the transport function you define. Import `call` from `zero-com` and pass your transport function.

```javascript
// client/transport.js
import { call } from 'zero-com';

call(async (funcId, params) => {
  const response = await fetch('http://localhost:8000/api', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ funcId, params }),
  });
  return await response.json();
});
```

### Server-side

On the server-side, you need to create a handler that receives messages from the client, executes the corresponding function, and returns the result. Import `handle` from `zero-com` and call it with the function ID, context, and arguments.

```javascript
// server/api.js
import { handle } from 'zero-com';

const someCustomHandler = async (message, ctx) => {
  return await handle(message.funcId, ctx, message.params);
};

// Example of how to use the handler with an Express server
import express from 'express';

const app = express();
app.use(express.json());

app.post('/api', async (req, res) => {
  try {
    const ctx = { req, res };
    const result = await someCustomHandler(req.body, ctx);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(8000, () => {
  console.log('Server running at http://localhost:8000/');
});
```

## Context

Often you want to access context-related data in your server functions, such as the request, response, session, etc. Zero-com provides a simple way to do this using the `context()` function.

### Accessing Context in Server Functions

To access context in a server function, call the `context<T>()` function inside your function body. The context is automatically available when the function is called via `handle()`.

```typescript
// server/api/phones.ts
import { func, context } from 'zero-com';

type MyContext = {
  req: any;
  res: any;
  userId: string;
}

export const getPhones = func(async (name: string) => {
  // Get the context inside the function
  const ctx = context<MyContext>();

  console.log('User:', ctx.userId);
  console.log('Headers:', ctx.req.headers);

  // ... your code
});
```

### Providing Context on the Server

Pass the context as the second argument to `handle()`. The context will be available to the function and any nested server function calls.

```javascript
// server/api.js
import { handle } from 'zero-com';

app.post('/api', async (req, res) => {
  const { funcId, params } = req.body;

  // Create context with request data
  const ctx = {
    req,
    res,
    userId: req.headers['x-user-id']
  };

  // Pass context to handle - it will be available via context()
  const result = await handle(funcId, ctx, params);
  res.json(result);
});
```

## Server-to-Server Calls

When one server function calls another server function, the call bypasses the transport layer and executes directly. Context is automatically propagated to nested calls.

```typescript
// server/api/user.ts
import { func, context } from 'zero-com';

export const getFirstName = func(async () => {
  const ctx = context<{ userId: string }>();
  // ... fetch first name from database
  return 'John';
});

// server/api/profile.ts
import { func, context } from 'zero-com';
import { getFirstName } from './user';

export const getFullName = func(async (lastName: string) => {
  // This calls getFirstName directly (no transport layer)
  // Context is automatically propagated
  const firstName = await getFirstName();
  return `${firstName} ${lastName}`;
});
```

When `getFullName` is called from the client:
1. The call goes through the transport layer to the server
2. `handle()` sets up the context
3. `getFullName` executes and calls `getFirstName`
4. `getFirstName` executes directly (no transport) with the same context
5. Both functions can access `context()` with the same data

## Plugin options

| Option      | Type      | Description                                                                 |
|-------------|-----------|-----------------------------------------------------------------------------|
| `development` | `boolean`   | If `false`, will add internal variable renaming to the final bundle.        |
| `target`    | `'client' \| 'server'` | When `'client'`, server function files are replaced with lightweight RPC stubs containing no server dependencies. When `'server'`, full function bodies and registry code are preserved. When omitted, the Vite/Rollup plugin infers it from the `ssr` flag in the `transform` hook. |

## Complete Example

Here's a complete example of how to use Zero-com in a project.

### Project Structure

```
.
├── package.json
├── webpack.config.js
├── rollup.config.js
└── src
    ├── client
    │   ├── index.ts
    │   └── transport.ts
    └── server
        └── api
            └── phones.ts
```

### Client-side

```typescript
// src/client/index.ts
import { getPhones } from '../../server/api/phones';

async function main() {
  const phones = await getPhones('iPhone');
  console.log(phones);
}

main();
```

```typescript
// src/client/transport.ts
import { call } from 'zero-com';

call(async (funcId, params) => {
  const response = await fetch('http://localhost:8000/api', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ funcId, params }),
  });
  return await response.json();
});
```

### Server-side

```typescript
// src/server/api/phones.ts
import { func, context } from 'zero-com';

type Context = {
  req: any;
  res: any;
}

export const getPhones = func(async (name: string) => {
  // Access context when needed
  const ctx = context<Context>();
  console.log('Request from:', ctx.req.ip);

  // In a real application, you would fetch this from a database
  const allPhones = [
    { name: 'iPhone 13', brand: 'Apple' },
    { name: 'Galaxy S22', brand: 'Samsung' },
  ];

  return allPhones.filter((phone) => phone.name.includes(name));
});
```

### Server

```typescript
// server.ts
import express from 'express';
import { handle } from 'zero-com';
import './src/server/api/phones.js'; // Make sure to import the server-side modules

const app = express();
app.use(express.json());

app.post('/api', async (req, res) => {
  const { funcId, params } = req.body;
  try {
    const result = await handle(funcId, { req, res }, params);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(8000, () => {
  console.log('Server running at http://localhost:8000/');
});
```

### Webpack Configuration

```javascript
// webpack.config.js
const { ZeroComWebpackPlugin } = require('zero-com/webpack');

module.exports = {
  mode: 'development',
  entry: './src/client/index.js',
  output: {
    filename: 'main.js',
    path: __dirname + '/dist',
  },
  plugins: [
    new ZeroComWebpackPlugin(),
  ],
};
```

### Rollup Configuration

```javascript
// rollup.config.js
import zeroComRollupPlugin from 'zero-com/rollup';

export default {
  input: 'src/client/index.js',
  output: {
    file: 'dist/main.js',
    format: 'cjs',
  },
  plugins: [
    zeroComRollupPlugin(),
  ],
};
```
