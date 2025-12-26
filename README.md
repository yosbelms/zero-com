# Zero-com

It is a zero-byte no-lib utility for transparently communicating client-side and server-side modules residing in the same full-stack project.

## Usage

Webpack config.
```js
new ZeroComWebpackPlugin({
  development: true,
  patterns: {
    client: 'src/client/**',
    server: 'src/server/api/**',
  }
})
```

Rollup config.
```js
zeroComRollupPlugin({
  development: true,
  patterns: {
    client: 'src/client/**',
    server: 'src/server/api/**',
  }
})
```

The above code will identify all the references from client-side code to the server-side files and will tranform the modules to comunicate through your defined transport layer. The only callable functions in the server-side modules will be the exported async functions (not arrow functions). See the example below.

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

## Trasport layer
Zero-com does not define any transport layer, it is up to you to create one or reuse your own.

- `window.ZERO_COM_CLIENT_SEND` all mesages from client-side will be sent using this function.
- `global.ZERO_COM_SERVER_REGISTRY` object available on the server-side whose the keys are the server functions ids and the values ​​are the functions.

Client side.
```js
window.ZERO_COM_CLIENT_SEND = async ({ funcId, params }) {
  // -> send the message to server
  // <- return response
}
```

Server side.
```js
const someCustomHandler = (message) => {
  const func = global.ZERO_COM_SERVER_REGISTRY[message.funcId]
  return execServerFn(func, message.params)
}
```

Example:
```js
// client
window.ZERO_COM_CLIENT_SEND = async (message) {
  const response = await fetch('http://localhost:8000', {
    method: 'POST',
    body: JSON.stringify(message)
  })
  return await response.json()
}
```

```js
// server
import http from 'node:http'

const server = http.createServer(async (req, res) => {
  if (req.funcId === 'POST') {
    const buffers = []
    for await (const chunk of req) buffers.push(chunk)
    const data = Buffer.concat(buffers).toString()
    const message = JSON.parse(data)
    const func = global.ZERO_COM_SERVER_REGISTRY[message.funcId]
    const result = await execServerFn(func, message.params)
    res.statusCode = 200
    res.end(JSON.stringify(result))
  } else {
    res.statusCode = 400
    res.end('')
  }
})

server.listen(8000, () => {
  console.log('Server running at http://localhost:8000/')
})
```

Context

Often you want to pass a context related object to the server functions to have access to data like request, response, session, etc.

Wrap the server function in `serverFunc` and receive the context as the first param
```js
export const getPhones = serverFunc(async (ctx, name) => { })
```

Pass context to `execServerFn`
```js
const myHandler = (request, response, message) => {
  const ctx = { request, response}
  const func = global.ZERO_COM_SERVER_REGISTRY[message.funcId]
  // pass context on exec
  return execServerFn(func, ctx, message.params)
}
```


## Plugin options
- development: if `false` will add internal variable renaming to the final bundle.
- patterns
  - client: pattern to identify client-side files
  - server: pattern to identify server-side files
