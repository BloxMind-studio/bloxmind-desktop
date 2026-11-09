// Type bridge for the OC1→OC2 migration.
// Runtime goes through the OC2-backed adapter; type shapes that are still
// consumed in OC1 form are re-exported from the legacy SDK until Step 4
// (SSE/event/message model reconciliation) remaps them.
// Additional OC1 types used by BloxMind config/hidden-session/internals.
export type {
  Agent,
  AssistantMessage,
  Command,
  Config,
  Event,
  GlobalEvent,
  McpLocalConfig,
  McpRemoteConfig,
  McpStatus,
  Message,
  Model,
  Part,
  PermissionRequest,
  PermissionRuleset,
  Provider,
  ProviderAuthAuthorization,
  ProviderAuthError,
  ProviderAuthMethod,
  ProviderAuthResponse,
  ProviderListResponse,
  ProviderOauthAuthorizeResponse,
  QuestionAnswer,
  QuestionRequest,
  Session,
  SessionStatus,
  SnapshotFileDiff,
  TextPart,
  Todo,
  ToolPart,
  UserMessage,
} from "@opencode-ai/sdk/v2/client";

// OC2-native types that are shape-compatible and useful at the boundary.
export type { OpencodeClientConfig } from "./client";
