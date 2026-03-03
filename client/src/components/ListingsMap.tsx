import { useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { Link } from 'react-router-dom';

function makeIcon(color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="36" viewBox="0 0 24 36">
    <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${color}"/>
    <circle cx="12" cy="12" r="5" fill="white"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [24, 36],
    iconAnchor: [12, 36],
    popupAnchor: [0, -36],
  });
}

const greenIcon = makeIcon('#22c55e');
const yellowIcon = makeIcon('#eab308');
const grayIcon = makeIcon('#9ca3af');

function getIcon(dealScore: number | null) {
  if (dealScore != null && dealScore >= 2) return greenIcon;
  if (dealScore != null && dealScore >= 1.5) return yellowIcon;
  return grayIcon;
}

interface Props {
  listings: any[];
}

export default function ListingsMap({ listings }: Props) {
  const withCoords = useMemo(
    () => listings.filter(l => l.latitude != null && l.longitude != null),
    [listings]
  );

  const center = useMemo<[number, number]>(() => {
    if (withCoords.length === 0) return [39.8, -98.5]; // US center
    const lat = withCoords.reduce((s, l) => s + l.latitude, 0) / withCoords.length;
    const lng = withCoords.reduce((s, l) => s + l.longitude, 0) / withCoords.length;
    return [lat, lng];
  }, [withCoords]);

  if (withCoords.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p className="text-sm">No listings with location data to display on the map.</p>
      </div>
    );
  }

  return (
    <MapContainer center={center} zoom={10} className="h-[500px] rounded-lg border border-gray-200">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {withCoords.map((listing) => (
        <Marker key={listing.id} position={[listing.latitude, listing.longitude]} icon={getIcon(listing.dealScore)}>
          <Popup>
            <div className="w-48">
              {listing.primaryImage && (
                <img
                  src={listing.primaryImage.startsWith('http') ? listing.primaryImage : `/images/${listing.primaryImage}`}
                  alt=""
                  className="w-full h-24 object-cover rounded mb-2"
                />
              )}
              <p className="text-sm font-medium leading-snug line-clamp-2">{listing.title}</p>
              <div className="flex items-center justify-between mt-1">
                <span className={`text-[10px] px-1 py-0.5 rounded font-medium ${
                  listing.platform === 'craigslist' ? 'bg-purple-100 text-purple-700' :
                  listing.platform === 'offerup' ? 'bg-teal-100 text-teal-700' :
                  listing.platform === 'ebay' ? 'bg-blue-100 text-blue-700' :
                  'bg-orange-100 text-orange-700'
                }`}>{listing.platform}</span>
                {listing.askingPrice != null && (
                  <span className="font-semibold text-sm">${listing.askingPrice}</span>
                )}
              </div>
              <Link to={`/listings/${listing.id}`} className="text-xs text-blue-600 hover:underline mt-1 block">
                View details
              </Link>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
