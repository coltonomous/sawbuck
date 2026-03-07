import { api, type Listing } from '../api';
import { useToast } from './Toast';

interface Props {
  selected: Set<number>;
  onClear: () => void;
  onDone: () => void;
}

export default function BulkActionBar({ selected, onClear, onDone }: Props) {
  const count = selected.size;
  const { toast } = useToast();

  const handleAction = async (updates: Partial<Listing>) => {
    await api.bulkUpdateListings([...selected], updates);
    toast('success', `${count} listing${count !== 1 ? 's' : ''} updated`);
    onClear();
    onDone();
  };

  return (
    <div className="fixed bottom-0 left-56 right-0 bg-gray-900 text-white px-6 py-3 flex items-center justify-between z-50 shadow-lg">
      <span className="text-sm font-medium">{count} item{count !== 1 ? 's' : ''} selected</span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => handleAction({ status: 'dismissed' })}
          className="px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 transition-colors"
        >
          Dismiss
        </button>
        <button
          onClick={() => handleAction({ status: 'watching' })}
          className="px-3 py-1.5 bg-amber-500 text-white text-xs font-medium rounded-lg hover:bg-amber-600 transition-colors"
        >
          Set Watching
        </button>
        <button
          onClick={onClear}
          className="px-3 py-1.5 bg-gray-700 text-gray-300 text-xs font-medium rounded-lg hover:bg-gray-600 transition-colors"
        >
          Deselect All
        </button>
      </div>
    </div>
  );
}
