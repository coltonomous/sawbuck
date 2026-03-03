import { useRef } from 'react';
import { useToast } from './Toast';

interface Props {
  project: any;
  onClose: () => void;
}

export default function ExportListingText({ project, onClose }: Props) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();

  const listing = project.listing;
  const plan = project.plan;

  const lines: string[] = [];
  lines.push(project.name);
  lines.push('');

  const details: string[] = [];
  if (listing?.furnitureType) details.push(listing.furnitureType);
  if (listing?.furnitureStyle) details.push(`${listing.furnitureStyle} style`);
  if (listing?.woodSpecies) details.push(listing.woodSpecies);
  if (details.length > 0) lines.push(details.join(' | '));

  if (plan?.description) {
    lines.push('');
    lines.push(plan.description);
  }

  if (plan?.steps) {
    const steps = typeof plan.steps === 'string' ? JSON.parse(plan.steps) : plan.steps;
    if (Array.isArray(steps) && steps.length > 0) {
      lines.push('');
      lines.push('Refinishing work:');
      steps.forEach((s: any) => {
        lines.push(`- ${s.name || s.title || s}`);
      });
    }
  }

  if (project.listedPrice) {
    lines.push('');
    lines.push(`Price: $${project.listedPrice}`);
  }

  const text = lines.join('\n');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(textRef.current?.value || text);
      toast('success', 'Copied to clipboard');
    } catch {
      textRef.current?.select();
      document.execCommand('copy');
      toast('success', 'Copied to clipboard');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">Export Listing Text</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5">
          <textarea
            ref={textRef}
            defaultValue={text}
            rows={12}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono resize-y"
          />
          <div className="flex items-center justify-end gap-2 mt-3">
            <button
              onClick={handleCopy}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              Copy to Clipboard
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
