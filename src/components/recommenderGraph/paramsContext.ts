import { createContext, useContext } from "react";
import type { PromotedAlbumSettings } from "@/context/settingsContextDef";
import type { FlowId } from "@shared/recommenderGraph";

export type ParamKey = keyof PromotedAlbumSettings;

/** Every shape a knob's value can take. Which one applies is decided by `ParamDef.kind`. */
export type ParamValue = string | number | boolean | string[];

export type RecommenderParams = {
  config: PromotedAlbumSettings;
  update: (key: ParamKey, value: ParamValue) => void;
  /**
   * Follow a boundary node into the flow that owns it, and land on the node itself. Null
   * where there is nowhere to go: a chart drawn to explain one recommendation shows a single
   * flow, so an offer to open the neighbouring one would lead nowhere.
   */
  openFlow: ((flow: FlowId, node: string) => void) | null;
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

/**
 * A chart drawn to be read rather than edited carries no knobs and nothing to follow, so it
 * is not made to wrap itself in a provider it would only be satisfying.
 */
const READ_ONLY: RecommenderParams = {
  config: {} as PromotedAlbumSettings,
  update: () => {},
  openFlow: null,
  arrivedAt: null,
};

export function useRecommenderParams(): RecommenderParams {
  return useContext(RecommenderParamsContext) ?? READ_ONLY;
}
