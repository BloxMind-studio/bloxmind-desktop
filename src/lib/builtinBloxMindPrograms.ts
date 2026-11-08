import { Schema } from "effect";
import {
  type BloxMindProgramManifest,
  BloxMindProgramManifestSchema,
} from "@/lib/bloxmindProgramManifest";
import { type ExplorerProgramEnvelope, ExplorerProgramEnvelopeSchema } from "@/lib/explorer";
import {
  type StudioTargetProgramEnvelopes,
  StudioTargetProgramEnvelopesSchema,
} from "@/types/studioTarget";

import manifest from "../../bloxmind-programs/manifest.json";

// The BloxMind programs shipped with this app version, built from bloxmind-programs/
// (`pnpm bloxmind-programs build`). BloxMind prefers a newer published copy when
// one is available and falls back to these.
export const BUILTIN_BLOXMIND_PROGRAM_MANIFEST: BloxMindProgramManifest = Schema.decodeUnknownSync(
  BloxMindProgramManifestSchema,
)(manifest);

export const BUILTIN_EXPLORER_PROGRAM: ExplorerProgramEnvelope = Schema.decodeUnknownSync(
  ExplorerProgramEnvelopeSchema,
)(BUILTIN_BLOXMIND_PROGRAM_MANIFEST.programs["explorer-snapshot"]);

export const BUILTIN_STUDIO_TARGET_PROGRAMS: StudioTargetProgramEnvelopes =
  Schema.decodeUnknownSync(StudioTargetProgramEnvelopesSchema)({
    discovery: BUILTIN_BLOXMIND_PROGRAM_MANIFEST.programs["studio-target-discovery"],
    selection: BUILTIN_BLOXMIND_PROGRAM_MANIFEST.programs["studio-target-selection"],
  });
