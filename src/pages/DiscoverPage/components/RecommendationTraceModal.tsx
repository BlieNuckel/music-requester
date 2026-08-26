import Modal from "@/components/Modal";
import RecommenderGraphCanvas from "@/components/recommenderGraph/RecommenderGraphCanvas";
import { useFlowShape } from "@/components/recommenderGraph/useFlowShape";
import { DEFAULT_LAYOUT } from "@/components/recommenderGraph/autoLayout";
import type { RecommendationTrace } from "@shared/recommendationTrace";

interface RecommendationTraceModalProps {
  isOpen: boolean;
  onClose: () => void;
  trace: RecommendationTrace;
  albumName: string;
  artistName: string;
}

/**
 * Why this record, drawn on the pipeline that produced it.
 *
 * There used to be a bespoke stage component per stage per source here, switching on a
 * hand-written trace type — a second drawing of a pipeline that was already drawn on the
 * settings page, free to disagree with it. This is that same chart, with the run's own
 * numbers on the steps that ran and the steps that did not visibly out of it.
 */
export default function RecommendationTraceModal({
  isOpen,
  onClose,
  trace,
  albumName,
  artistName,
}: RecommendationTraceModalProps) {
  const { data: graph, loading, error } = useFlowShape("spotlight", isOpen);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      panelClassName="max-w-6xl w-full max-h-[92vh] overflow-y-auto"
    >
      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            Why {albumName}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {artistName} · the steps that picked it, and what each of them found
          </p>
        </div>

        {loading && !graph && (
          <p
            data-testid="trace-loading"
            className="text-sm text-gray-500 dark:text-gray-400"
          >
            Drawing the pipeline…
          </p>
        )}

        {error && !graph && (
          <p
            data-testid="trace-error"
            className="text-sm text-rose-600 dark:text-rose-400"
          >
            {error}
          </p>
        )}

        {graph && (
          <RecommenderGraphCanvas
            graph={graph}
            flow="spotlight"
            layout={DEFAULT_LAYOUT}
            trace={trace}
            className="h-[62vh] min-h-[360px]"
          />
        )}

        <button
          type="button"
          onClick={onClose}
          className="self-end px-4 py-2 rounded-lg border-2 border-black bg-white dark:bg-gray-700 text-sm font-bold shadow-cartoon-sm"
        >
          Close
        </button>
      </div>
    </Modal>
  );
}
