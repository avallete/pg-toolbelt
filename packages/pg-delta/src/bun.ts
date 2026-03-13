/**
 * Bun keeps the same public contract as the Node convenience layer. The
 * implementation stays thin on purpose so the shared Effect programs remain the
 * single source of behavior.
 */
export * from "./node.ts";
