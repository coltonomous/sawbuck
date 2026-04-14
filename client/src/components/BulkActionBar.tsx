import { api, type Listing } from '../api';
import { useToast } from './Toast';

interface Props {
  selected: Set<number>;
  isAdmin?: boolean;
  onClear: () => void;
  onDone: () => void;
}

export default function BulkActionBar({ selected, isAdmin, onClear, onDone }: Props) {
  const count = selected.size;
  const { toast } = useToast();

  const handleBulkDismiss = async () => {
    try {
      await Promise.all([...selected].map((id) => api.dismissListing(id)));
      toast('success', `${count} listing${count !== 1 ? 's' : ''} dismissed`);
      onClear();
      onDone();
    } catch (err) {
      toast('error', `Dismiss failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleAction = async (updates: Partial<Listing>) => {
    try {
      await api.bulkUpdateListings([...selected], updates);
      toast('success', `${count} listing${count !== 1 ? 's' : ''} updated`);
      onClear();
      onDone();
    } catch (err) {
      toast('error', `Bulk update failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Permanently delete ${count} listing${count !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    try {
      await api.deleteAgentListings([...selected]);
      toast('success', `${count} listing${count !== 1 ? 's' : ''} deleted`);
      onClear();
      onDone();
    } catch (err) {
      toast('error', `Delete failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  return (
    <div className="fixed bottom-0 left-56 right-0 bg-gray-900 text-white px-6 py-3 flex items-center justify-between z-50 shadow-lg">
      <span className="text-sm font-medium">{count} item{count !== 1 ? 's' : ''} selected</span>
      <div className="flex items-center gap-2">
        <button
          onClick={handleBulkDismiss}
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
        {isAdmin && (
          <button
            onClick={handleDelete}
            className="px-3 py-1.5 bg-red-900 text-red-200 text-xs font-medium rounded-lg hover:bg-red-800 transition-colors"
          >
            Delete
          </button>
        )}
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
