import { type ModelSlug, type ProviderKind } from "@k1tools/contracts";
import { resolveSelectableModel } from "@k1tools/shared/model";
import { memo, useMemo, useState } from "react";
import { type ProviderPickerKind, PROVIDER_OPTIONS } from "../../session-logic";
import { detectInstallTargetOs, getProviderInstallGuide } from "../../providerInstall";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "../ui/dialog";
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { ClaudeAI, CursorIcon, Gemini, Icon, OpenAI, OpenCodeIcon } from "../Icons";
import { cn } from "~/lib/utils";

function isAvailableProviderOption(option: (typeof PROVIDER_OPTIONS)[number]): option is {
  value: ProviderKind;
  label: string;
  available: true;
} {
  return option.available;
}

const PROVIDER_ICON_BY_PROVIDER: Record<ProviderPickerKind, Icon> = {
  codex: OpenAI,
  claudeAgent: ClaudeAI,
  gemini: Gemini,
  cursor: CursorIcon,
  openCode: OpenCodeIcon,
};

export const AVAILABLE_PROVIDER_OPTIONS = PROVIDER_OPTIONS.filter(isAvailableProviderOption);
const UNAVAILABLE_PROVIDER_OPTIONS = PROVIDER_OPTIONS.filter((option) => !option.available);

function providerIconClassName(
  provider: ProviderKind | ProviderPickerKind,
  fallbackClassName: string,
): string {
  return provider === "claudeAgent" ? "text-[#d97757]" : fallbackClassName;
}

export const ProviderModelPicker = memo(function ProviderModelPicker(props: {
  provider: ProviderKind;
  model: ModelSlug;
  lockedProvider: ProviderKind | null;
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>>;
  providerAvailabilityByProvider?: Partial<Record<ProviderKind, boolean>>;
  activeProviderIconClassName?: string;
  compact?: boolean;
  disabled?: boolean;
  onProviderModelChange: (provider: ProviderKind, model: ModelSlug) => void;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [installHelpProvider, setInstallHelpProvider] = useState<ProviderKind | null>(null);
  const activeProvider = props.lockedProvider ?? props.provider;
  const selectedProviderOptions = props.modelOptionsByProvider[activeProvider];
  const selectedModelLabel =
    selectedProviderOptions.find((option) => option.slug === props.model)?.name ?? props.model;
  const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[activeProvider];
  const installTargetOs = useMemo(() => detectInstallTargetOs(), []);
  const installGuide = installHelpProvider
    ? getProviderInstallGuide(installHelpProvider, installTargetOs)
    : null;
  const isProviderUnavailable = (provider: ProviderKind) =>
    props.providerAvailabilityByProvider?.[provider] === false;
  const isActiveProviderUnavailable = isProviderUnavailable(activeProvider);
  const handleUnavailableProviderClick = (provider: ProviderKind) => {
    if (props.disabled) return;
    setIsMenuOpen(false);
    setInstallHelpProvider(provider);
  };
  const handleModelChange = (provider: ProviderKind, value: string) => {
    if (props.disabled) return;
    if (isProviderUnavailable(provider)) return;
    if (!value) return;
    const resolvedModel = resolveSelectableModel(
      provider,
      value,
      props.modelOptionsByProvider[provider],
    );
    if (!resolvedModel) return;
    props.onProviderModelChange(provider, resolvedModel);
    setIsMenuOpen(false);
  };

  return (
    <Menu
      open={isMenuOpen}
      onOpenChange={(open) => {
        if (props.disabled) {
          setIsMenuOpen(false);
          return;
        }
        setIsMenuOpen(open);
      }}
    >
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className={cn(
              "min-w-0 justify-start overflow-hidden whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 [&_svg]:mx-0",
              props.compact ? "max-w-42 shrink-0" : "max-w-48 shrink sm:max-w-56 sm:px-3",
            )}
            disabled={props.disabled}
          />
        }
      >
        <span
          className={cn(
            "flex min-w-0 w-full items-center gap-2 overflow-hidden",
            props.compact ? "max-w-36" : undefined,
          )}
        >
          <ProviderIcon
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0",
              providerIconClassName(activeProvider, "text-muted-foreground/70"),
              isActiveProviderUnavailable ? "grayscale opacity-70" : undefined,
              props.activeProviderIconClassName,
            )}
          />
          <span className="min-w-0 flex-1 truncate">{selectedModelLabel}</span>
          <ChevronDownIcon
            aria-hidden="true"
            className={cn(
              "size-3 shrink-0 opacity-60 transition-transform duration-200 ease-out",
              isMenuOpen ? "rotate-180" : "rotate-0",
            )}
          />
        </span>
      </MenuTrigger>
      <MenuPopup align="start">
        {props.lockedProvider !== null ? (
          <MenuGroup>
            {isProviderUnavailable(props.lockedProvider) ? (
              <MenuItem
                className="cursor-pointer text-muted-foreground data-highlighted:text-muted-foreground [&_svg]:grayscale"
                onClick={() => handleUnavailableProviderClick(props.lockedProvider!)}
              >
                <ProviderIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground/85 opacity-70 grayscale"
                />
                <span>
                  {PROVIDER_OPTIONS.find((option) => option.value === props.lockedProvider)?.label}
                </span>
                <span className="ms-auto text-[11px] text-muted-foreground/80 uppercase tracking-[0.08em]">
                  Unavailable
                </span>
              </MenuItem>
            ) : (
              <MenuRadioGroup
                value={props.model}
                onValueChange={(value) => handleModelChange(props.lockedProvider!, value)}
              >
                {props.modelOptionsByProvider[props.lockedProvider].map((modelOption) => (
                  <MenuRadioItem
                    key={`${props.lockedProvider}:${modelOption.slug}`}
                    value={modelOption.slug}
                    onClick={() => setIsMenuOpen(false)}
                  >
                    {modelOption.name}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            )}
          </MenuGroup>
        ) : (
          <>
            {AVAILABLE_PROVIDER_OPTIONS.map((option) => {
              const OptionIcon = PROVIDER_ICON_BY_PROVIDER[option.value];
              if (isProviderUnavailable(option.value)) {
                return (
                  <MenuItem
                    key={option.value}
                    className="cursor-pointer text-muted-foreground data-highlighted:text-muted-foreground [&_svg]:grayscale"
                    onClick={() => handleUnavailableProviderClick(option.value)}
                  >
                    <OptionIcon
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground/85 opacity-70 grayscale"
                    />
                    <span>{option.label}</span>
                    <span className="ms-auto text-[11px] text-muted-foreground/80 uppercase tracking-[0.08em]">
                      Unavailable
                    </span>
                  </MenuItem>
                );
              }

              return (
                <MenuSub key={option.value}>
                  <MenuSubTrigger>
                    <OptionIcon
                      aria-hidden="true"
                      className={cn(
                        "size-4 shrink-0",
                        providerIconClassName(option.value, "text-muted-foreground/85"),
                      )}
                    />
                    {option.label}
                  </MenuSubTrigger>
                  <MenuSubPopup className="[--available-height:min(24rem,70vh)]">
                    <MenuGroup>
                      <MenuRadioGroup
                        value={props.provider === option.value ? props.model : ""}
                        onValueChange={(value) => handleModelChange(option.value, value)}
                      >
                        {props.modelOptionsByProvider[option.value].map((modelOption) => (
                          <MenuRadioItem
                            key={`${option.value}:${modelOption.slug}`}
                            value={modelOption.slug}
                            onClick={() => setIsMenuOpen(false)}
                          >
                            {modelOption.name}
                          </MenuRadioItem>
                        ))}
                      </MenuRadioGroup>
                    </MenuGroup>
                  </MenuSubPopup>
                </MenuSub>
              );
            })}
            {UNAVAILABLE_PROVIDER_OPTIONS.length > 0 && <MenuDivider />}
            {UNAVAILABLE_PROVIDER_OPTIONS.map((option) => {
              const OptionIcon = PROVIDER_ICON_BY_PROVIDER[option.value];
              return (
                <MenuItem
                  key={option.value}
                  disabled
                  className="text-muted-foreground [&_svg]:grayscale"
                >
                  <OptionIcon
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground/85 opacity-70 grayscale"
                  />
                  <span>{option.label}</span>
                  <span className="ms-auto text-[11px] text-muted-foreground/80 uppercase tracking-[0.08em]">
                    Coming soon
                  </span>
                </MenuItem>
              );
            })}
          </>
        )}
      </MenuPopup>
      <Dialog
        open={installHelpProvider !== null}
        onOpenChange={(open) => {
          if (!open) {
            setInstallHelpProvider(null);
          }
        }}
      >
        {installGuide ? (
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{installGuide.providerLabel} Unavailable</DialogTitle>
              <DialogDescription>
                K1 Code could not detect the {installGuide.providerLabel} CLI. Setup guidance is
                shown for {installGuide.osLabel}.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel className="space-y-3 pt-0">
              {installGuide.steps.map((step, index) => (
                <div
                  key={`${installGuide.provider}:${step.title}:${step.command ?? "note"}`}
                  className="space-y-1 rounded-lg border border-border bg-background px-3 py-2"
                >
                  <p className="text-sm font-medium text-foreground">
                    {index + 1}. {step.title}
                  </p>
                  {step.command ? (
                    <code className="block break-all rounded-md border border-border/70 bg-muted/60 px-2 py-1 font-mono text-xs text-foreground">
                      {step.command}
                    </code>
                  ) : null}
                  {step.note ? <p className="text-xs text-muted-foreground">{step.note}</p> : null}
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                If your CLI is in a non-standard location, set its binary path in Settings and try
                again.
              </p>
            </DialogPanel>
            <DialogFooter>
              <Button variant="outline" onClick={() => setInstallHelpProvider(null)}>
                Dismiss
              </Button>
              <Button
                render={
                  <a href={installGuide.installUrl} target="_blank" rel="noreferrer noopener" />
                }
              >
                Open provider setup docs
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </Menu>
  );
});
