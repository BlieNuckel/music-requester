interface ProfileFactsProps {
  facts: { label: string; value: string | number }[];
}

/** A compact label/value grid, since this view is about numbers, not layout. */
export default function ProfileFacts({ facts }: ProfileFactsProps) {
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {facts.map((fact) => (
        <div key={fact.label} className="min-w-0">
          <dt className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500 truncate">
            {fact.label}
          </dt>
          <dd className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
