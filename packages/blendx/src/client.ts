/**
 * blendx/client: the typed Hono RPC client for an app's AppType. Going through blendx keeps a
 * client on the hono that built AppType, so the two can't drift apart.
 */
export {
  type ClientResponse,
  hc,
  type InferRequestType,
  type InferResponseType,
} from 'hono/client';
