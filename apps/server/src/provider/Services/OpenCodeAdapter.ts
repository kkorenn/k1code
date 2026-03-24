/**
 * OpenCodeAdapter - OpenCode CLI implementation of the generic provider adapter contract.
 *
 * This service owns OpenCode runtime/session semantics and emits canonical
 * provider runtime events. It does not perform cross-provider routing, shared
 * event fan-out, or checkpoint orchestration.
 *
 * @module OpenCodeAdapter
 */
import { ServiceMap } from "effect";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

/**
 * OpenCodeAdapterShape - Service API for the OpenCode provider adapter.
 */
export interface OpenCodeAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly provider: "openCode";
}

/**
 * OpenCodeAdapter - Service tag for OpenCode provider adapter operations.
 */
export class OpenCodeAdapter extends ServiceMap.Service<OpenCodeAdapter, OpenCodeAdapterShape>()(
  "k1/provider/Services/OpenCodeAdapter",
) {}
