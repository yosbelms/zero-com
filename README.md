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
// callable
export async function getPhones() { }

// not callable from client-side
export const getPhones = async () => { }
```

Client side
```js
// client/phones.tsx
import { getPhones } '../server/phones'
```

## Trasport layer
Zero-com does not define any transport layer, it allows you to define a new one or reuse your own.

- `window.ZERO_COM_CLIENT_SEND` all mesages from client-side will be sent using this function.
- `global.ZERO_COM_SERVER_REGISTRY` object available on the server-side of which the keys are the name of the methods and the values ​​are the functions to be executed.

Client side example.
```js
window.ZERO_COM_CLIENT_SEND = async ({ method, params }) {
  // -> send the message to server
  // <- return response
}
```

Server side example.
```js
const someCustomHandler = (message) => {
  const func = global.ZERO_COM_SERVER_REGISTRY[message.method]
  return func(...message.params)
}
```

## Plugin options
- development: if `false` will add internal variable renaming to the final bundle.
- patterns
  - client: pattern to identify client-side files
  - server: pattern to identify server-side files
