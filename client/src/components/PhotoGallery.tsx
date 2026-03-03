import { useState, useRef } from 'react';
import { api } from '../api';

interface Photo {
  id: number;
  projectId: number;
  photoType: 'before' | 'during' | 'after';
  localPath: string;
  caption: string | null;
  createdAt: string;
}

interface Props {
  projectId: number;
  photos: Photo[];
  onUpdate: () => void;
}

const TYPES = ['before', 'during', 'after'] as const;

export default function PhotoGallery({ projectId, photos, onUpdate }: Props) {
  const [uploading, setUploading] = useState(false);
  const [uploadType, setUploadType] = useState<string>('during');
  const [caption, setCaption] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const grouped = TYPES.reduce((acc, t) => {
    acc[t] = photos.filter((p) => p.photoType === t);
    return acc;
  }, {} as Record<string, Photo[]>);

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await api.uploadProjectPhoto(projectId, file, uploadType, caption || undefined);
      setCaption('');
      if (fileRef.current) fileRef.current.value = '';
      onUpdate();
    } catch (err: any) {
      alert(`Upload failed: ${err.message}`);
    }
    setUploading(false);
  };

  const handleDelete = async (photoId: number) => {
    if (!confirm('Delete this photo?')) return;
    await api.deleteProjectPhoto(projectId, photoId);
    onUpdate();
  };

  return (
    <div className="space-y-6">
      {/* Upload form */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
        <h3 className="font-medium text-gray-900 mb-3">Upload Photo</h3>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="w-full text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
          </div>
          <div>
            <select
              value={uploadType}
              onChange={(e) => setUploadType(e.target.value)}
              className="border rounded px-3 py-2 text-sm"
            >
              <option value="before">Before</option>
              <option value="during">During</option>
              <option value="after">After</option>
            </select>
          </div>
          <div className="flex-1">
            <input
              type="text"
              placeholder="Caption (optional)"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={handleUpload}
            disabled={uploading}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
          >
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </div>

      {/* Photo grid by type */}
      {TYPES.map((type) => (
        <div key={type}>
          <h3 className="text-sm font-medium text-gray-500 uppercase mb-2">
            {type} ({grouped[type].length})
          </h3>
          {grouped[type].length === 0 ? (
            <p className="text-xs text-gray-400 mb-4">No {type} photos yet</p>
          ) : (
            <div className="grid grid-cols-3 gap-3 mb-4">
              {grouped[type].map((photo) => (
                <div key={photo.id} className="relative group">
                  <img
                    src={`/images/${photo.localPath}`}
                    alt={photo.caption || `${type} photo`}
                    className="w-full h-40 object-cover rounded-lg"
                  />
                  {photo.caption && (
                    <p className="text-xs text-gray-500 mt-1">{photo.caption}</p>
                  )}
                  <button
                    onClick={() => handleDelete(photo.id)}
                    className="absolute top-1 right-1 bg-red-600 text-white rounded-full w-6 h-6 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    X
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {photos.length === 0 && (
        <p className="text-center text-gray-400 py-8">No photos yet. Upload your first one above.</p>
      )}
    </div>
  );
}
