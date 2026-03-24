/**
 * CursorAdapter - Cursor Agent CLI implementation of the generic provider adapter contract.
 *
 * This service owns Cursor runtime/session semantics and emits canonical
 * provider runtime events. It does not perform cross-provider routing, shared
 * event fan-out, or checkpoint orchestration.
 *
 * @module CursorAdapter
 */
import { ServiceMap } from "effect";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

/**
 * CursorAdapterShape - Service API for the Cursor provider adapter.
 */
export interface CursorAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly provider: "cursor";
}

/**
 * CursorAdapter - Service tag for Cursor provider adapter operations.
 */
export class CursorAdapter extends ServiceMap.Service<CursorAdapter, CursorAdapterShape>()(
  "t3/provider/Services/CursorAdapter",
) {}
