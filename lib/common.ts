export type Options = {
  development?: boolean,
  patterns: {
    client: string,
    server: string,
  }
}

export const ZERO_COM_CLIENT_SEND = 'ZERO_COM_CLIENT_SEND'
export const ZERO_COM_SERVER_REGISTRY = 'ZERO_COM_SERVER_REGISTRY'

export const formatMethodName = (funcName: string, path: string, line: number): string => {
  return `${funcName}@${path}:${line}`
}
