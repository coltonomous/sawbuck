import { useState } from 'react';
import { api } from '../api';

interface Material {
  id: number;
  category: string;
  productName: string;
  brand: string | null;
  quantity: number;
  unit: string | null;
  estimatedPrice: number | null;
  actualPrice: number | null;
  purchased: boolean;
  amazonSearchUrl: string | null;
  homeDepotSearchUrl: string | null;
  lowesSearchUrl: string | null;
}

export default function MaterialsList({
  materials,
  projectId,
  onUpdate,
}: {
  materials: Material[];
  projectId: number;
  onUpdate?: () => void;
}) {
  const [updating, setUpdating] = useState<number | null>(null);

  const totalEstimated = materials.reduce((s, m) => s + (m.estimatedPrice ?? 0), 0);
  const purchased = materials.filter((m) => m.purchased);
  const totalActual = purchased.reduce((s, m) => s + (m.actualPrice ?? m.estimatedPrice ?? 0), 0);
  const allPurchased = materials.length > 0 && purchased.length === materials.length;

  const handleTogglePurchased = async (mat: Material) => {
    setUpdating(mat.id);
    await api.updateMaterial(projectId, mat.id, { purchased: !mat.purchased });
    onUpdate?.();
    setUpdating(null);
  };

  const handleActualPrice = async (mat: Material, price: string) => {
    const val = parseFloat(price);
    if (isNaN(val)) return;
    setUpdating(mat.id);
    await api.updateMaterial(projectId, mat.id, { actualPrice: val });
    onUpdate?.();
    setUpdating(null);
  };

  const openAllSearches = () => {
    const unpurchased = materials.filter((m) => !m.purchased);
    for (const mat of unpurchased) {
      if (mat.amazonSearchUrl) window.open(mat.amazonSearchUrl, '_blank');
    }
  };

  const grouped = materials.reduce((acc, m) => {
    if (!acc[m.category]) acc[m.category] = [];
    acc[m.category].push(m);
    return acc;
  }, {} as Record<string, Material[]>);

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 flex items-center justify-between">
        <div className="flex gap-6 text-sm">
          <div>
            <span className="text-gray-500">Estimated: </span>
            <span className="font-semibold">${totalEstimated.toFixed(2)}</span>
          </div>
          <div>
            <span className="text-gray-500">Actual: </span>
            <span className="font-semibold">${totalActual.toFixed(2)}</span>
          </div>
          <div>
            <span className="text-gray-500">Items: </span>
            <span className="font-semibold">
              {materials.filter((m) => m.purchased).length}/{materials.length} purchased
            </span>
          </div>
        </div>
        {!allPurchased && (
          <button
            onClick={openAllSearches}
            className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
          >
            Open All on Amazon
          </button>
        )}
      </div>

      {/* Materials by category */}
      {Object.entries(grouped).map(([category, items]) => (
        <div key={category} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-4 py-2 bg-gray-50 border-b">
            <h4 className="text-xs font-medium text-gray-500 uppercase">{category}</h4>
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {items.map((mat) => (
                <tr key={mat.id} className={mat.purchased ? 'bg-green-50/50' : ''}>
                  <td className="px-4 py-2.5 w-8">
                    <input
                      type="checkbox"
                      checked={mat.purchased}
                      onChange={() => handleTogglePurchased(mat)}
                      disabled={updating === mat.id}
                      className="rounded"
                    />
                  </td>
                  <td className={`px-2 py-2.5 ${mat.purchased ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                    <span className="font-medium">{mat.brand}</span> {mat.productName}
                    <span className="text-gray-400 ml-1">
                      ({mat.quantity} {mat.unit})
                    </span>
                  </td>
                  <td className="px-2 py-2.5 w-28">
                    <input
                      type="number"
                      step="0.01"
                      placeholder={mat.estimatedPrice?.toFixed(2) ?? '-'}
                      defaultValue={mat.actualPrice?.toFixed(2) ?? ''}
                      onBlur={(e) => handleActualPrice(mat, e.target.value)}
                      className="w-full border rounded px-2 py-1 text-sm text-right"
                    />
                  </td>
                  <td className="px-2 py-2.5 w-24 text-right">
                    <div className="flex gap-1 justify-end">
                      {mat.amazonSearchUrl && (
                        <a
                          href={mat.amazonSearchUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded text-xs hover:bg-orange-200"
                          title="Search Amazon"
                        >
                          AMZ
                        </a>
                      )}
                      {mat.homeDepotSearchUrl && (
                        <a
                          href={mat.homeDepotSearchUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-1.5 py-0.5 bg-orange-100 text-orange-600 rounded text-xs hover:bg-orange-200"
                          title="Search Home Depot"
                        >
                          HD
                        </a>
                      )}
                      {mat.lowesSearchUrl && (
                        <a
                          href={mat.lowesSearchUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-xs hover:bg-blue-200"
                          title="Search Lowe's"
                        >
                          LOW
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
