import { onRequest as __dict___path___ts_onRequest } from "/Users/leehk/dev/enparse/functions/dict/[[path]].ts"
import { onRequest as __models___path___ts_onRequest } from "/Users/leehk/dev/enparse/functions/models/[[path]].ts"

export const routes = [
    {
      routePath: "/dict/:path*",
      mountPath: "/dict",
      method: "",
      middlewares: [],
      modules: [__dict___path___ts_onRequest],
    },
  {
      routePath: "/models/:path*",
      mountPath: "/models",
      method: "",
      middlewares: [],
      modules: [__models___path___ts_onRequest],
    },
  ]