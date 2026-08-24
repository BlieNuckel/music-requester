import { createContext, useContext } from "react";
import type { PromotedAlbumSettings } from "@/context/settingsContextDef";

export type ParamKey = keyof PromotedAlbumSettings;

/** Every shape a knob's value can take. Which one applies is decided by `ParamDef.kind`. */
export type ParamValue = string | number | boolean | string[];

export type RecommenderParams = {
  config: PromotedAlbumSettings;
  update: (key: ParamKey, value: ParamValue) => void;
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
