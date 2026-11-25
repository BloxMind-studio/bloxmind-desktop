import {
  BUILTIN_BLOXMIND_PROGRAM_MANIFEST,
  BUILTIN_EXPLORER_PROGRAM,
  BUILTIN_STUDIO_TARGET_PROGRAMS,
} from "@/lib/builtinBloxMindPrograms";
import type { ExplorerProgramEnvelope } from "@/lib/explorer";
import type { StudioTargetProgramEnvelopes } from "@/types/studioTarget";

/** Where a program came from, recorded in analytics so broken ones are traceable. */
export interface BloxMindProgramOrigin {
  source: "builtin";
  sequence: number;
}

export interface ResolvedBloxMindPrograms {
  explorer: BloxMindProgramOrigin & { program: ExplorerProgramEnvelope };
  targets: BloxMindProgramOrigin & { programs: StudioTargetProgramEnvelopes };
}

const BUILTIN_ORIGIN: BloxMindProgramOrigin = {
  source: "builtin",
  sequence: BUILTIN_BLOXMIND_PROGRAM_MANIFEST.sequence,
};

export const BUILTIN_BLOXMIND_PROGRAMS: ResolvedBloxMindPrograms = {
  explorer: { ...BUILTIN_ORIGIN, program: BUILTIN_EXPLORER_PROGRAM },
  targets: { ...BUILTIN_ORIGIN, programs: BUILTIN_STUDIO_TARGET_PROGRAMS },
};

/**
 * Programs ship with the app. A change on Roblox's side needs an app update,
 * but looking at a place never spends a message asking a model to write code.
 */
export async function resolveBloxMindPrograms(): Promise<ResolvedBloxMindPrograms> {
  return BUILTIN_BLOXMIND_PROGRAMS;
}
