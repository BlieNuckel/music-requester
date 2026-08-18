interface ConnectionResultBannerProps {
  tone: "success" | "warning" | "error";
  children: React.ReactNode;
}

const TONE_CLASSES: Record<ConnectionResultBannerProps["tone"], string> = {
  success: "bg-emerald-400 text-black",
  warning: "bg-amber-300 text-black",
  error: "bg-rose-400 text-white",
};

export default function ConnectionResultBanner({
  tone,
  children,
}: ConnectionResultBannerProps) {
  return (
    <div
      className={`mt-4 p-3 rounded-xl text-sm font-medium border-2 border-black shadow-cartoon-sm animate-slide-up ${TONE_CLASSES[tone]}`}
    >
      {children}
    </div>
  );
}
