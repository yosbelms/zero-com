# Zero-com

It is a zero-byte no-lib utility for transparently communicating client-side and server-side modules residing in the same full-stack project.

## Table of Contents

- [Usage](#usage)
- [Transport layer](#transport-layer)
- [Context](#context)
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
      patterns: {
        client: 'src/client/**',
        server: 'src/server/api/**',
      },
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
      patterns: {
        client: 'src/client/**',
        server: 'src/server/api/**',
      },
    }),
  ],
};
```

The above code will identify all the references from client-side code to the server-side files and will tranform the modules to comunicate through your defined transport layer. The only callable functions in the server-side modules will be the exported async functions. See the example below.

Server side
```js
// server/phones.ts
export async function getPhones() { }

// or
export const getPhones = async () => { }
```

Client side
```js
// client/phones.tsx
import { getPhones } '../server/phones'
```

## Transport layer

Zero-com does not define any transport layer, it is up to you to create one or reuse your own. This means you have complete control over how data is sent between the client and server.

### Communication Flow

The following diagram illustrates the communication flow between the client and server:

```
+--------+      +-----------------------------+      +-------------+
| Client |----->| window.ZERO_COM_CLIENT_SEND |----->| Your Server |
+--------+      +-----------------------------+      +-------------+
                                                           |
                                                           v
+--------+      +-------------------------+      +-------------------+
| Client |<-----| (Your custom transport) |<-----| someCustomHandler |
+--------+      +-------------------------+      +-------------------+
```

### Client-side

All messages from the client-side will be sent using the `window.ZERO_COM_CLIENT_SEND` function. You need to define this function in your client-side code.

```javascript
// client/transport.js
window.ZERO_COM_CLIENT_SEND = async ({ funcId, params }) => {
  const response = await fetch('http://localhost:8000/api', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ funcId, params }),
  });
  return await response.json();
};
```

### Server-side

On the server-side, you need to create a handler that receives messages from the client, executes the corresponding function, and returns the result. The `global.ZERO_COM_SERVER_REGISTRY` object contains all the server functions that can be called from the client.

```javascript
// server/api.js
import { execServerFn } from 'zero-com';

const someCustomHandler = async (message) => {
  const func = global.ZERO_COM_SERVER_REGISTRY[message.funcId];
  if (func) {
    return await execServerFn(func, message.params);
  } else {
    throw new Error(`Function with id ${message.funcId} not found.`);
  }
};

// Example of how to use the handler with an Express server
import express from 'express';

const app = express();
app.use(express.json());

app.post('/api', async (req, res) => {
  try {
    const result = await someCustomHandler(req.body);
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

Often you want to pass a context-related object to the server functions to have access to data like the request, response, session, etc. Zero-com provides a simple way to do this.

### Passing Context to Server Functions

To pass context to a server function, you need to wrap the function in `serverFn` and receive the context as the first parameter.

```javascript
// server/api/phones.js
import { serverFn } from 'zero-com';

export const getPhones = serverFn(async (ctx, name) => {
  // ctx is the context object passed from the server
  console.log(ctx.request.headers);
  // ... your code
});
```

### Providing Context on the Server

You can pass the context to `execServerFn` when you execute the server function.

```javascript
// server/api.js
import { execServerFn } from 'zero-com';

const myHandler = (request, response, message) => {
  const ctx = { request, response };
  const func = global.ZERO_COM_SERVER_REGISTRY[message.funcId];
  // pass context on exec
  return execServerFn(func, ctx, message.params);
};
```

## Plugin options

| Option      | Type      | Description                                                                 |
|-------------|-----------|-----------------------------------------------------------------------------|
| `development` | `boolean`   | If `false`, will add internal variable renaming to the final bundle.        |
| `patterns`    | `object`    |                                                                             |
| `patterns.client` | `string` | A glob pattern to identify client-side files.                               |
| `patterns.server` | `string` | A glob pattern to identify server-side files.                               |

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
    │   ├── index.js
    │   └── transport.js
    └── server
        └── api
            └── phones.js
```

### Client-side

```javascript
// src/client/index.js
import { getPhones } from '../../server/api/phones';

async function main() {
  const phones = await getPhones('iPhone');
  console.log(phones);
}

main();
```

```javascript
// src/client/transport.js
window.ZERO_COM_CLIENT_SEND = async ({ funcId, params }) => {
  const response = await fetch('http://localhost:8000/api', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ funcId, params }),
  });
  return await response.json();
};
```

### Server-side

```javascript
// src/server/api/phones.js
import { serverFn } from 'zero-com';

export const getPhones = serverFn(async (ctx, name) => {
  // In a real application, you would fetch this from a database
  const allPhones = [
    { name: 'iPhone 13', brand: 'Apple' },
    { name: 'Galaxy S22', brand: 'Samsung' },
  ];

  return allPhones.filter((phone) => phone.name.includes(name));
});
```

### Server

```javascript
// server.js
import express from 'express';
import { execServerFn } from 'zero-com';
import './src/server/api/phones.js'; // Make sure to import the server-side modules

const app = express();
app.use(express.json());

app.post('/api', async (req, res) => {
  const { funcId, params } = req.body;
  const func = global.ZERO_COM_SERVER_REGISTRY[funcId];

  if (func) {
    try {
      const result = await execServerFn(func, { req, res }, params);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  } else {
    res.status(404).json({ error: `Function with id ${funcId} not found.` });
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
    new ZeroComWebpackPlugin({
      patterns: {
        client: 'src/client/**',
        server: 'src/server/api/**',
      },
    }),
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
    zeroComRollupPlugin({
      patterns: {
        client: 'src/client/**',
        server: 'src/server/api/**',
      },
    }),
  ],
};
```
