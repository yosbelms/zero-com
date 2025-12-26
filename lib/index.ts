
declare global {
  var ZERO_COM_SERVER_REGISTRY: { [funcId: string]: (...args: any[]) => any }
  var ZERO_COM_CLIENT_SEND: (...args: any[]) => Promise<any>
}

export const serverFn = <Ctx, Rest extends any[], R>(sfn: (ctx: Ctx, ...rest: Rest) => R) => {
  const clonedSfn = (...rest: Rest): R => sfn(null as Ctx, ...rest)
  clonedSfn.serverFn = sfn
  return clonedSfn
}

export const execServerFn = (sfn: ReturnType<typeof serverFn>, ctx: any, args: any[]): ReturnType<typeof sfn> => {
  if (sfn.serverFn) {
    return sfn.serverFn.call(null, ctx, ...args)
  } else {
    return sfn.call(null, ...args)
  }
}
