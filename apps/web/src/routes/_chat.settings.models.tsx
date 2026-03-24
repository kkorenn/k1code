import { createFileRoute } from "@tanstack/react-router";

import { ModelsSettingsPanel } from "../components/settings/SettingsPanels";

export const Route = createFileRoute("/_chat/settings/models")({
  component: ModelsSettingsPanel,
});
