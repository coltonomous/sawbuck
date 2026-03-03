interface Props {
  purchasePrice: number;
  materialCost: number;
  materialsCostIsEstimate?: boolean;
  hoursInvested: number;
  hourlyRate: number;
  estimatedResalePrice: number;
  sellingFees?: number;
  shippingCost?: number;
  soldPrice?: number | null;
}

export default function ROICalculator({
  purchasePrice,
  materialCost,
  materialsCostIsEstimate,
  hoursInvested,
  hourlyRate,
  estimatedResalePrice,
  sellingFees = 0,
  shippingCost = 0,
  soldPrice,
}: Props) {
  const laborCost = hoursInvested * hourlyRate;
  const totalCost = purchasePrice + materialCost + laborCost + sellingFees + shippingCost;
  const revenue = soldPrice ?? estimatedResalePrice;
  const profit = revenue - totalCost;
  const roi = totalCost > 0 ? (profit / totalCost) * 100 : 0;
  const isProjected = !soldPrice;

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3">
        {isProjected ? 'Projected ROI' : 'Actual ROI'}
      </h3>

      <dl className="space-y-2 text-sm">
        <Row label="Purchase price" value={purchasePrice} negative />
        <Row label={materialsCostIsEstimate ? 'Materials (est.)' : 'Materials'} value={materialCost} negative />
        <Row label={`Labor (${hoursInvested}h @ $${hourlyRate}/h)`} value={laborCost} negative />
        {sellingFees > 0 && <Row label="Selling fees" value={sellingFees} negative />}
        {shippingCost > 0 && <Row label="Shipping" value={shippingCost} negative />}

        <div className="border-t pt-2">
          <Row label="Total investment" value={totalCost} bold negative />
        </div>

        <div className="border-t pt-2">
          <Row
            label={isProjected ? 'Est. resale price' : 'Sold for'}
            value={revenue}
            bold
          />
        </div>

        <div className={`border-t pt-2 ${profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>
          <div className="flex justify-between font-bold text-base">
            <dt>{isProjected ? 'Projected profit' : 'Profit'}</dt>
            <dd>${profit.toFixed(2)}</dd>
          </div>
          <div className="flex justify-between text-xs mt-0.5 opacity-75">
            <dt>ROI</dt>
            <dd>{roi.toFixed(1)}%</dd>
          </div>
        </div>
      </dl>
    </div>
  );
}

function Row({ label, value, bold, negative }: {
  label: string;
  value: number;
  bold?: boolean;
  negative?: boolean;
}) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold' : ''}`}>
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-900">
        {negative ? '-' : ''}${value.toFixed(2)}
      </dd>
    </div>
  );
}
