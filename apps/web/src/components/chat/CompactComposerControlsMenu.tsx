import { ProviderInteractionMode, RuntimeMode } from "@k1tools/contracts";
import { memo, type ReactNode, useState } from "react";
import { EllipsisIcon, ListTodoIcon } from "lucide-react";
import { Button } from "../ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from "../ui/menu";

export const CompactComposerControlsMenu = memo(function CompactComposerControlsMenu(props: {
  activePlan: boolean;
  interactionMode: ProviderInteractionMode;
  planSidebarOpen: boolean;
  runtimeMode: RuntimeMode;
  traitsMenuContent?: ReactNode;
  onToggleInteractionMode: () => void;
  onTogglePlanSidebar: () => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const handleRuntimeModeChange = (value: string) => {
    if (value !== "approval-required" && value !== "workspace-write" && value !== "full-access") {
      return;
    }
    if (value === props.runtimeMode) {
      return;
    }
    props.onRuntimeModeChange(value);
  };

  return (
    <Menu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 px-2 text-muted-foreground/70 hover:text-foreground/80"
            aria-label="More composer controls"
          />
        }
      >
        <EllipsisIcon
          aria-hidden="true"
          className={`size-4 transition-transform duration-200 ease-out ${
            isMenuOpen ? "rotate-90" : "rotate-0"
          }`}
        />
      </MenuTrigger>
      <MenuPopup align="start">
        {props.traitsMenuContent ? (
          <>
            {props.traitsMenuContent}
            <MenuDivider />
          </>
        ) : null}
        <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Mode</div>
        <MenuRadioGroup
          value={props.interactionMode}
          onValueChange={(value) => {
            if (!value || value === props.interactionMode) return;
            props.onToggleInteractionMode();
          }}
        >
          <MenuRadioItem value="default">Chat</MenuRadioItem>
          <MenuRadioItem value="plan">Plan</MenuRadioItem>
        </MenuRadioGroup>
        <MenuDivider />
        <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Access</div>
        <MenuRadioGroup value={props.runtimeMode} onValueChange={handleRuntimeModeChange}>
          <MenuRadioItem value="approval-required">Supervised</MenuRadioItem>
          <MenuRadioItem value="workspace-write">Workspace access</MenuRadioItem>
          <MenuRadioItem value="full-access">Full access</MenuRadioItem>
        </MenuRadioGroup>
        {props.activePlan ? (
          <>
            <MenuDivider />
            <MenuItem onClick={props.onTogglePlanSidebar}>
              <ListTodoIcon className="size-4 shrink-0" />
              {props.planSidebarOpen ? "Hide plan sidebar" : "Show plan sidebar"}
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
});
