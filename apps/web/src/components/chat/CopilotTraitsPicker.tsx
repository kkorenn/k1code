import type {
  CodexReasoningEffort,
  CopilotModelOptions,
  ProviderKind,
  ThreadId,
} from "@k1tools/contracts";
import {
  getDefaultReasoningEffort,
  getReasoningEffortOptions,
  resolveReasoningEffortForProvider,
} from "@k1tools/shared/model";
import { memo, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { useComposerDraftStore, useComposerThreadDraft } from "../../composerDraftStore";
import { Button } from "../ui/button";
import { Menu, MenuGroup, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";

const PROVIDER = "copilot" as const satisfies ProviderKind;

const COPILOT_REASONING_LABELS: Record<CodexReasoningEffort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
};

function resolveCopilotEffort(value: string | null | undefined): CodexReasoningEffort | null {
  const resolved = resolveReasoningEffortForProvider(PROVIDER, value);
  if (!resolved) {
    return null;
  }
  return ["low", "medium", "high", "xhigh"].includes(resolved)
    ? (resolved as CodexReasoningEffort)
    : null;
}

function normalizeCopilotModelOptions(
  options: CopilotModelOptions | null | undefined,
): CopilotModelOptions | undefined {
  if (!options) {
    return undefined;
  }
  const effort = resolveCopilotEffort(options.reasoningEffort);
  if (!effort) {
    return undefined;
  }
  return { reasoningEffort: effort };
}

function getSelectedCopilotTraits(modelOptions: CopilotModelOptions | null | undefined): {
  effort: CodexReasoningEffort;
} {
  const defaultReasoningEffort = getDefaultReasoningEffort(PROVIDER);
  const normalizedDefault = resolveCopilotEffort(defaultReasoningEffort) ?? "high";
  return {
    effort: resolveCopilotEffort(modelOptions?.reasoningEffort) ?? normalizedDefault,
  };
}

function CopilotTraitsMenuContentImpl(props: { threadId: ThreadId }) {
  const draft = useComposerThreadDraft(props.threadId);
  const modelOptions = draft.modelOptions?.[PROVIDER];
  const setProviderModelOptions = useComposerDraftStore((store) => store.setProviderModelOptions);
  const options = getReasoningEffortOptions(PROVIDER).filter(
    (option): option is CodexReasoningEffort =>
      option === "low" || option === "medium" || option === "high" || option === "xhigh",
  );
  const defaultReasoningEffort = resolveCopilotEffort(getDefaultReasoningEffort(PROVIDER));
  const { effort } = getSelectedCopilotTraits(modelOptions);

  return (
    <MenuGroup>
      <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Reasoning</div>
      <MenuRadioGroup
        value={effort}
        onValueChange={(value) => {
          if (!value) return;
          const nextEffort = options.find((option) => option === value);
          if (!nextEffort) return;
          setProviderModelOptions(
            props.threadId,
            PROVIDER,
            normalizeCopilotModelOptions({
              ...modelOptions,
              reasoningEffort: nextEffort,
            }),
            { persistSticky: true },
          );
        }}
      >
        {options.map((option) => (
          <MenuRadioItem key={option} value={option}>
            {COPILOT_REASONING_LABELS[option]}
            {option === defaultReasoningEffort ? " (default)" : ""}
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </MenuGroup>
  );
}

export const CopilotTraitsMenuContent = memo(CopilotTraitsMenuContentImpl);

export const CopilotTraitsPicker = memo(function CopilotTraitsPicker(props: {
  threadId: ThreadId;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const modelOptions = useComposerThreadDraft(props.threadId).modelOptions?.copilot;
  const { effort } = getSelectedCopilotTraits(modelOptions);
  const triggerLabel = COPILOT_REASONING_LABELS[effort];

  return (
    <Menu
      open={isMenuOpen}
      onOpenChange={(open) => {
        setIsMenuOpen(open);
      }}
    >
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="min-w-0 max-w-40 shrink justify-start overflow-hidden whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:max-w-48 sm:px-3 [&_svg]:mx-0"
          />
        }
      >
        <span className="flex min-w-0 w-full items-center gap-2 overflow-hidden">
          {triggerLabel}
          <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0 opacity-60" />
        </span>
      </MenuTrigger>
      <MenuPopup align="start">
        <CopilotTraitsMenuContent threadId={props.threadId} />
      </MenuPopup>
    </Menu>
  );
});
