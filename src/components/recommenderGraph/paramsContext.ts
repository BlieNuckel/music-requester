import { createContext, useContext } from "react";
import type { PromotedAlbumSettings } from "@/context/settingsContextDef";
import type { FlowId } from "@shared/recommenderGraph";

export type ParamKey = keyof PromotedAlbumSettings;

/** Every shape a knob's value can take. Which one applies is decided by `ParamDef.kind`. */
export type ParamValue = string | number | boolean | string[];

export type RecommenderParams = {
  config: PromotedAlbumSettings;
  update: (key: ParamKey, value: ParamValue) => void;
  /** Follow a boundary node into the flow that owns it, and land on the node itself. */
  openFlow: (flow: FlowId, node: string) => void;
  /**
   * The node that was followed into this flow, marked so it can be found. Arriving at a
   * chart of a dozen cards with no idea which one you came for is most of the work of
   * following a reference.
   */
  arrivedAt: string | null;
};

/**
 * Current values reach a node through context rather than through its flow data, so typing
 * in one input does not rebuild every node in the canvas.
 */
export const RecommenderParamsContext = createContext<RecommenderParams | null>(
  null
);

export function useRecommenderParams(): RecommenderParams {
  const value = useContext(RecommenderParamsContext);
  if (!value) {
    throw new Error(
      "useRecommenderParams must be used inside a RecommenderParamsContext provider"
    );
  }
  return value;
}
