export const REDIS_CLIENT = "REDIS_CLIENT";
/** Separate connection dedicated to pub/sub — ioredis requires a distinct
 *  client for SUBSCRIBE mode since a subscribed connection can't run
 *  normal commands. */
export const REDIS_SUB_CLIENT = "REDIS_SUB_CLIENT";
