import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Listing } from '../api';
import { useToast } from '../components/Toast';
import { Spinner, EmptyState } from '../components/ui';
import { resolveImageUrl } from '../utils';
import type { FormEvent } from 'react';

export default function MyListings() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createForm, setCreateForm] = useState({ title: '', description: '', askingPrice: '', location: '' });
  const [createPhotos, setCreatePhotos] = useState<File[]>([]);

  const [editing, setEditing] = useState<Listing | null>(null);
  const [editForm, setEditForm] = useState({ title: '', description: '', askingPrice: '', location: '' });
  const [saving, setSaving] = useState(false);

  const loadListings = useCallback(async () => {
    try {
      const { listings } = await api.getListings({ mine: 'true', limit: '100', sort: 'scrapedAt', sort_dir: 'desc' });
      setListings(listings);
    } catch (err) {
      toast('error', `Failed to load listings: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadListings(); }, [loadListings]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!createForm.title || !createForm.askingPrice || createPhotos.length === 0) return;
    setCreating(true);
    setCreateError('');
    try {
      const formData = new FormData();
      formData.append('title', createForm.title);
      if (createForm.description) formData.append('description', createForm.description);
      formData.append('askingPrice', createForm.askingPrice);
      if (createForm.location) formData.append('location', createForm.location);
      for (const photo of createPhotos) formData.append('photos', photo);
      await api.createSawbuckListing(formData);
      setCreateForm({ title: '', description: '', askingPrice: '', location: '' });
      setCreatePhotos([]);
      setShowCreate(false);
      toast('success', 'Listing posted');
      loadListings();
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create listing');
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (listing: Listing) => {
    setEditing(listing);
    setEditForm({
      title: listing.title,
      description: listing.description || '',
      askingPrice: listing.askingPrice?.toString() || '',
      location: listing.location || '',
    });
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await api.editSawbuckListing(editing.id, {
        title: editForm.title,
        description: editForm.description || null,
        askingPrice: parseFloat(editForm.askingPrice),
        location: editForm.location || null,
      });
      setEditing(null);
      toast('success', 'Listing updated');
      loadListings();
    } catch (err: any) {
      toast('error', err.message || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this listing? This cannot be undone.')) return;
    try {
      await api.deleteListing(id);
      toast('success', 'Listing deleted');
      loadListings();
    } catch (err: any) {
      toast('error', err.message || 'Failed to delete');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-2xl font-bold text-gray-900">My Listings</h2>
        <button
          onClick={() => { setShowCreate(!showCreate); setCreateError(''); }}
          className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
            showCreate ? 'text-gray-500 hover:text-gray-700' : 'bg-amber-500 text-white hover:bg-amber-600'
          }`}
        >
          {showCreate ? 'Cancel' : 'Post Listing'}
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-5">Manage your posted listings.</p>

      {/* Create form */}
      {showCreate && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-5">
          <form onSubmit={handleCreate} className="space-y-3">
            <input
              type="text"
              placeholder="Title (e.g., Mid-century walnut dresser)"
              value={createForm.title}
              onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              required
            />
            <textarea
              placeholder="Description — condition, dimensions, history (optional)"
              value={createForm.description}
              onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                type="number"
                placeholder="Asking price ($)"
                value={createForm.askingPrice}
                onChange={(e) => setCreateForm({ ...createForm, askingPrice: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                required min="0" step="0.01"
              />
              <input
                type="text"
                placeholder="Location, e.g., Seattle (optional)"
                value={createForm.location}
                onChange={(e) => setCreateForm({ ...createForm, location: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
            </div>
            <input
              type="file" accept="image/*" multiple required
              onChange={(e) => setCreatePhotos(Array.from(e.target.files || []))}
              className="w-full text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-gray-300 file:text-sm file:font-medium file:bg-white file:text-gray-700 hover:file:bg-gray-50"
            />
            {createPhotos.length > 0 && (
              <p className="text-xs text-gray-400">{createPhotos.length} photo{createPhotos.length !== 1 ? 's' : ''} selected</p>
            )}
            {createError && <p className="text-sm text-red-600">{createError}</p>}
            <button
              type="submit"
              disabled={creating || !createForm.title || !createForm.askingPrice || createPhotos.length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 disabled:opacity-40 transition-colors"
            >
              {creating ? <><Spinner size="xs" /> Posting</> : 'Post Listing'}
            </button>
          </form>
        </div>
      )}

      {/* Listings */}
      {loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : listings.length === 0 && !showCreate ? (
        <EmptyState
          icon={<svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>}
          title="No listings yet"
          subtitle="Post a listing to sell furniture to other Sawbuck users."
        />
      ) : (
        <div className="space-y-2">
          {listings.map((listing) => (
            <div key={listing.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 flex items-center gap-3">
              <div
                className="w-14 h-14 rounded-lg overflow-hidden bg-gray-100 shrink-0 cursor-pointer"
                onClick={() => navigate(`/listings/${listing.id}`)}
              >
                {listing.primaryImage ? (
                  <img src={resolveImageUrl(listing.primaryImage)} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full animate-pulse bg-gray-200" />
                )}
              </div>
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate(`/listings/${listing.id}`)}>
                <p className="text-sm font-medium text-gray-900 truncate">{listing.title}</p>
                <p className="text-xs text-gray-500">
                  {listing.askingPrice != null && `$${listing.askingPrice}`}
                  {listing.location && ` · ${listing.location}`}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {editing?.id === listing.id ? null : (
                  <>
                    <button
                      onClick={() => startEdit(listing)}
                      className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(listing.id)}
                      className="text-xs text-red-400 hover:text-red-600 transition-colors"
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Inline edit form */}
      {editing && (
        <div className="mt-3 bg-white rounded-lg shadow-sm border border-amber-200 p-4">
          <h4 className="text-sm font-medium text-gray-900 mb-3">Editing: {editing.title}</h4>
          <div className="space-y-3">
            <input
              type="text" value={editForm.title}
              onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              placeholder="Title"
            />
            <textarea
              value={editForm.description}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              placeholder="Description"
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                type="number" value={editForm.askingPrice}
                onChange={(e) => setEditForm({ ...editForm, askingPrice: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                placeholder="Price" min="0" step="0.01"
              />
              <input
                type="text" value={editForm.location}
                onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                placeholder="Location"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSaveEdit}
                disabled={saving}
                className="px-3 py-1.5 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => setEditing(null)}
                className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
