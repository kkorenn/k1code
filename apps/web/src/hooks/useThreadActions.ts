import { ThreadId } from "@t3tools/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";

import { useAppSettings } from "../appSettings";
import { useComposerDraftStore } from "../composerDraftStore";
import { gitRemoveWorktreeMutationOptions } from "../lib/gitReactQuery";
import { newCommandId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import { useTerminalStateStore } from "../terminalStateStore";
import { formatWorktreePathForDisplay, getOrphanedWorktreePathForThread } from "../worktreeCleanup";
import { toastManager } from "../components/ui/toast";

export function useThreadActions() {
  const threads = useStore((store) => store.threads);
  const projects = useStore((store) => store.projects);
  const { settings: appSettings } = useAppSettings();
  const clearComposerDraftForThread = useComposerDraftStore((store) => store.clearDraftThread);
  const clearProjectDraftThreadById = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadById,
  );
  const clearTerminalState = useTerminalStateStore((state) => state.clearTerminalState);
  const navigate = useNavigate();
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const queryClient = useQueryClient();
  const removeWorktreeMutation = useMutation(gitRemoveWorktreeMutationOptions({ queryClient }));

  const archiveThread = async (threadId: ThreadId) => {
    const api = readNativeApi();
    if (!api) return;
    await api.orchestration.dispatchCommand({
      type: "thread.archive",
      commandId: newCommandId(),
      threadId,
    });
  };

  const unarchiveThread = async (threadId: ThreadId) => {
    const api = readNativeApi();
    if (!api) return;
    await api.orchestration.dispatchCommand({
      type: "thread.unarchive",
      commandId: newCommandId(),
      threadId,
    });
  };

  const deleteThread = async (
    threadId: ThreadId,
    opts: { deletedThreadIds?: ReadonlySet<ThreadId> } = {},
  ) => {
    const api = readNativeApi();
    if (!api) return;
    const thread = threads.find((entry) => entry.id === threadId);
    if (!thread) return;
    const threadProject = projects.find((project) => project.id === thread.projectId);
    const deletedIds = opts.deletedThreadIds;
    const survivingThreads =
      deletedIds && deletedIds.size > 0
        ? threads.filter((entry) => entry.id === threadId || !deletedIds.has(entry.id))
        : threads;
    const orphanedWorktreePath = getOrphanedWorktreePathForThread(survivingThreads, threadId);
    const displayWorktreePath = orphanedWorktreePath
      ? formatWorktreePathForDisplay(orphanedWorktreePath)
      : null;
    const canDeleteWorktree = orphanedWorktreePath !== null && threadProject !== undefined;
    const shouldDeleteWorktree =
      canDeleteWorktree &&
      (await api.dialogs.confirm(
        [
          "This thread is the only one linked to this worktree:",
          displayWorktreePath ?? orphanedWorktreePath,
          "",
          "Delete the worktree too?",
        ].join("\n"),
      ));

    if (thread.session && thread.session.status !== "closed") {
      await api.orchestration
        .dispatchCommand({
          type: "thread.session.stop",
          commandId: newCommandId(),
          threadId,
          createdAt: new Date().toISOString(),
        })
        .catch(() => undefined);
    }

    try {
      await api.terminal.close({ threadId, deleteHistory: true });
    } catch {
      // Terminal may already be closed.
    }

    const allDeletedIds = deletedIds ?? new Set<ThreadId>();
    const shouldNavigateToFallback = routeThreadId === threadId;
    const fallbackThreadId =
      threads.find((entry) => entry.id !== threadId && !allDeletedIds.has(entry.id))?.id ?? null;
    await api.orchestration.dispatchCommand({
      type: "thread.delete",
      commandId: newCommandId(),
      threadId,
    });
    clearComposerDraftForThread(threadId);
    clearProjectDraftThreadById(thread.projectId, thread.id);
    clearTerminalState(threadId);

    if (shouldNavigateToFallback) {
      if (fallbackThreadId) {
        void navigate({
          to: "/$threadId",
          params: { threadId: fallbackThreadId },
          replace: true,
        });
      } else {
        void navigate({ to: "/", replace: true });
      }
    }

    if (!shouldDeleteWorktree || !orphanedWorktreePath || !threadProject) {
      return;
    }

    try {
      await removeWorktreeMutation.mutateAsync({
        cwd: threadProject.cwd,
        path: orphanedWorktreePath,
        force: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error removing worktree.";
      console.error("Failed to remove orphaned worktree after thread deletion", {
        threadId,
        projectCwd: threadProject.cwd,
        worktreePath: orphanedWorktreePath,
        error,
      });
      toastManager.add({
        type: "error",
        title: "Thread deleted, but worktree removal failed",
        description: `Could not remove ${displayWorktreePath ?? orphanedWorktreePath}. ${message}`,
      });
    }
  };

  const confirmAndDeleteThread = async (threadId: ThreadId) => {
    const api = readNativeApi();
    if (!api) return;
    const thread = threads.find((entry) => entry.id === threadId);
    if (!thread) return;

    if (appSettings.confirmThreadDelete) {
      const confirmed = await api.dialogs.confirm(
        [
          `Delete thread "${thread.title}"?`,
          "This permanently clears conversation history for this thread.",
        ].join("\n"),
      );
      if (!confirmed) {
        return;
      }
    }

    await deleteThread(threadId);
  };

  return {
    archiveThread,
    unarchiveThread,
    deleteThread,
    confirmAndDeleteThread,
  };
}
