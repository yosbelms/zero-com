# Zero-com

The 0 bytes utility for transparently communicating client and server in full-stack projects through compile-time code transformation, with end-to-end static type checking.

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

const someCustomHandler = async (message) => {
  return await handle(message.funcId, null, message.params);
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

To pass context to a server function, you need to wrap the function in `func` and type the first parameter as `context`. The plugin detects this type and handles it accordingly.

```typescript
// server/api/phones.ts
import { func, context } from 'zero-com';

type MyContext = {
  request: any
}

export const getPhones = func(async (ctx: context<MyContext>, name: string) => {
  // ctx is the context object passed from the server
  console.log(ctx.request.headers);
  // ... your code
});
```

### Providing Context on the Server

You can pass the context to `handle` when you execute the server function.

```javascript
// server/api.js
import { handle } from 'zero-com';

const myHandler = (request, response, message) => {
  const ctx = { request, response };
  // pass context on exec
  return handle(message.funcId, ctx, message.params);
};
```

## Plugin options

| Option      | Type      | Description                                                                 |
|-------------|-----------|-----------------------------------------------------------------------------|
| `development` | `boolean`   | If `false`, will add internal variable renaming to the final bundle.        |

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
  req: any,
  res: any
}

export const getPhones = func(async (ctx: context<Context>, name: string) => {
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
