/**
 * CopilotAdapter - Copilot CLI implementation of the generic provider adapter contract.
 *
 * This service owns Copilot runtime/session semantics and emits canonical
 * provider runtime events. It does not perform cross-provider routing, shared
 * event fan-out, or checkpoint orchestration.
 *
 * @module CopilotAdapter
 */
import { ServiceMap } from "effect";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

/**
 * CopilotAdapterShape - Service API for the Copilot provider adapter.
 */
export interface CopilotAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly provider: "copilot";
}

/**
 * CopilotAdapter - Service tag for Copilot provider adapter operations.
 */
export class CopilotAdapter extends ServiceMap.Service<CopilotAdapter, CopilotAdapterShape>()(
  "k1/provider/Services/CopilotAdapter",
) {}
