function Line({ w = 'w-full', h = 'h-4' }: { w?: string; h?: string }) {
  return <div className={`${w} ${h} bg-gray-200 rounded animate-pulse`} />;
}

export function SkeletonCard() {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="aspect-[4/3] bg-gray-200 animate-pulse" />
      <div className="p-3.5 space-y-2.5">
        <Line w="w-3/4" />
        <Line w="w-full" h="h-3" />
        <div className="flex justify-between pt-1">
          <Line w="w-16" h="h-5" />
          <Line w="w-12" h="h-5" />
        </div>
      </div>
    </div>
  );
}

export function SkeletonTable({ rows = 8 }: { rows?: number }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="bg-gray-50/80 px-4 py-3 flex gap-4">
        {[40, 200, 80, 70, 60, 55, 60].map((w, i) => (
          <div key={i} className="h-3 bg-gray-200 rounded animate-pulse" style={{ width: w }} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-4 py-3 flex items-center gap-4 border-t border-gray-100">
          <div className="w-10 h-10 rounded-md bg-gray-200 animate-pulse shrink-0" />
          <Line w="w-1/3" h="h-3.5" />
          <Line w="w-16" h="h-3" />
          <Line w="w-12" h="h-3" />
          <Line w="w-20" h="h-3" />
          <Line w="w-10" h="h-3" />
          <Line w="w-14" h="h-3" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonChartPage() {
  return (
    <div>
      <div className="grid grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 space-y-2">
            <Line w="w-20" h="h-3" />
            <Line w="w-16" h="h-7" />
          </div>
        ))}
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 mb-4">
          <Line w="w-32" h="h-3" />
          <div className="mt-4 h-56 bg-gray-100 rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonDetail() {
  return (
    <div className="max-w-4xl">
      <Line w="w-12" h="h-4" />
      <div className="flex items-start justify-between mt-6 mb-6">
        <div className="flex-1 space-y-2">
          <Line w="w-2/3" h="h-7" />
          <div className="flex gap-2">
            <Line w="w-16" h="h-5" />
            <Line w="w-24" h="h-5" />
          </div>
        </div>
        <Line w="w-20" h="h-9" />
      </div>
      <div className="flex gap-2 overflow-hidden mb-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-52 w-72 bg-gray-200 rounded-lg animate-pulse shrink-0" />
        ))}
      </div>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 mb-4 space-y-3">
        <Line w="w-24" h="h-3" />
        <Line />
        <Line w="w-5/6" />
        <Line w="w-2/3" />
      </div>
    </div>
  );
}

export function SkeletonKanban() {
  return (
    <div className="grid grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, col) => (
        <div key={col}>
          <div className="bg-gray-100 rounded-t-lg px-4 py-2.5 flex items-center justify-between">
            <Line w="w-20" h="h-3" />
            <Line w="w-6" h="h-5" />
          </div>
          <div className="bg-gray-50 rounded-b-lg p-2.5 min-h-[200px] space-y-2.5">
            {Array.from({ length: col === 0 ? 3 : col === 3 ? 1 : 2 }).map((_, i) => (
              <div key={i} className="bg-white rounded-lg shadow-sm border border-gray-200/80 p-3 space-y-2">
                <div className="h-24 bg-gray-200 rounded-md animate-pulse" />
                <Line w="w-3/4" h="h-3.5" />
                <div className="flex justify-between">
                  <Line w="w-12" h="h-3" />
                  <Line w="w-16" h="h-3" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
