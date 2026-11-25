import posthog from "posthog-js/dist/module.full.no-external.js";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  analyticsProperties,
  detailedAnalyticsProperties,
  errorAnalyticsProperties,
  setStudioAnalyticsContext,
} from "@/lib/analytics";
import { BUILTIN_BLOXMIND_PROGRAMS, resolveBloxMindPrograms } from "@/lib/bloxmindPrograms";
import { desktop } from "@/lib/desktop";
import { splitModelKey } from "@/lib/splitModelKey";
import { generateStudioTargetPrograms } from "@/lib/studioTargetPrograms";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { usePreferences } from "@/providers/PreferencesProvider";
import type {
  StudioTarget,
  StudioTargetPrograms,
  StudioTargetSelection,
} from "@/types/studioTarget";

export type StudioTargetStatus = "loading" | "ready" | "empty" | "error";

/** Studio's window label ends with a place ID nobody needs to read. */
export function placeName(label: string): string {
  return label.replace(/\s*\(placeId:[^)]*\)$/, "");
}

/**
 * Whether a Studio could be the place a chat remembers by name. Different Place IDs rule that out,
 * and so does only one of them being published: those can't be the same place.
 */
function sameNamedPlace(target: StudioTarget, remembered: StudioTarget): boolean {
  const placeId = (id: string | null | undefined) => (id && id !== "0" ? id : null);
  return (
    target.label.trim().toLowerCase() === remembered.label.trim().toLowerCase() &&
    placeId(target.placeId) === placeId(remembered.placeId)
  );
}

interface StudioTargetContextValue {
  targets: readonly StudioTarget[];
  selected: StudioTarget | null;
  promptReference: string | null;
  status: StudioTargetStatus;
  /** The latest check failed, so a place's being closed is no longer known. */
  discoveryFailed: boolean;
  refreshing: boolean;
  selectingKey: string | null;
  error: string | null;
  /** The place this chat was working in when it isn't open any more. */
  missing: StudioTarget | null;
  /** Someone chose to use this chat for work that has nothing to do with Studio. */
  withoutStudio: boolean;
  workWithoutStudio(): void;
  /** The messages say whether this chat used a Studio, even when nobody watched it happen. */
  reportStudioUse(use: { started: boolean; usedStudio: boolean }): void;
  /** This chat has used a Studio, but which one was never written down. */
  unknownPlace: boolean;
  clearError(): void;
  /** A message is going out, so whichever Studio it's sent to is the one it would use. */
  noteRouted(): void;
  /** Someone picked a Studio for this chat by hand. */
  studioChosen: boolean;
  studioChoices: number;
  /** A forked chat carries the same history, so it's working in the same place. */
  copyPlaceToChat(from: string, to: string): void;
  twins: number;
  nameMatch: StudioTarget | null;
  /** Why a message can't go out yet, without a Studio to work in. */
  sendBlock: string | null;
  discover(): Promise<void>;
  select(target: StudioTarget): Promise<void>;
}

const StudioTargetContext = createContext<StudioTargetContextValue | null>(null);

export const STUDIO_NOT_INSTALLED = "BloxMind can't find Roblox Studio. Check it's installed.";

/** For a chat with no Studio, so the agent doesn't go looking for one and change the wrong place. */
export const NO_STUDIO_PROMPT_REFERENCE =
  "This chat isn't working in Roblox Studio. Do not use Roblox Studio tools unless the person asks you to connect one.";

const PLACE_CLOSED_PROMPT_REFERENCE =
  "The Roblox Studio place this chat works in isn't open. Do not use Roblox Studio tools. If the request needs Studio, ask the person to reopen that place.";

const CHOOSE_STUDIO_PROMPT_REFERENCE =
  "Several Roblox Studio places are open and this chat hasn't chosen one. Before using any Roblox Studio tool, ask the person to choose one in BloxMind's Studio picker. If the request has nothing to do with Roblox, ignore this.";

const STILL_FINDING_PROMPT_REFERENCE =
  "BloxMind hasn't finished finding which Roblox Studio places are open. Do not use Roblox Studio tools. If the request needs Studio, ask the person to try again in a moment.";

function countBucket(count: number): "0" | "1" | "2-4" | "5+" {
  if (count === 0) return "0";
  if (count === 1) return "1";
  if (count < 5) return "2-4";
  return "5+";
}

function discoveredPlaceIds(targets: readonly StudioTarget[]): string[] {
  return [...new Set(targets.flatMap((target) => (target.placeId ? [target.placeId] : [])))];
}

export function createStudioTargetPromptReference(target: StudioTarget): string {
  return `Route every Roblox Studio MCP tool call for this request to studio_id ${JSON.stringify(target.key)}. The selected Studio is ${JSON.stringify(target.label)}${target.placeId ? ` with Place ID ${JSON.stringify(target.placeId)}` : ""}. Do not call set_active_studio; routing is stateless. Re-list Studios and stop if this studio_id is no longer connected.`;
}

export function StudioTargetProvider({ children }: { children: ReactNode }) {
  const { client } = useOpenCodeClient();
  const { activeSessionId } = useActiveSession();
  const { selectedModel, selectedAgent } = usePreferences();
  const [targets, setTargets] = useState<readonly StudioTarget[]>([]);
  const [selected, setSelected] = useState<StudioTarget | null>(null);
  const [status, setStatus] = useState<StudioTargetStatus>("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [selectingKey, setSelectingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const operationRef = useRef(0);
  const targetsRef = useRef<readonly StudioTarget[]>([]);
  const programsRef = useRef<StudioTargetPrograms | null>(null);
  // Where the installed programs came from; a failed published copy is skipped
  // for the rest of the session in favour of the built-in programs.
  const programsSourceRef = useRef<"published" | "builtin" | "model" | null>(null);
  const publishedFailedRef = useRef(false);
  const programsUpdatedRef = useRef(false);
  const builtinInstallRef = useRef<Promise<StudioTargetPrograms> | null>(null);
  const discoveryRef = useRef<Promise<void> | null>(null);
  const generationRef = useRef<Promise<StudioTargetPrograms> | null>(null);
  const targetsBySessionRef = useRef<Record<string, StudioTarget>>({});
  const configLoadedRef = useRef(false);
  const [discoveryFailed, setDiscoveryFailed] = useState(false);
  const chatsWithoutStudioRef = useRef<ReadonlySet<string>>(new Set());
  const [withoutStudio, setWithoutStudio] = useState(false);
  const chosenChatsRef = useRef<ReadonlySet<string>>(new Set());
  const [studioChosen, setStudioChosen] = useState(false);
  const [studioChoices, setStudioChoices] = useState(0);
  const routedBySessionRef = useRef<Record<string, StudioTarget>>({});
  const unknownPlacesRef = useRef<ReadonlySet<string>>(new Set());
  const [unknownPlace, setUnknownPlace] = useState(false);
  const studioUseRef = useRef<{ session: string; used: boolean } | null>(null);
  const selectedRef = useRef<StudioTarget | null>(null);
  selectedRef.current = selected;
  const [findingForAWhile, setFindingForAWhile] = useState(false);
  const errorSourceRef = useRef<"discovery" | "select" | null>(null);
  // Latest active session id; in-flight discoveries compare against this so a
  // discovery that started for a previous session can't apply its result
  // (selection, analytics, remembered target) to the one now on screen.
  const activeSessionIdRef = useRef<string | null>(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  const rememberTarget = useCallback(async (target: StudioTarget, sessionId: string | null) => {
    if (!sessionId) return;
    const next = { ...targetsBySessionRef.current, [sessionId]: target };
    targetsBySessionRef.current = next;
    await desktop.patchConfig({ studioTargetsBySession: next });
  }, []);

  const setChatWithoutStudio = useCallback(
    async (on: boolean) => {
      if (!activeSessionId) return;
      setWithoutStudio(on);
      const chats = new Set(chatsWithoutStudioRef.current);
      if (chats.has(activeSessionId) === on) return;
      if (on) chats.add(activeSessionId);
      else chats.delete(activeSessionId);
      chatsWithoutStudioRef.current = chats;
      await desktop.patchConfig({ chatsWithoutStudio: [...chats] });
    },
    [activeSessionId],
  );

  const clearError = useCallback(() => {
    errorSourceRef.current = null;
    setError(null);
  }, []);

  const noteRouted = useCallback(() => {
    const current = selectedRef.current;
    if (!current || !activeSessionId) return;
    if (routedBySessionRef.current[activeSessionId]?.key === current.key) return;
    routedBySessionRef.current = { ...routedBySessionRef.current, [activeSessionId]: current };
    void desktop.patchConfig({ routedTargetsBySession: routedBySessionRef.current });
  }, [activeSessionId]);

  const copyPlaceToChat = useCallback((from: string, to: string) => {
    const place = targetsBySessionRef.current[from];
    if (place) {
      targetsBySessionRef.current = { ...targetsBySessionRef.current, [to]: place };
      void desktop.patchConfig({ studioTargetsBySession: targetsBySessionRef.current });
    }
    const routed = routedBySessionRef.current[from];
    if (routed) {
      routedBySessionRef.current = { ...routedBySessionRef.current, [to]: routed };
      void desktop.patchConfig({ routedTargetsBySession: routedBySessionRef.current });
    }
    if (chatsWithoutStudioRef.current.has(from)) {
      chatsWithoutStudioRef.current = new Set(chatsWithoutStudioRef.current).add(to);
      void desktop.patchConfig({ chatsWithoutStudio: [...chatsWithoutStudioRef.current] });
    }
    if (chosenChatsRef.current.has(from)) {
      chosenChatsRef.current = new Set(chosenChatsRef.current).add(to);
      void desktop.patchConfig({ chatsWithChosenPlace: [...chosenChatsRef.current] });
    }
  }, []);

  const generatePrograms = useCallback(async () => {
    if (generationRef.current) return generationRef.current;
    if (!client) throw new Error("The local agent is not ready");
    const model = selectedModel
      ? (() => {
          const [providerID, modelID] = splitModelKey(selectedModel);
          return providerID && modelID ? { providerID, modelID } : undefined;
        })()
      : undefined;
    const generation = generateStudioTargetPrograms(client, model, selectedAgent)
      .then((envelopes) => desktop.installStudioTargetPrograms(envelopes))
      .then(async (programs) => {
        programsRef.current = programs;
        programsSourceRef.current = "model";
        await desktop.patchConfig({ studioTargetPrograms: programs });
        return programs;
      })
      .finally(() => {
        generationRef.current = null;
      });
    generationRef.current = generation;
    return generation;
  }, [client, selectedAgent, selectedModel]);

  const getPrograms = useCallback(async () => {
    if (programsUpdatedRef.current) {
      programsUpdatedRef.current = false;
      if (programsSourceRef.current !== "model") programsRef.current = null;
    }
    if (programsRef.current) return programsRef.current;
    if (!builtinInstallRef.current) {
      // Published programs when newer than the built-in ones (see bloxmindPrograms.ts).
      builtinInstallRef.current = (
        publishedFailedRef.current
          ? Promise.resolve(BUILTIN_BLOXMIND_PROGRAMS)
          : resolveBloxMindPrograms()
      )
        .then((resolved) => {
          programsSourceRef.current = resolved.targets.source;
          return desktop.installStudioTargetPrograms(resolved.targets.programs);
        })
        .finally(() => {
          builtinInstallRef.current = null;
        });
    }
    const programs = await builtinInstallRef.current;
    if (!programsRef.current) {
      programsRef.current = programs;
    }
    return programsRef.current;
  }, []);

  // Newer published programs replace shipped or published ones on next use; a
  // working model-written pair is kept. A new version gets a fresh chance.
  useEffect(
    () =>
      desktop.onBloxMindProgramsUpdated(() => {
        publishedFailedRef.current = false;
        // Applied on the next getPrograms, so an install already running
        // can't put the old programs back afterwards.
        programsUpdatedRef.current = true;
      }),
    [],
  );

  /** Runs with the current programs, retrying with the built-in ones if published ones fail. */
  const withProgramFallbacks = useCallback(
    async <T,>(attempt: (programs: StudioTargetPrograms) => Promise<T>): Promise<T> => {
      try {
        return await attempt(await getPrograms());
      } catch (error) {
        if (programsSourceRef.current !== "published") throw error;
        const published = programsRef.current;
        publishedFailedRef.current = true;
        programsRef.current = null;
        try {
          // The published programs only count as broken if the built-in ones work.
          return await attempt(await getPrograms());
        } catch {
          publishedFailedRef.current = false;
          programsRef.current = published;
          programsSourceRef.current = "published";
          throw error;
        }
      }
    },
    [getPrograms],
  );

  const applyDiscovery = useCallback(
    async (
      programs: StudioTargetPrograms,
      operation: number,
      discoverySessionId: string | null,
    ) => {
      const stale = () =>
        operation !== operationRef.current || activeSessionIdRef.current !== discoverySessionId;
      const result = await desktop.discoverStudioTargets(programs);
      if (stale()) {
        setSelectingKey(null);
        return;
      }
      targetsRef.current = result.targets;
      setTargets(result.targets);
      // Work without Studio means don't bind this chat to whichever place is open.
      if (discoverySessionId && chatsWithoutStudioRef.current.has(discoverySessionId)) {
        setSelected(null);
        setStatus(result.targets.length === 0 ? "empty" : "ready");
        return;
      }
      const remembered = discoverySessionId
        ? targetsBySessionRef.current[discoverySessionId]
        : undefined;
      const placeMatches = remembered?.placeId
        ? result.targets.filter((target) => target.placeId === remembered.placeId)
        : [];
      const labelMatches = remembered
        ? result.targets.filter(
            (target) => target.label.trim().toLowerCase() === remembered.label.trim().toLowerCase(),
          )
        : [];
      let nextSelected = remembered
        ? (result.targets.find((target) => target.key === remembered.key) ??
          (placeMatches.length === 1 ? placeMatches[0] : undefined) ??
          (labelMatches.length === 1 ? labelMatches[0] : undefined) ??
          null)
        : (result.targets.find((target) => target.key === result.selectedKey) ?? null);
      const selectionMode = nextSelected
        ? nextSelected.key === remembered?.key
          ? "session_id_match"
          : remembered?.placeId && nextSelected.placeId === remembered.placeId
            ? "place_id_match"
            : "session_name_match"
        : "automatic";
      if (nextSelected && result.selectedKey !== nextSelected.key) {
        setSelectingKey(nextSelected.key);
        const selection = await desktop.selectStudioTarget(programs, nextSelected.key);
        if (stale()) {
          setSelectingKey(null);
          return;
        }
        if (!selection.verified) throw new Error("Target verification failed");
        nextSelected = selection.selected;
        await rememberTarget(nextSelected, discoverySessionId);
        setSelectingKey(null);
      }
      if (!nextSelected && result.targets.length === 1) {
        const onlyTarget = result.targets[0];
        setSelectingKey(onlyTarget.key);
        posthog.capture("studio_target_selected", analyticsProperties("studio_target"));
        const selection = await desktop.selectStudioTarget(programs, onlyTarget.key);
        if (stale()) {
          setSelectingKey(null);
          return;
        }
        if (!selection.verified) throw new Error("Target verification failed");
        nextSelected = selection.selected;
        await rememberTarget(nextSelected, discoverySessionId);
        posthog.capture(
          "studio_target_verification_succeeded",
          analyticsProperties("studio_target", {
            outcome: "success",
            selection_mode: selectionMode,
          }),
        );
        setSelectingKey(null);
      }
      setSelected(nextSelected);
      setStatus(result.targets.length === 0 ? "empty" : "ready");
      posthog.capture(
        "studio_target_discovery_succeeded",
        analyticsProperties("studio_target", {
          outcome: "success",
          count_bucket: countBucket(result.targets.length),
          selected: nextSelected !== null,
          ...detailedAnalyticsProperties({
            roblox_place_id: nextSelected?.placeId ?? undefined,
            roblox_discovered_place_ids: discoveredPlaceIds(result.targets),
            roblox_studio_count: result.targets.length,
          }),
        }),
      );
    },
    [rememberTarget],
  );

  const discover = useCallback(
    async (showLoading = true) => {
      if (discoveryRef.current) return discoveryRef.current;
      const discovery = (async () => {
        const operation = ++operationRef.current;
        // The session this discovery is for; results are discarded if the
        // user switches sessions before it completes.
        const discoverySessionId = activeSessionId;
        if (showLoading && targetsRef.current.length === 0) setStatus("loading");
        else setRefreshing(true);
        setError(null);
        try {
          await withProgramFallbacks((programs) =>
            applyDiscovery(programs, operation, discoverySessionId),
          );
          if (operation === operationRef.current) setDiscoveryFailed(false);
        } catch {
          if (operation !== operationRef.current) return;
          try {
            programsRef.current = null;
            const regenerated = await generatePrograms();
            await applyDiscovery(regenerated, operation, discoverySessionId);
          } catch (repairError) {
            if (operation !== operationRef.current) return;
            setStatus(targetsRef.current.length > 0 ? "ready" : "error");
            setDiscoveryFailed(true);
            setSelectingKey(null);
            console.error("[studio-target] discovery repair failed", repairError);
            setError("Studio integration setup failed. Refresh to try again.");
            posthog.capture(
              "studio_target_discovery_failed",
              errorAnalyticsProperties("studio_target", "discovery_repair", repairError, {
                used_model_fallback: true,
              }),
            );
          }
        }
      })().finally(() => {
        setRefreshing(false);
        discoveryRef.current = null;
      });
      discoveryRef.current = discovery;
      return discovery;
    },
    [activeSessionId, applyDiscovery, generatePrograms, withProgramFallbacks],
  );

  const workWithoutStudio = useCallback(() => {
    if (!activeSessionId) return;
    operationRef.current += 1;
    discoveryRef.current = null;
    setSelected(null);
    if (targetsBySessionRef.current[activeSessionId]) {
      const { [activeSessionId]: _forgotten, ...rest } = targetsBySessionRef.current;
      targetsBySessionRef.current = rest;
      void desktop.patchConfig({ studioTargetsBySession: rest });
    }
    chatsWithoutStudioRef.current = new Set(chatsWithoutStudioRef.current).add(activeSessionId);
    void setChatWithoutStudio(true);
    void discover();
  }, [activeSessionId, discover, setChatWithoutStudio]);

  const reportStudioUse = useCallback(
    ({ usedStudio }: { started: boolean; usedStudio: boolean }) => {
      if (!activeSessionId || !configLoadedRef.current) return;
      const remembered = targetsBySessionRef.current[activeSessionId];
      const seen = studioUseRef.current;
      if (seen?.session !== activeSessionId) {
        studioUseRef.current = { session: activeSessionId, used: usedStudio };
        const routed = routedBySessionRef.current[activeSessionId];
        if (usedStudio && !remembered && routed) {
          operationRef.current += 1;
          discoveryRef.current = null;
          const session = activeSessionId;
          void rememberTarget(routed, activeSessionId).then(() => {
            if (activeSessionIdRef.current === session) void discover();
          });
        } else if (!usedStudio && remembered && !chosenChatsRef.current.has(activeSessionId)) {
          const { [activeSessionId]: _forgotten, ...rest } = targetsBySessionRef.current;
          targetsBySessionRef.current = rest;
          void desktop.patchConfig({ studioTargetsBySession: rest });
          void discover();
        } else if (usedStudio && !remembered) {
          operationRef.current += 1;
          discoveryRef.current = null;
          unknownPlacesRef.current = new Set(unknownPlacesRef.current).add(activeSessionId);
          setSelected(null);
          setUnknownPlace(true);
          void discover();
        }
        return;
      }
      if (!usedStudio || seen.used) return;
      seen.used = true;
      if (remembered) return;
      const usedTarget = routedBySessionRef.current[activeSessionId] ?? selectedRef.current;
      if (usedTarget) void rememberTarget(usedTarget, activeSessionId);
      else {
        unknownPlacesRef.current = new Set(unknownPlacesRef.current).add(activeSessionId);
        setUnknownPlace(true);
      }
    },
    [activeSessionId, discover, rememberTarget],
  );

  const select = useCallback(
    async (target: StudioTarget) => {
      const operation = ++operationRef.current;
      const sessionIdAtStart = activeSessionId;
      setSelectingKey(target.key);
      setError(null);
      posthog.capture(
        "studio_target_selected",
        analyticsProperties("studio_target", { selection_mode: "manual" }),
      );
      const attempt = async (programs: StudioTargetPrograms) => {
        const result = await desktop.selectStudioTarget(programs, target.key);
        if (!result.verified) throw new Error("Target verification failed");
        return result;
      };
      try {
        let result: StudioTargetSelection;
        try {
          result = await withProgramFallbacks(attempt);
        } catch {
          programsRef.current = null;
          result = await attempt(await generatePrograms());
        }
        if (operation !== operationRef.current || activeSessionIdRef.current !== sessionIdAtStart) {
          return;
        }
        await setChatWithoutStudio(false);
        if (operation !== operationRef.current || activeSessionIdRef.current !== sessionIdAtStart) {
          return;
        }
        if (sessionIdAtStart) {
          const unknown = new Set(unknownPlacesRef.current);
          unknown.delete(sessionIdAtStart);
          unknownPlacesRef.current = unknown;
        }
        setUnknownPlace(false);
        setStudioChosen(true);
        setStudioChoices((count) => count + 1);
        if (sessionIdAtStart && !chosenChatsRef.current.has(sessionIdAtStart)) {
          const chosen = new Set(chosenChatsRef.current).add(sessionIdAtStart);
          chosenChatsRef.current = chosen;
          void desktop.patchConfig({ chatsWithChosenPlace: [...chosen] });
        }
        setSelected(result.selected);
        await rememberTarget(result.selected, sessionIdAtStart);
        setTargets((current) =>
          current.some((item) => item.key === result.selected.key)
            ? current
            : [...current, result.selected],
        );
        setStatus("ready");
        posthog.capture(
          "studio_target_verification_succeeded",
          analyticsProperties("studio_target", { outcome: "success", selection_mode: "manual" }),
        );
      } catch (error) {
        if (operation !== operationRef.current) return;
        setError("That Studio window is no longer available. Refresh and choose another.");
        posthog.capture(
          "studio_target_verification_failed",
          errorAnalyticsProperties("studio_target", "verification", error, {
            selection_mode: "manual",
          }),
        );
      } finally {
        if (operation === operationRef.current) setSelectingKey(null);
      }
    },
    [activeSessionId, generatePrograms, rememberTarget, setChatWithoutStudio, withProgramFallbacks],
  );

  // AI traces attach the Studio place the prompt was routed to.
  useEffect(() => {
    setStudioAnalyticsContext(
      selected || targets.length > 0
        ? {
            placeId: selected?.placeId ?? null,
            placeName: selected?.label ?? null,
            discoveredPlaceIds: discoveredPlaceIds(targets),
            discoveredCount: targets.length,
          }
        : null,
    );
  }, [selected, targets]);

  useEffect(() => {
    if (!client || !activeSessionId) {
      setSelected(null);
      return;
    }
    let cancelled = false;
    const loadAndDiscover = async () => {
      if (!configLoadedRef.current) {
        const config = await desktop.loadConfig();
        // Another session switch happened while the config was loading; its
        // own effect run will (re)apply the correct remembered target.
        if (cancelled) return;
        targetsBySessionRef.current = config.studioTargetsBySession ?? {};
        chatsWithoutStudioRef.current = new Set(config.chatsWithoutStudio ?? []);
        chosenChatsRef.current = new Set(config.chatsWithChosenPlace ?? []);
        routedBySessionRef.current = config.routedTargetsBySession ?? {};
        configLoadedRef.current = true;
      }
      setWithoutStudio(chatsWithoutStudioRef.current.has(activeSessionId));
      if (errorSourceRef.current === "select") clearError();
      setUnknownPlace(unknownPlacesRef.current.has(activeSessionId));
      setStudioChosen(chosenChatsRef.current.has(activeSessionId));
      setSelected(targetsBySessionRef.current[activeSessionId] ?? null);
      // Any selection spinner belonged to the previous session.
      setSelectingKey(null);
      await discover(false);
    };
    void loadAndDiscover();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, clearError, client, discover]);

  // Finding Studios is normally a moment. A stuck helper mustn't keep every chat from sending.
  useEffect(() => {
    setFindingForAWhile(false);
    if (status !== "loading") return;
    const timer = window.setTimeout(() => setFindingForAWhile(true), 3_000);
    return () => window.clearTimeout(timer);
  }, [status]);

  const remembered = activeSessionId ? targetsBySessionRef.current[activeSessionId] : undefined;
  const missing = !withoutStudio && !selected && remembered ? remembered : null;
  const sameName = missing ? targets.filter((target) => sameNamedPlace(target, missing)) : [];
  const twins = sameName.length;
  const nameMatch = twins === 1 ? (sameName[0] ?? null) : null;
  // With no place to get wrong, a chat can carry on with whatever else it's about.
  const sendBlock =
    withoutStudio || targets.length === 0
      ? status === "loading" && !withoutStudio && !findingForAWhile
        ? "Finding Studios."
        : null
      : missing && discoveryFailed
        ? `Couldn't check if ${placeName(missing.label)} is open. Refresh, or work without Studio.`
        : missing && twins > 1
          ? `${twins} places named ${placeName(missing.label)} are open. Choose one, or work without Studio.`
          : missing && nameMatch
            ? `Is the open ${placeName(missing.label)} this chat's place? Choose it, or work without Studio.`
            : missing
              ? `${placeName(missing.label)} isn't open. Reopen it, choose another, or work without Studio.`
              : unknownPlace && !selected
                ? "Choose which Studio this chat worked in, or work without Studio."
                : null;

  // Quickly while someone waits for a Studio or this chat's place, slowly otherwise.
  useEffect(() => {
    if (!client || status === "loading" || withoutStudio) return;
    const timer = window.setInterval(
      () => void discover(false),
      status === "empty" || missing !== null ? 2_000 : 10_000,
    );
    return () => window.clearInterval(timer);
  }, [client, discover, missing, status, withoutStudio]);

  const promptReference = selected
    ? createStudioTargetPromptReference(selected)
    : missing
      ? PLACE_CLOSED_PROMPT_REFERENCE
      : withoutStudio || (status !== "loading" && targets.length === 0)
        ? NO_STUDIO_PROMPT_REFERENCE
        : status === "loading"
          ? STILL_FINDING_PROMPT_REFERENCE
          : targets.length > 1
            ? CHOOSE_STUDIO_PROMPT_REFERENCE
            : null;
  const value = useMemo(
    () => ({
      targets,
      selected,
      promptReference,
      status,
      discoveryFailed,
      refreshing,
      selectingKey,
      error,
      missing,
      withoutStudio,
      workWithoutStudio,
      reportStudioUse,
      unknownPlace,
      clearError,
      noteRouted,
      studioChosen,
      studioChoices,
      copyPlaceToChat,
      twins,
      nameMatch,
      sendBlock,
      discover,
      select,
    }),
    [
      targets,
      selected,
      promptReference,
      status,
      discoveryFailed,
      refreshing,
      selectingKey,
      error,
      missing,
      withoutStudio,
      workWithoutStudio,
      reportStudioUse,
      unknownPlace,
      clearError,
      noteRouted,
      studioChosen,
      studioChoices,
      copyPlaceToChat,
      twins,
      nameMatch,
      sendBlock,
      discover,
      select,
    ],
  );
  return <StudioTargetContext.Provider value={value}>{children}</StudioTargetContext.Provider>;
}

export function useStudioTarget() {
  const value = useContext(StudioTargetContext);
  if (!value) throw new Error("useStudioTarget must be used inside StudioTargetProvider");
  return value;
}

export function useStudioTargetOptional() {
  return useContext(StudioTargetContext);
}
