/**
 * @bloxmind-studio/types — Shared TypeScript type definitions for BloxMind.
 *
 * This package re-exports the canonical type definitions maintained in the core
 * desktop application so that the public UI package (and any future consumer)
 * can import them under the `@bloxmind-studio/types` scope without a direct
 * filesystem dependency on the Electron source tree.
 */

export * from "./checkpoints";
export * from "./generatedProgram";
export * from "./studioTarget";
export * from "./chat";

